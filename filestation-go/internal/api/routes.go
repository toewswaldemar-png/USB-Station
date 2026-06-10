package api

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"filestation/internal/config"
	"filestation/internal/db"
	dirfs "filestation/internal/fs"
	"filestation/internal/scan"
	"filestation/internal/sse"
	"filestation/internal/usb"
	"filestation/internal/verse"
	"filestation/internal/webdav"
)

var hub *sse.Hub

// dirSvc is the shared DirService instance, set by InitDirService in main.go.
var dirSvc *dirfs.DirService

// InitDirService wires the DirService into the api package.
// Must be called before the HTTP server starts.
func InitDirService(svc *dirfs.DirService) {
	dirSvc = svc
}

func Register(mux *http.ServeMux, h *sse.Hub) {
	hub = h

	mux.HandleFunc("GET /api/files", Files)
	mux.HandleFunc("GET /api/version", Version)
	mux.HandleFunc("GET /api/events", Events)
	mux.HandleFunc("GET /api/scan", Scan)
	mux.HandleFunc("POST /api/scan/cancel", ScanCancel)
	mux.HandleFunc("GET /api/stream", Stream)
	mux.HandleFunc("GET /api/open", Open)
	mux.HandleFunc("GET /api/browse", Browse) // paginated + sorted + filtered + cached
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
	mux.HandleFunc("GET /api/list-recursive", ListRecursive)
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
	// Virtueller "Bruderschaft"-Ordner → WebDAV-Stream
	if strings.HasPrefix(p, "Bruderschaft/") {
		webdav.Stream(w, r, strings.TrimPrefix(p, "Bruderschaft/"))
		return
	}
	cfg := config.Load()
	full := filepath.Join(cfg.AudioPath, filepath.FromSlash(p))
	http.ServeFile(w, r, full)
}

// ── /api/open ─────────────────────────────────────────────────────────────────
//
// Backward-compatible endpoint used by the existing frontend.
// For directories the response is the legacy flat array format.
// Internally it now uses DirService so results are cached and
// os.ReadDir is only called on the first access (or after a change).

func Open(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "path fehlt", http.StatusBadRequest)
		return
	}

	cfg := config.Load()

	// Virtueller "Bruderschaft"-Ordner → WebDAV-Listing
	if p == "Bruderschaft" || strings.HasPrefix(p, "Bruderschaft/") {
		if cfg.WebDavURL == "" {
			http.Error(w, "WebDAV nicht konfiguriert", http.StatusNotFound)
			return
		}
		sub := strings.TrimPrefix(strings.TrimPrefix(p, "Bruderschaft"), "/")
		items, err := webdav.List(sub)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		type cloudEntry struct {
			Name    string `json:"name"`
			IsDir   bool   `json:"is_dir"`
			Size    int64  `json:"size"`
			ModTime string `json:"mod_time"`
		}
		out := make([]cloudEntry, 0, len(items))
		for _, item := range items {
			modStr := item.Modified
			if t, terr := http.ParseTime(item.Modified); terr == nil {
				modStr = t.UTC().Format("2006-01-02T15:04:05Z")
			}
			out = append(out, cloudEntry{Name: item.Name, IsDir: item.IsDir, Size: item.Size, ModTime: modStr})
		}
		writeJSON(w, out)
		return
	}

	full := filepath.Join(cfg.AudioPath, filepath.FromSlash(p))

	// Determine whether path is a file or directory with a single stat.
	info, err := os.Stat(full)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if info.IsDir() {
		if dirSvc == nil {
			http.Error(w, "DirService nicht verfügbar", http.StatusServiceUnavailable)
			return
		}
		// Use DirService: cached, sorted by name, no pagination limit.
		result, err := dirSvc.List(r.Context(), dirfs.ListRequest{
			FullPath: full,
			SortBy:   dirfs.SortName,
			SortAsc:  true,
		})
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				http.Error(w, "Anfrage abgebrochen", http.StatusRequestTimeout)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Keep the legacy array format so the existing frontend keeps working.
		type legacyEntry struct {
			Name    string    `json:"name"`
			IsDir   bool      `json:"is_dir"`
			Size    int64     `json:"size"`
			ModTime time.Time `json:"mod_time"`
		}
		items := make([]legacyEntry, 0, len(result.Entries))
		for _, e := range result.Entries {
			items = append(items, legacyEntry{Name: e.Name, IsDir: e.IsDir, Size: e.Size, ModTime: e.ModTime})
		}
		writeJSON(w, items)
		return
	}

	// File: serve raw content as before.
	f, err := os.Open(full)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

