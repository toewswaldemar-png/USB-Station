package main

import (
	"bufio"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"

	webview "github.com/jchv/go-webview2"
)

type clientConfig struct {
	ServerURL string `json:"server_url"`
}

func loadServerURL() string {
	data, err := os.ReadFile("config.json")
	if err != nil {
		return "http://localhost:8000"
	}
	var c clientConfig
	if err := json.Unmarshal(data, &c); err != nil || c.ServerURL == "" {
		return "http://localhost:8000"
	}
	return c.ServerURL
}

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procGetWindowLongPtr = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr = user32.NewProc("SetWindowLongPtrW")
	procGetWindowRect    = user32.NewProc("GetWindowRect")
	procSetWindowPos     = user32.NewProc("SetWindowPos")
	procMonitorFromWin   = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfo   = user32.NewProc("GetMonitorInfoW")
)

const (
	gwlStyle              = uintptr(0xFFFFFFF0) // GWL_STYLE = -16
	wsOverlappedWindow    = uintptr(0x00CF0000)
	swpNoOwnerZOrder      = uintptr(0x0200)
	swpFrameChanged       = uintptr(0x0020)
	swpNoZOrder           = uintptr(0x0004)
	monitorDefaultNearest = uintptr(2)
)

type winRect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	Size      uint32
	RcMonitor winRect
	RcWork    winRect
	Flags     uint32
}

var (
	fsActive     bool
	fsSavedStyle uintptr
	fsSavedRect  winRect
)

func setFullscreen(hwnd uintptr, enable bool) {
	if enable && !fsActive {
		style, _, _ := procGetWindowLongPtr.Call(hwnd, gwlStyle)
		fsSavedStyle = style
		procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&fsSavedRect)))

		hMon, _, _ := procMonitorFromWin.Call(hwnd, monitorDefaultNearest)
		var mi monitorInfo
		mi.Size = uint32(unsafe.Sizeof(mi))
		procGetMonitorInfo.Call(hMon, uintptr(unsafe.Pointer(&mi)))

		procSetWindowLongPtr.Call(hwnd, gwlStyle, style&^wsOverlappedWindow)

		r := mi.RcMonitor
		procSetWindowPos.Call(
			hwnd, 0,
			uintptr(r.Left), uintptr(r.Top),
			uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
			swpNoOwnerZOrder|swpFrameChanged,
		)
		fsActive = true
	} else if !enable && fsActive {
		procSetWindowLongPtr.Call(hwnd, gwlStyle, fsSavedStyle)
		r := fsSavedRect
		procSetWindowPos.Call(
			hwnd, 0,
			uintptr(r.Left), uintptr(r.Top),
			uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
			swpNoOwnerZOrder|swpFrameChanged|swpNoZOrder,
		)
		fsActive = false
	}
}

func main() {
	serverURL := loadServerURL()

	w := webview.New(true)
	if w == nil {
		slog.Error("WebView2-Laufzeitumgebung nicht gefunden")
		os.Exit(1)
	}
	defer w.Destroy()

	w.SetTitle("")
	w.SetSize(1280, 820, webview.HintNone)
	w.Navigate("about:blank")

	go monitor(w, serverURL)
	go listenCommands(w, serverURL)

	w.Run()
}

func monitor(w webview.WebView, serverURL string) {
	connected := false
	client := &http.Client{Timeout: 3 * time.Second}

	for {
		_, err := client.Get(serverURL + "/api/config")
		reachable := err == nil

		if reachable && !connected {
			w.Dispatch(func() { w.Navigate(serverURL + "?kiosk=1") })
			connected = true
			slog.Info("Server erreichbar, App geladen", "url", serverURL)
		} else if !reachable && connected {
			w.Dispatch(func() { w.Navigate("about:blank") })
			connected = false
			slog.Warn("Server nicht erreichbar, warte…")
		}

		if connected {
			time.Sleep(30 * time.Second)
		} else {
			time.Sleep(time.Second)
		}
	}
}

// listenCommands connects to the server SSE stream and executes client:*
// commands directly in Go — no JavaScript binding timing issues.
func listenCommands(w webview.WebView, serverURL string) {
	hwnd := uintptr(w.Window())
	client := &http.Client{} // no timeout — SSE is long-lived

	for {
		resp, err := client.Get(serverURL + "/api/events")
		if err != nil {
			time.Sleep(3 * time.Second)
			continue
		}

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimPrefix(line, "data: ")
			switch data {
			case "client:fullscreen":
				w.Dispatch(func() { setFullscreen(hwnd, !fsActive) })
			case "client:reload":
				w.Dispatch(func() { w.Navigate(serverURL + "?kiosk=1") })
			case "client:exit":
				go func() {
					time.Sleep(100 * time.Millisecond)
					os.Exit(0)
				}()
			}
		}
		resp.Body.Close()
		slog.Warn("SSE-Verbindung unterbrochen, reconnect…")
		time.Sleep(3 * time.Second)
	}
}
