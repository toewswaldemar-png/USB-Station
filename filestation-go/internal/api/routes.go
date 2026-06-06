package api

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"filestation/internal/config"
	"filestation/internal/db"
	"filestation/internal/scan"
	"filestation/internal/sse"
	"filestation/internal/usb"
	"filestation/internal/verse"
	"filestation/internal/webdav"
)

var hub *sse.Hub

func Register(mux *http.ServeMux, h *sse.Hub) {
	hub = h

	mux.HandleFunc("GET /api/files", Files)
	mux.HandleFunc("GET /api/version", Version)
	mux.HandleFunc("GET /api/events", Events)
	mux.HandleFunc("GET /api/scan", Scan)
	mux.HandleFunc("POST /api/scan/cancel", ScanCancel)
	mux.HandleFunc("GET /api/stream", Stream)
	mux.HandleFunc("GET /api/open", Open)
	mux.HandleFunc("POST /api/save", Save)
	mux.HandleFunc("POST /api/rename", Rename)
	mux.HandleFunc("POST /api/copy", Copy)
	mux.HandleFunc("GET /api/usb", USB)
	mux.HandleFunc("GET /api/verse", Verse)
	mux.HandleFunc("GET /api/pick-folder", PickFolder)
	mux.HandleFunc("GET /api/ui-settings", GetUISettings)
	mux.HandleFunc("POST /api/ui-settings", PostUISettings)
	mux.HandleFunc("GET /api/config", GetConfig)
	mux.HandleFunc("POST /api/config", PostConfig)
	mux.HandleFunc("POST /api/auth", Auth)
	mux.HandleFunc("POST /api/client-command", ClientCommand)
	mux.HandleFunc("GET /api/webdav/list", WebDavList)
	mux.HandleFunc("GET /api/webdav/stream", WebDavStream)
	mux.HandleFunc("PUT /api/webdav/put", WebDavPut)
	mux.HandleFunc("GET /api/webdav/test", WebDavTest)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func readBody(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// ── /api/files ────────────────────────────────────────────────────────────────

func Files(w http.ResponseWriter, r *http.Request) {
	files, err := db.GetAll()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	etag := db.CurrentETag()
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		gz, _ := gzip.NewWriterLevel(w, gzip.BestSpeed)
		json.NewEncoder(gz).Encode(files)
		gz.Close()
		return
	}
	json.NewEncoder(w).Encode(files)
}

// ── /api/version ─────────────────────────────────────────────────────────────

func Version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]int64{"version": db.Version()})
}

// ── /api/events (SSE) ─────────────────────────────────────────────────────────

func Events(w http.ResponseWriter, r *http.Request) {
	hub.ServeHTTP(w, r)
}

// ── /api/scan ─────────────────────────────────────────────────────────────────

func Scan(w http.ResponseWriter, r *http.Request) {
	cfg := config.Load()
	if cfg.AudioPath == "" {
		http.Error(w, "kein Audioverzeichnis konfiguriert", http.StatusBadRequest)
		return
	}

	go scan.Incremental(cfg.AudioPath, func(msg string) {
		if strings.HasPrefix(msg, "done:") {
			db.BumpVersion()
		}
		hub.Notify(msg)
	})

	writeJSON(w, map[string]string{"status": "gestartet"})
}

// ── /api/scan/cancel ─────────────────────────────────────────────────────────

func ScanCancel(w http.ResponseWriter, r *http.Request) {
	scan.Cancel()
	writeJSON(w, map[string]string{"status": "abgebrochen"})
}

// ── /api/stream ───────────────────────────────────────────────────────────────

func Stream(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "path fehlt", http.StatusBadRequest)
		return
	}
	if strings.HasPrefix(p, "__cloud__/") {
		webdav.Stream(w, r, strings.TrimPrefix(p, "__cloud__/"))
		return
	}
	cfg := config.Load()
	full := filepath.Join(cfg.AudioPath, filepath.FromSlash(p))
	http.ServeFile(w, r, full)
}

// ── /api/open ────────────────────────────────────────────────────────────────

