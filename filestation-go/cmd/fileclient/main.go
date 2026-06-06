package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

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

func main() {
	serverURL := loadServerURL()

	w := webview.New(true)
	if w == nil {
		slog.Error("WebView2-Laufzeitumgebung nicht gefunden")
		os.Exit(1)
	}
	defer w.Destroy()

	w.SetTitle("FileStation")
	w.SetSize(1280, 820, webview.HintNone)
	w.Navigate("about:blank")

	go monitor(w, serverURL)

	w.Run()
}

func monitor(w webview.WebView, serverURL string) {
	connected := false
	client := &http.Client{Timeout: 3 * time.Second}

	for {
		_, err := client.Get(serverURL + "/api/config")
		reachable := err == nil

		if reachable && !connected {
			w.Dispatch(func() { w.Navigate(serverURL) })
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
