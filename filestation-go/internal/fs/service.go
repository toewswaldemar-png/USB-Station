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
//   - Invalidation via explicit InvalidateDir calls (from watch.go's onDirChange).
//   - TTL as fallback for NAS paths where events may be missed.
//   - Context support: long reads are cancelled when the HTTP client disconnects.
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
)

// ─── Public types ──────────────────────────────────────────────────────────────

type SortField string

const (
	SortName    SortField = "name"
	SortSize    SortField = "size"
	SortModTime SortField = "modtime"
	SortType    SortField = "type"
)

type FileEntry struct {
	Name    string    `json:"name"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
	Ext     string    `json:"ext"`
}

type ListRequest struct {
	FullPath string
	Offset   int
	Limit    int
	SortBy   SortField
	SortAsc  bool
	Filter   string
}

type ListResult struct {
	Entries       []FileEntry `json:"entries"`
	TotalFiltered int         `json:"total_filtered"`
	TotalAll      int         `json:"total_all"`
	Offset        int         `json:"offset"`
	Limit         int         `json:"limit"`
	HasMore       bool        `json:"has_more"`
	FromCache     bool        `json:"from_cache"`
}

// ─── Internal cache types ──────────────────────────────────────────────────────

type rawEntry struct {
	name    string
	size    int64
	modTime time.Time
	isDir   bool
	mode    fs.FileMode
	ext     string
}

type cacheEntry struct {
	mu         sync.RWMutex
	entries    []rawEntry
	loadedAt   time.Time
	valid      bool
	refreshing bool
}

// ─── DirService ────────────────────────────────────────────────────────────────

// DirService provides cached, paginated, sorted directory listings.
// Invalidation is driven externally via InvalidateDir (called by watch.go's onDirChange).
type DirService struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry
	ttl     time.Duration
}

func New(ttl time.Duration) *DirService {
	return &DirService{
		entries: make(map[string]*cacheEntry),
		ttl:     ttl,
	}
}

// Close is a no-op kept for API compatibility.
func (s *DirService) Close() {}

// InvalidateDir marks a directory as stale so the next request re-reads it.
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

func (s *DirService) backgroundRefresh(path string) {
	s.mu.RLock()
	e, ok := s.entries[path]
	s.mu.RUnlock()
	if !ok {
		return
	}

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
	}
	e.mu.Unlock()
}

// ─── Core: get-or-load ─────────────────────────────────────────────────────────

func (s *DirService) getOrLoad(ctx context.Context, path string) ([]rawEntry, bool, error) {
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
			if ttlExpired && !refreshing {
				go s.backgroundRefresh(path)
			}
			return entries, true, nil
		}
	}

	s.mu.Lock()
	e, exists = s.entries[path]
	if !exists {
		e = &cacheEntry{}
		s.entries[path] = e
	}
	s.mu.Unlock()

	e.mu.Lock()
	defer e.mu.Unlock()

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

func readDir(ctx context.Context, path string) ([]rawEntry, error) {
	dirEntries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	raw := make([]rawEntry, 0, len(dirEntries))

	for i, de := range dirEntries {
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
				r.ext = strings.ToLower(ext[1:])
			}
		}

		raw = append(raw, r)
	}

	return raw, nil
}

// ─── List ─────────────────────────────────────────────────────────────────────

func (s *DirService) List(ctx context.Context, req ListRequest) (*ListResult, error) {
	raw, fromCache, err := s.getOrLoad(ctx, req.FullPath)
	if err != nil {
		return nil, err
	}

	totalAll := len(raw)

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

	sorted := make([]rawEntry, len(filtered))
	copy(sorted, filtered)
	sortEntries(sorted, req.SortBy, req.SortAsc)

	limit := req.Limit
	if limit <= 0 {
		limit = len(sorted)
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

func sortEntries(entries []rawEntry, by SortField, asc bool) {
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := &entries[i], &entries[j]

		if a.isDir != b.isDir {
			return a.isDir
		}

		var less bool
		switch by {
		case SortSize:
			less = a.size < b.size
		case SortModTime:
			less = a.modTime.Before(b.modTime)
		case SortType:
			less = a.ext < b.ext
		default:
			less = strings.ToLower(a.name) < strings.ToLower(b.name)
		}

		if asc {
			return less
		}
		return !less
	})
}