func Open(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "path fehlt", http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	full := filepath.Join(cfg.AudioPath, filepath.FromSlash(p))

	f, err := os.Open(full)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if info.IsDir() {
		entries, err := os.ReadDir(full)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		type entry struct {
			Name  string `json:"name"`
			IsDir bool   `json:"is_dir"`
			Size  int64  `json:"size"`
		}
		var items []entry
		for _, e := range entries {
			fi, _ := e.Info()
			size := int64(0)
			if fi != nil {
				size = fi.Size()
			}
			items = append(items, entry{Name: e.Name(), IsDir: e.IsDir(), Size: size})
		}
		writeJSON(w, items)
		return
	}

	data, err := io.ReadAll(f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

// ── /api/save ────────────────────────────────────────────────────────────────

func Save(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := readBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	full := filepath.Join(cfg.AudioPath, filepath.FromSlash(req.Path))
	if err := os.WriteFile(full, []byte(req.Content), 0644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

// ── /api/rename ───────────────────────────────────────────────────────────────

func Rename(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPath string `json:"old_path"`
		NewName string `json:"new_name"`
	}
	if err := readBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	base := cfg.AudioPath
	oldFull := filepath.Join(base, filepath.FromSlash(req.OldPath))
	newFull := filepath.Join(filepath.Dir(oldFull), req.NewName)

	if err := os.Rename(oldFull, newFull); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// DB-Pfad aktualisieren
	oldRel := req.OldPath
	newRel := filepath.ToSlash(strings.TrimPrefix(newFull, base+string(os.PathSeparator)))

	info, err := os.Stat(newFull)
	if err == nil && info.IsDir() {
		db.UpdatePathPrefix(oldRel+"/", newRel+"/", filepath.Base(newFull))
	} else {
		db.UpdatePath(oldRel, newRel)
	}
	db.BumpVersion()
	hub.Notify("done:" + fmt.Sprintf("%d", mustCount()))
	writeJSON(w, map[string]string{"status": "ok", "new_path": newRel})
}

// ── /api/copy ────────────────────────────────────────────────────────────────

func Copy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Paths  []string `json:"paths"`
		Target string   `json:"target"`
	}
	if err := readBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	base := cfg.AudioPath

	go func() {
		total := len(req.Paths)
		rootFolder := time.Now().Format("2006-01-02") + "_Aufnahmen"
		for i, rel := range req.Paths {
			src := filepath.Join(base, filepath.FromSlash(rel))
			dst := filepath.Join(req.Target, rootFolder, filepath.FromSlash(rel))
			if srcInfo, err := os.Stat(src); err == nil {
				if dstInfo, err := os.Stat(dst); err == nil && dstInfo.Size() == srcInfo.Size() {
					pct := int(float64(i+1) / float64(total) * 100)
					hub.Notify(fmt.Sprintf("copy_progress:%d:%d:%d", pct, i+1, total))
					continue
				}
			}
			if err := copyFile(src, dst); err != nil {
				slog.Warn("Kopieren fehlgeschlagen", "datei", rel, "err", err)
				hub.Notify(fmt.Sprintf("copy_error:%s", rel))
				continue
			}
			pct := int(float64(i+1) / float64(total) * 100)
			hub.Notify(fmt.Sprintf("copy_progress:%d:%d:%d", pct, i+1, total))
		}
		hub.Notify(fmt.Sprintf("copy_done:%d", total))
	}()

	writeJSON(w, map[string]string{"status": "gestartet"})
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// ── /api/usb ─────────────────────────────────────────────────────────────────

func USB(w http.ResponseWriter, r *http.Request) {
	drives := usb.GetDrives()
	if drives == nil {
		drives = []usb.Drive{}
	}
	writeJSON(w, drives)
}

// ── /api/verse ───────────────────────────────────────────────────────────────

func Verse(w http.ResponseWriter, r *http.Request) {
	v := verse.Get()
	writeJSON(w, v)
}

// ── /api/pick-folder ─────────────────────────────────────────────────────────

func PickFolder(w http.ResponseWriter, r *http.Request) {
	dir, err := pickFolderDialog()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"path": dir})
}

// ── /api/ui-settings ─────────────────────────────────────────────────────────

func GetUISettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, config.LoadUI())
}

func PostUISettings(w http.ResponseWriter, r *http.Request) {
	var m map[string]any
	if err := readBody(r, &m); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := config.SaveUI(m); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	hub.Notify("ui_settings")
	writeJSON(w, map[string]string{"status": "ok"})
}

// ── /api/config ───────────────────────────────────────────────────────────────

func GetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, config.Load())
}

func PostConfig(w http.ResponseWriter, r *http.Request) {
	var c config.Config
	if err := readBody(r, &c); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := config.Save(c); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

// ── /api/auth ────────────────────────────────────────────────────────────────

func Auth(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := readBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	if cfg.SettingsPassword == "" || req.Password == cfg.SettingsPassword {
		writeJSON(w, map[string]bool{"ok": true})
	} else {
		writeJSON(w, map[string]bool{"ok": false})
	}
}

// ── /api/webdav/* ────────────────────────────────────────────────────────────

func WebDavList(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	items, err := webdav.List(p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, items)
}

func WebDavStream(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	webdav.Stream(w, r, p)
}

func WebDavPut(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if err := webdav.Put(p, r.Body); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func WebDavTest(w http.ResponseWriter, r *http.Request) {
	count, err := webdav.Test()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]int{"count": count})
}

// ── helpers ──────────────────────────────────────────────────────────────────

func mustCount() int {
	n, _ := db.Count()
	return n
}

// SSE-Broadcast für USB-Erkennung (aufgerufen vom Watchdog-Ticker in main.go)
func NotifyUSB() {
	drives := usb.GetDrives()
	b, _ := json.Marshal(drives)
	hub.Notify("usb:" + string(b))
}

// StartUSBPoller startet den 5-Sekunden-USB-Polling-Ticker.
func StartUSBPoller() {
	go func() {
		var last string
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for range t.C {
			drives := usb.GetDrives()
			b, _ := json.Marshal(drives)
			s := string(b)
			if s != last {
				hub.Notify("usb:" + s)
				last = s
			}
		}
	}()
}

// ── /api/client-command ───────────────────────────────────────────────────────

func ClientCommand(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cmd string `json:"cmd"`
	}
	if err := readBody(r, &req); err != nil || req.Cmd == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	switch req.Cmd {
	case "fullscreen", "reload", "exit":
		hub.Notify("client:" + req.Cmd)
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "unknown command", http.StatusBadRequest)
	}
}
