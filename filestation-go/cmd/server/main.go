package main

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
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

	// DirService: cached directory listings (30 s TTL, fsnotify invalidation).
	dirSvc, err := dirfs.New(30 * time.Second)
	if err != nil {
		slog.Warn("DirService konnte nicht gestartet werden", "err", err)
		// Non-fatal: api.Open falls back to a direct os.ReadDir if dirSvc is nil.
	}

	hub := sse.NewHub()
	mux := http.NewServeMux()
	api.InitDirService(dirSvc)
	if dirSvc != nil {
		// Externe FS-Änderungen (fsnotify im DirService) sofort per SSE melden.
		dirSvc.SetNotify(hub.Notify)
	}
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
			})
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

	srv := &http.Server{Addr: ":8000", Handler: mux}

	go func() {
		<-ctx.Done()
		slog.Info("Server wird beendet…")
		scan.Cancel()
		if watcher != nil {
			watcher.Close()
		}
		if dirSvc != nil {
			dirSvc.Close()
		}
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutCtx)
	}()

	slog.Info("Server gestartet", "addr", "http://localhost:8000")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("Server-Fehler", "err", err)
		os.Exit(1)
	}
}
