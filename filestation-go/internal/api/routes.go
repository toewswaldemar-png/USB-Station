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

	userauth "filestation/internal/auth"
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
	mux.HandleFunc("GET /api/search", SearchFiles)
	mux.HandleFunc("GET /api/webdav/list", WebDavList)
	mux.HandleFunc("GET /api/webdav/stream", WebDavStream)
	mux.HandleFunc("PUT /api/webdav/put", WebDavPut)
	mux.HandleFunc("GET /api/webdav/test", WebDavTest)
	mux.HandleFunc("GET /api/list-recursive", ListRecursive)
	mux.HandleFunc("GET /api/capabilities", Capabilities)
	mux.HandleFunc("GET /api/me", Me)

	// Benutzerverwaltung
	mux.HandleFunc("GET /api/setup", GetSetup)
	mux.HandleFunc("POST /api/setup", PostSetup)
	mux.HandleFunc("POST /api/login", LoginHandler)
	mux.HandleFunc("POST /api/logout", LogoutHandler)
	mux.HandleFunc("GET /api/users", GetUsers)
	mux.HandleFunc("POST /api/users", PostUser)
	mux.HandleFunc("PUT /api/users/{id}", PutUser)
	mux.HandleFunc("DELETE /api/users/{id}", DeleteUser)
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

// webdavFolder gibt den konfigurierten WebDAV-Ordnernamen zurück.
// Ist kein Name gesetzt, wird "Cloud" als Standardwert verwendet.
func webdavFolder(cfg config.Config) string {
	if cfg.WebDavFolder != "" {
		return cfg.WebDavFolder
	}
	return "Cloud"
}

// ── /api/stream ───────────────────────────────────────────────────────────────

func Stream(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "path fehlt", http.StatusBadRequest)
		return
	}
	cfg := config.Load()
	// Virtueller Cloud-Ordner → WebDAV-Stream
	if folder := webdavFolder(cfg); strings.HasPrefix(p, folder+"/") {
		webdav.Stream(w, r, strings.TrimPrefix(p, folder+"/"))
		return
	}
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
	folder := webdavFolder(cfg)

	// Virtueller Cloud-Ordner → WebDAV-Listing (nur wenn WebDAV konfiguriert ist)
	if cfg.WebDavURL != "" && (p == folder || strings.HasPrefix(p, folder+"/")) {
		sub := strings.TrimPrefix(strings.TrimPrefix(p, folder), "/")
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
	copyCloudFolder := webdavFolder(cfg)

	go func() {
		total := len(req.Paths)
		rootFolder := time.Now().Format("2006-01-02") + "_Aufnahmen"
		for i, rel := range req.Paths {
			dst := filepath.Join(req.Target, rootFolder, filepath.FromSlash(rel))

			if strings.HasPrefix(rel, copyCloudFolder+"/") {
				// WebDAV-Datei: direkt vom Server herunterladen
				davPath := strings.TrimPrefix(rel, copyCloudFolder+"/")
				if err := copyWebDavFile(davPath, dst); err != nil {
					slog.Warn("WebDAV-Kopieren fehlgeschlagen", "datei", rel, "err", err)
					hub.Notify(fmt.Sprintf("copy_error:%s", rel))
					continue
				}
			} else {
				// Lokale Datei
				src := filepath.Join(base, filepath.FromSlash(rel))
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

// copyWebDavFile lädt eine WebDAV-Datei herunter und speichert sie unter dst.
func copyWebDavFile(davPath, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	rc, err := webdav.Download(davPath)
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, rc)
	return err
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

// ── /api/search ──────────────────────────────────────────────────────────────

func SearchFiles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len([]rune(q)) < 2 {
		writeJSON(w, []db.AudioFile{})
		return
	}
	files, err := db.Search(q, 50)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if files == nil {
		files = []db.AudioFile{}
	}
	writeJSON(w, files)
}

// ── /api/list-recursive ───────────────────────────────────────────────────────
//
// Gibt alle Dateien unterhalb von `path` als flaches Array zurück (nur Cloud/WebDAV).
// Läuft mit bis zu 5 parallelen PROPFIND-Requests; bricht bei >500 Verzeichnissen ab.

func ListRecursive(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	cfg := config.Load()
	folder := webdavFolder(cfg)
	if !strings.HasPrefix(p, folder) {
		http.Error(w, "nur Cloud-Pfade unterstützt", http.StatusBadRequest)
		return
	}
	if cfg.WebDavURL == "" {
		http.Error(w, "WebDAV nicht konfiguriert", http.StatusServiceUnavailable)
		return
	}

	sub := strings.TrimPrefix(strings.TrimPrefix(p, folder), "/")
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

	frontendBase := folder + "/"
	if sub != "" {
		frontendBase = folder + "/" + sub + "/"
	}
	wg.Add(1)
	go walk(sub, frontendBase)
	wg.Wait()

	if results == nil {
		results = []fileEntry{}
	}
	writeJSON(w, results)
}

// ── /api/capabilities ────────────────────────────────────────────────────────

func Capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]bool{"pick_folder": pickFolderSupported()})
}

