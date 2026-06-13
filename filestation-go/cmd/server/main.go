package main

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"filestation/internal/api"
	"filestation/internal/config"
	"filestation/internal/db"
	dirfs "filestation/internal/fs"
	"filestation/internal/scan"
	"filestation/internal/sse"
	"filestation/internal/watch"
	"filestation/webembed"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	config.Init("config.json", "ui_settings.json")

	if err := db.Init("filestation.db"); err != nil {
		slog.Error("Datenbank konnte nicht geöffnet werden", "err", err)
		os.Exit(1)
	}

	// DirService: cached directory listings (30 s TTL, invalidation via onDirChange).
	dirSvc := dirfs.New(30 * time.Second)

	hub := sse.NewHub()

	// dirInvalidate: called by watch.go for every FS event (parent dir of changed path).
	// Invalidates the cache entry and sends a debounced SSE so the frontend re-fetches.
	var dirNotifyTimer sync.Map
	dirInvalidate := func(path string) {
		dirSvc.InvalidateDir(path)
		if t, ok := dirNotifyTimer.Load("__dir__"); ok {
			t.(*time.Timer).Stop()
		}
		timer := time.AfterFunc(200*time.Millisecond, func() {
			dirNotifyTimer.Delete("__dir__")
			hub.Notify("dir_invalidated")
		})
		dirNotifyTimer.Store("__dir__", timer)
	}

	mux := http.NewServeMux()
	api.InitDirService(dirSvc)
	api.Register(mux, hub)

	// SPA-Fallback: eingebettetes web/ Verzeichnis
	sub, err := fs.Sub(webembed.FS, "web")
	if err != nil {
		slog.Error("Embedded web-Verzeichnis fehlt", "err", err)
		os.Exit(1)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if _, err := sub.Open(p); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Watchdog starten, falls Audioverzeichnis konfiguriert
	cfg := config.Load()
	var watcher *watch.Watcher
	if cfg.AudioPath != "" {
		if fi, err := os.Stat(cfg.AudioPath); err == nil && fi.IsDir() {
			watcher, err = watch.Start(cfg.AudioPath, func(msg string) {
				if strings.HasPrefix(msg, "done:") {
					db.BumpVersion()
				}
				hub.Notify(msg)
			}, dirInvalidate)
			if err != nil {
				slog.Warn("Watchdog konnte nicht gestartet werden", "err", err)
			}
			go scan.Incremental(cfg.AudioPath, func(msg string) {
				if strings.HasPrefix(msg, "done:") {
					db.BumpVersion()
				}
				hub.Notify(msg)
			})
		}
	}

	api.StartUSBPoller()

	// Abgelaufene Sessions stündlich bereinigen
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				_ = db.DeleteExpiredSessions()
			case <-ctx.Done():
				return
			}
		}
	}()

	port := cfg.Port
	if port == 0 {
		port = 58427
	}
	addr := fmt.Sprintf(":%d", port)
	srv := &http.Server{Addr: addr, Handler: api.WithAuth(mux)}

	go func() {
		<-ctx.Done()
		slog.Info("Server wird beendet…")
		scan.Cancel()
		if watcher != nil {
			watcher.Close()
		}
		dirSvc.Close()
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutCtx)
	}()

	slog.Info("Server gestartet", "addr", fmt.Sprintf("http://localhost:%d", port))
	for _, ip := range lanIPs() {
		slog.Info("Netzwerk", "addr", fmt.Sprintf("http://%s:%d", ip, port))
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("Server-Fehler", "err", err)
		os.Exit(1)
	}
}

func lanIPs() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	var ips []string
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			ips = append(ips, ipnet.IP.String())
		}
	}
	return ips
}