// ── /api/browse ───────────────────────────────────────────────────────────────
//
// High-performance paginated directory listing with caching, server-side
// sorting, and server-side filtering.
//
// Query parameters:
//
//	path    – relative path inside AudioPath (required)
//	offset  – first entry index, 0-based (default 0)
//	limit   – max entries per page (default 200; 0 = all)
//	sort    – "name" | "size" | "modtime" | "type" (default "name")
//	asc     – "true" | "false" (default "true")
//	filter  – case-insensitive substring filter on filename
func Browse(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	p := q.Get("path")
	if p == "" {
		http.Error(w, "path fehlt", http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	full := filepath.Join(cfg.AudioPath, filepath.FromSlash(p))

	offset, _ := strconv.Atoi(q.Get("offset"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 200
	}

	sortBy := dirfs.SortField(q.Get("sort"))
	switch sortBy {
	case dirfs.SortSize, dirfs.SortModTime, dirfs.SortType:
		// valid
	default:
		sortBy = dirfs.SortName
	}
	asc := q.Get("asc") != "false" // default true

	if dirSvc == nil {
		http.Error(w, "DirService nicht verfügbar", http.StatusServiceUnavailable)
		return
	}

	result, err := dirSvc.List(r.Context(), dirfs.ListRequest{
		FullPath: full,
		Offset:   offset,
		Limit:    limit,
		SortBy:   sortBy,
		SortAsc:  asc,
		Filter:   q.Get("filter"),
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			http.Error(w, "Anfrage abgebrochen", http.StatusRequestTimeout)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, result)
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

	// Cache der betroffenen Verzeichnisse invalidieren.
	dirSvc.InvalidateDir(filepath.Dir(oldFull))
	dirSvc.InvalidateDir(filepath.Dir(newFull))

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
		// Zielverzeichnis nach dem Kopieren invalidieren.
		dirSvc.InvalidateDir(req.Target)
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

// ── /api/list-recursive ───────────────────────────────────────────────────────
//
// Gibt alle Dateien unterhalb von `path` als flaches Array zurück (nur Bruderschaft/WebDAV).
// Läuft mit bis zu 5 parallelen PROPFIND-Requests; bricht bei >500 Verzeichnissen ab.

func ListRecursive(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if !strings.HasPrefix(p, "Bruderschaft") {
		http.Error(w, "nur Bruderschaft-Pfade unterstützt", http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	if cfg.WebDavURL == "" {
		http.Error(w, "WebDAV nicht konfiguriert", http.StatusServiceUnavailable)
		return
	}

	sub := strings.TrimPrefix(strings.TrimPrefix(p, "Bruderschaft"), "/")
	ctx := r.Context()

	type fileEntry struct {
		Path    string `json:"path"`
		Name    string `json:"name"`
		Size    int64  `json:"size"`
		ModTime string `json:"mod_time"`
	}

	const maxDirs = 500
	var (
		mu       sync.Mutex
		results  []fileEntry
		dirCount int
		sem      = make(chan struct{}, 5)
		wg       sync.WaitGroup
	)

	var walk func(webdavPath, frontendPrefix string)
	walk = func(webdavPath, frontendPrefix string) {
		defer wg.Done()
		mu.Lock()
		if dirCount >= maxDirs {
			mu.Unlock()
			return
		}
		dirCount++
		mu.Unlock()

		if ctx.Err() != nil {
			return
		}
		sem <- struct{}{}
		items, err := webdav.List(webdavPath)
		<-sem

		if err != nil || ctx.Err() != nil {
			return
		}
		for _, item := range items {
			subWebDav := item.Name
			if webdavPath != "" {
				subWebDav = webdavPath + "/" + item.Name
			}
			frontendPath := frontendPrefix + item.Name
			if item.IsDir {
				wg.Add(1)
				go walk(subWebDav, frontendPath+"/")
			} else {
				modStr := item.Modified
				if t, terr := http.ParseTime(item.Modified); terr == nil {
					modStr = t.UTC().Format("2006-01-02T15:04:05Z")
				}
				mu.Lock()
				results = append(results, fileEntry{
					Path:    frontendPath,
					Name:    item.Name,
					Size:    item.Size,
					ModTime: modStr,
				})
				mu.Unlock()
			}
		}
	}

	frontendBase := "Bruderschaft/"
	if sub != "" {
		frontendBase = "Bruderschaft/" + sub + "/"
	}
	wg.Add(1)
	go walk(sub, frontendBase)
	wg.Wait()

	if results == nil {
		results = []fileEntry{}
	}
	writeJSON(w, results)
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