// ── /api/me ───────────────────────────────────────────────────────────────────

func Me(w http.ResponseWriter, r *http.Request) {
	// Session-basierter Benutzer
	if u := currentUser(r); u != nil {
		writeJSON(w, map[string]string{"role": u.Role, "username": u.Username})
		return
	}
	writeJSON(w, map[string]string{"role": "admin"})
}

// ── /api/setup ────────────────────────────────────────────────────────────────

func GetSetup(w http.ResponseWriter, r *http.Request) {
	n, _ := db.CountUsers()
	writeJSON(w, map[string]bool{"needed": n == 0})
}

func PostSetup(w http.ResponseWriter, r *http.Request) {
	n, _ := db.CountUsers()
	if n > 0 {
		http.Error(w, "bereits eingerichtet", http.StatusForbidden)
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readBody(r, &req); err != nil || req.Username == "" || len(req.Password) < 8 {
		http.Error(w, "Benutzername und Passwort (min. 8 Zeichen) erforderlich", http.StatusBadRequest)
		return
	}
	hash, err := userauth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "interner Fehler", http.StatusInternalServerError)
		return
	}
	u, err := db.CreateUser(req.Username, hash, "admin")
	if err != nil {
		http.Error(w, "Benutzer konnte nicht erstellt werden", http.StatusInternalServerError)
		return
	}
	token, err := userauth.NewSession(u.ID)
	if err != nil {
		http.Error(w, "Session-Fehler", http.StatusInternalServerError)
		return
	}
	setSessionCookie(w, token)
	writeJSON(w, map[string]string{"role": u.Role, "username": u.Username})
}

// ── /api/login ────────────────────────────────────────────────────────────────

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readBody(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	u, token, err := userauth.Login(req.Username, req.Password)
	if err != nil {
		http.Error(w, "Ungültige Zugangsdaten", http.StatusUnauthorized)
		return
	}
	setSessionCookie(w, token)
	writeJSON(w, map[string]string{"role": u.Role, "username": u.Username})
}

// ── /api/logout ───────────────────────────────────────────────────────────────

func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("fs_session")
	if err == nil {
		_ = db.DeleteSession(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: "fs_session", Value: "", Path: "/",
		MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

// ── /api/users ────────────────────────────────────────────────────────────────

func isAdmin(r *http.Request) bool {
	if u := currentUser(r); u != nil {
		return u.Role == "admin"
	}
	return r.Header.Get("X-Role") == "admin" || r.Header.Get("X-Role") == ""
}

func GetUsers(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	users, err := db.ListUsers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, users)
}

func PostUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readBody(r, &req); err != nil || req.Username == "" || len(req.Password) < 8 {
		http.Error(w, "Benutzername und Passwort (min. 8 Zeichen) erforderlich", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = "user"
	}
	hash, err := userauth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "interner Fehler", http.StatusInternalServerError)
		return
	}
	u, err := db.CreateUser(req.Username, hash, req.Role)
	if err != nil {
		http.Error(w, "Benutzername bereits vergeben", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, u)
}

func PutUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "ungültige ID", http.StatusBadRequest)
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readBody(r, &req); err != nil || req.Username == "" {
		http.Error(w, "Benutzername erforderlich", http.StatusBadRequest)
		return
	}
	var hash string
	if req.Password != "" {
		if len(req.Password) < 8 {
			http.Error(w, "Passwort min. 8 Zeichen", http.StatusBadRequest)
			return
		}
		hash, err = userauth.HashPassword(req.Password)
		if err != nil {
			http.Error(w, "interner Fehler", http.StatusInternalServerError)
			return
		}
	}
	if err := db.UpdateUser(id, req.Username, hash, req.Role); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func DeleteUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "ungültige ID", http.StatusBadRequest)
		return
	}
	// Eigenen Account nicht löschbar
	if u := currentUser(r); u != nil && u.ID == id {
		http.Error(w, "eigenen Account nicht löschbar", http.StatusBadRequest)
		return
	}
	if err := db.DeleteUser(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "fs_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   30 * 24 * 60 * 60,
	})
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
