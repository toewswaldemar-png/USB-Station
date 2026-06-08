// Package fs implements a high-performance, cached directory listing service
// for the USB-Station file explorer.
//
// Design decisions:
//   - os.ReadDir (never filepath.Walk) — reads exactly one directory level.
//   - On Windows, DirEntry.Info() carries size+mtime at zero extra cost
//     (data already present from FindFirstFile). On Linux/NAS each Info() call
//     issues one lstat() syscall — acceptable because results are cached.
//   - Per-directory RWMutex: concurrent requests for different directories
//     never block each other; only simultaneous first-loads on the same path
//     serialise (and benefit from the same result — no thundering herd).
//   - fsnotify invalidation: cache is cleared immediately on any FS change.
//   - TTL as fallback for NAS paths where fsnotify may miss events.
//   - Context support: long reads are cancelled when the HTTP client disconnects.
//   - Thumbnails are never generated here; that belongs to the worker pool.
package fs

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)


// ─── Public types ──────────────────────────────────────────────────────────────

// SortField identifies the column to sort by.
type SortField string

const (
	SortName    SortField = "name"
	SortSize    SortField = "size"
	SortModTime SortField = "modtime"
	SortType    SortField = "type" // dirs first, then grouped by extension
)

// FileEntry is the JSON-serialisable output representation of one directory entry.
type FileEntry struct {
	Name    string    `json:"name"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
	Ext     string    `json:"ext"` // lowercase, no leading dot; empty for dirs
}

// ListRequest carries all parameters for a directory listing.
type ListRequest struct {
	FullPath string    // absolute path on disk
	Offset   int       // first entry to return (0-based)
	Limit    int       // max entries to return; 0 = no limit (return all)
	SortBy   SortField // default: SortName
	SortAsc  bool      // true = A→Z / oldest→newest / smallest→largest
	Filter   string    // case-insensitive substring match on filename
}

// ListResult is the paginated response.
type ListResult struct {
	Entries       []FileEntry `json:"entries"`
	TotalFiltered int         `json:"total_filtered"` // count after applying Filter
	TotalAll      int         `json:"total_all"`      // raw count in directory
	Offset        int         `json:"offset"`
	Limit         int         `json:"limit"`
	HasMore       bool        `json:"has_more"`
	FromCache     bool        `json:"from_cache"`
}

// ─── Internal cache types ──────────────────────────────────────────────────────

// rawEntry is the compact in-memory representation stored in the cache.
// We avoid holding fs.FileInfo objects (they may reference syscall data).
type rawEntry struct {
	name    string
	size    int64
	modTime time.Time
	isDir   bool
	mode    fs.FileMode
	ext     string // lowercase, no dot
}

// cacheEntry holds the cached state for exactly one directory.
// The per-entry RWMutex allows many concurrent readers (different HTTP requests
// paging through the same directory) while serialising the rare write (reload).
type cacheEntry struct {
	mu         sync.RWMutex
	entries    []rawEntry
	loadedAt   time.Time
	valid      bool // false = fsnotify invalidated; must block-reload before serving
	refreshing bool // true = SWR background-refresh in progress; stale data still served
}

// ─── DirService ────────────────────────────────────────────────────────────────

// DirService provides cached, paginated, sorted directory listings.
// Create one instance at application startup via New(); call Close() on shutdown.
type DirService struct {
	mu      sync.RWMutex           // guards the map (not the entry values)
	entries map[string]*cacheEntry // key = absolute path
	ttl     time.Duration
	watcher *fsnotify.Watcher
	// notify wird bei fsnotify-Ereignissen aufgerufen (externe FS-Änderungen).
	// Gesetzt via SetNotify; darf nil bleiben.
	notify func(string)
}

// New creates a DirService and starts the background fsnotify goroutine.
//
// ttl is the maximum age of a cached listing before it is reloaded from disk.
// 30 s is a safe default for both SSDs and NAS/SMB paths.
func New(ttl time.Duration) (*DirService, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	s := &DirService{
		entries: make(map[string]*cacheEntry),
		ttl:     ttl,
		watcher: w,
	}
	go s.watchLoop()
	return s, nil
}

// Close stops the fsnotify watcher. Call during server shutdown.
func (s *DirService) Close() {
	_ = s.watcher.Close()
}

// SetNotify setzt die Funktion, die bei externen FS-Änderungen aufgerufen wird.
// Wird einmalig nach New() gesetzt, bevor der Server Requests annimmt.
// Typische Verwendung: dirSvc.SetNotify(hub.Notify)
func (s *DirService) SetNotify(fn func(string)) {
	s.notify = fn
}

// InvalidateDir marks a directory as stale so the next request re-reads it.
// Call after rename, copy, delete, or any operation that changes a directory.
func (s *DirService) InvalidateDir(path string) {
	s.mu.RLock()
	e, ok := s.entries[path]
	s.mu.RUnlock()
	if !ok {
		return
	}
	e.mu.Lock()
	e.valid = false
	e.mu.Unlock()
}

// watchLoop receives fsnotify events and invalidates the affected cache entry.
// One goroutine, no per-directory goroutines — minimal overhead.
func (s *DirService) watchLoop() {
	for {
		select {
		case ev, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			// ev.Name is the file that changed; invalidate its containing dir.
			s.InvalidateDir(filepath.Dir(ev.Name))
			// Frontend sofort benachrichtigen — ohne auf den 2-Sekunden-Debounce
			// von watch.go zu warten. App-interne Operationen (Rename, Copy) senden
			// ihr eigenes "done:"-Event; dieser Pfad ist nur für externe Änderungen.
			if s.notify != nil {
				s.notify("dir_invalidated")
			}
		case _, ok := <-s.watcher.Errors:
			if !ok {
				return
			}
			// Non-fatal: TTL covers any missed events (e.g. on NAS).
		}
	}
}

// backgroundRefresh liest ein Verzeichnis neu, ohne die laufende HTTP-Antwort
// zu blockieren. Es wird beim SWR-Muster nach TTL-Ablauf gestartet:
// der Cache liefert sofort veraltete Daten, während dieser Goroutine im
// Hintergrund frische Daten holt und den Eintrag ersetzt.
func (s *DirService) backgroundRefresh(path string) {
	s.mu.RLock()
	e, ok := s.entries[path]
	s.mu.RUnlock()
	if !ok {
		return
	}

	// Nur einen gleichzeitigen Refresh pro Verzeichnis erlauben.
	e.mu.Lock()
	if e.refreshing {
		e.mu.Unlock()
		return
	}
	e.refreshing = true
	e.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	raw, err := readDir(ctx, path)

	e.mu.Lock()
	e.refreshing = false
	if err == nil {
		e.entries = raw
		e.loadedAt = time.Now()
		// valid bleibt true — der Eintrag ist weiterhin verwendbar
	}
	// Bei Fehler: Eintrag intakt lassen; nächster Request versucht es erneut.
	e.mu.Unlock()
}

// ─── Core: get-or-load ─────────────────────────────────────────────────────────

// getOrLoad returns the cached entries for path, loading from disk if necessary.
// The boolean return indicates whether the result came from the cache.
//
// Thread safety uses double-checked locking, which is safe in Go because
// sync.RWMutex provides the required acquire/release memory ordering.
func (s *DirService) getOrLoad(ctx context.Context, path string) ([]rawEntry, bool, error) {

	// ── Fast path (read lock) ──────────────────────────────────────────────
	s.mu.RLock()
	e, exists := s.entries[path]
	s.mu.RUnlock()

	if exists {
		e.mu.RLock()
		valid := e.valid
		ttlExpired := time.Since(e.loadedAt) >= s.ttl
		entries := e.entries
		refreshing := e.refreshing
		e.mu.RUnlock()

		if valid {
			// SWR: Cache-Treffer → sofort zurückgeben.
			// TTL ist kein harter Block mehr, sondern ein Refresh-Signal:
			// wenn abgelaufen und kein Refresh läuft, einmalig im Hintergrund neu laden.
			if ttlExpired && !refreshing {
				go s.backgroundRefresh(path)
			}
			return entries, true, nil
		}
		// valid == false → fsnotify hat den Eintrag invalidiert;
		// wir dürfen keine veralteten Daten servieren → blocking reload folgt.
	}

	// ── Slow path: create or refresh the entry ────────────────────────────
	s.mu.Lock()
	// Re-check after acquiring the write lock — another goroutine may have
	// already created the entry while we were waiting.
	e, exists = s.entries[path]
	if !exists {
		e = &cacheEntry{}
		s.entries[path] = e
		// Watch the directory for changes (best-effort; TTL is the fallback).
		_ = s.watcher.Add(path)
	}
	s.mu.Unlock()

	// Hold the per-entry write lock during the disk read.
	// All concurrent requests for the same path block here and then share
	// the result — no thundering herd, no duplicate os.ReadDir calls.
	e.mu.Lock()
	defer e.mu.Unlock()

	// Third check: hat ein anderer Request während unserer Wartezeit geladen?
	// Mit SWR reicht valid == true — TTL ist kein Blocking-Kriterium mehr.
	if e.valid {
		return e.entries, true, nil
	}

	raw, err := readDir(ctx, path)
	if err != nil {
		return nil, false, err
	}
	e.entries = raw
	e.loadedAt = time.Now()
	e.valid = true
	return raw, false, nil
}

// readDir reads a single directory level and converts os.DirEntry to rawEntry.
//
// Why os.ReadDir and not filepath.Walk:
//   - Walk is recursive — with 100 k files it would read the entire tree.
//   - ReadDir reads exactly the requested level, returning quickly.
//
// Why we call Info() on every entry:
//   - Windows: FindFirstFile already returns name + size + mtime — Info() is free.
//   - Linux/NAS: one lstat() per entry — expensive for 100k files, but we only
//     pay this cost once per TTL window because results go straight into the cache.
//   - Alternative (Linux optimisation): skip Info(), sort only by name/type,
//     and call Info() lazily only for the current page. Implement if NAS latency
//     becomes a problem in practice.
func readDir(ctx context.Context, path string) ([]rawEntry, error) {
	dirEntries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	raw := make([]rawEntry, 0, len(dirEntries))

	for i, de := range dirEntries {
		// Check for cancellation every 500 entries so we stay responsive
		// even when the client disconnects mid-read of a huge directory.
		if i > 0 && i%500 == 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			default:
			}
		}

		r := rawEntry{
			name:  de.Name(),
			isDir: de.IsDir(),
		}

		if fi, ferr := de.Info(); ferr == nil {
			r.size = fi.Size()
			r.modTime = fi.ModTime()
			r.mode = fi.Mode()
		}

		if !de.IsDir() {
			if ext := filepath.Ext(de.Name()); len(ext) > 1 {
				r.ext = strings.ToLower(ext[1:]) // "mp3", "jpg", etc.
			}
		}

		raw = append(raw, r)
	}

	return raw, nil
}

// ─── List: filter → sort → paginate ───────────────────────────────────────────

// List returns a paginated, sorted, filtered listing for req.FullPath.
//
// All three operations work on the in-memory cache; no disk I/O occurs for
// repeat requests within the TTL window.
func (s *DirService) List(ctx context.Context, req ListRequest) (*ListResult, error) {
	raw, fromCache, err := s.getOrLoad(ctx, req.FullPath)
	if err != nil {
		return nil, err
	}

	totalAll := len(raw)

	// ── Filter ─────────────────────────────────────────────────────────────
	filtered := raw
	if req.Filter != "" {
		lower := strings.ToLower(req.Filter)
		filtered = make([]rawEntry, 0, len(raw)/4)
		for i := range raw {
			if strings.Contains(strings.ToLower(raw[i].name), lower) {
				filtered = append(filtered, raw[i])
			}
		}
	}

	totalFiltered := len(filtered)

	// ── Sort (operates on a copy to avoid mutating the cached slice) ────────
	sorted := make([]rawEntry, len(filtered))
	copy(sorted, filtered)
	sortEntries(sorted, req.SortBy, req.SortAsc)

	// ── Paginate ───────────────────────────────────────────────────────────
	limit := req.Limit
	if limit <= 0 {
		limit = len(sorted) // 0 = no limit → return all (backward compat)
	}

	if req.Offset >= len(sorted) {
		return &ListResult{
			Entries:       []FileEntry{},
			TotalFiltered: totalFiltered,
			TotalAll:      totalAll,
			Offset:        req.Offset,
			Limit:         limit,
			HasMore:       false,
			FromCache:     fromCache,
		}, nil
	}

	end := req.Offset + limit
	if end > len(sorted) {
		end = len(sorted)
	}
	page := sorted[req.Offset:end]

	entries := make([]FileEntry, len(page))
	for i, r := range page {
		entries[i] = FileEntry{
			Name:    r.name,
			IsDir:   r.isDir,
			Size:    r.size,
			ModTime: r.modTime,
			Ext:     r.ext,
		}
	}

	return &ListResult{
		Entries:       entries,
		TotalFiltered: totalFiltered,
		TotalAll:      totalAll,
		Offset:        req.Offset,
		Limit:         limit,
		HasMore:       end < totalFiltered,
		FromCache:     fromCache,
	}, nil
}

// ─── Sort ──────────────────────────────────────────────────────────────────────

// sortEntries sorts in-place: directories always precede files, then the
// user-selected field is applied as a secondary sort within each group.
// SliceStable preserves the original os.ReadDir order for equal elements.
func sortEntries(entries []rawEntry, by SortField, asc bool) {
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := &entries[i], &entries[j]

		// Primary: directories before files, regardless of sort field.
		if a.isDir != b.isDir {
			return a.isDir // true sorts before false
		}

		// Secondary: user-selected field.
		var less bool
		switch by {
		case SortSize:
			less = a.size < b.size
		case SortModTime:
			less = a.modTime.Before(b.modTime)
		case SortType:
			less = a.ext < b.ext
		default: // SortName and any unknown value
			less = strings.ToLower(a.name) < strings.ToLower(b.name)
		}

		if asc {
			return less
		}
		return !less
	})
}
