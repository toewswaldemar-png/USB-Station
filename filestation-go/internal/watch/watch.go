package watch

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"filestation/internal/db"
	"filestation/internal/scan"
)

type Watcher struct {
	base        string
	w           *fsnotify.Watcher
	timers      sync.Map // key → *time.Timer
	notify      scan.NotifyFunc
	onDirChange func(string) // wird mit dem Elternordner jedes FS-Events aufgerufen
	done        chan struct{}
}

// Start überwacht basePath rekursiv auf Dateiänderungen.
func Start(basePath string, notify scan.NotifyFunc, onDirChange func(string)) (*Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	watcher := &Watcher{base: filepath.Clean(basePath), w: w, notify: notify, onDirChange: onDirChange, done: make(chan struct{})}

	watcher.setupWatcher(filepath.Clean(basePath))

	go watcher.loop()
	go watcher.reconcileLoop()

	slog.Info("Watchdog gestartet", "pfad", basePath)
	return watcher, nil
}

func (watcher *Watcher) loop() {
	for {
		select {
		case event, ok := <-watcher.w.Events:
			if !ok {
				return
			}
			watcher.handleEvent(event)
		case err, ok := <-watcher.w.Errors:
			if !ok {
				return
			}
			slog.Warn("Watchdog-Fehler", "err", err)
		}
	}
}

func (watcher *Watcher) handleEvent(event fsnotify.Event) {
	path := filepath.Clean(event.Name)
	isMP3 := strings.HasSuffix(strings.ToLower(path), ".mp3")

	if watcher.onDirChange != nil {
		watcher.onDirChange(filepath.Dir(path))
	}

	switch {
	case event.Has(fsnotify.Create):
		fi, err := os.Stat(path)
		if err != nil {
			return
		}
		if fi.IsDir() {
			watcher.addNewDir(path)
			watcher.debounce(path+":dir", 1*time.Second, func() {
				watcher.scanDir(path)
				watcher.reconcile()
			})
		} else if isMP3 {
			watcher.debounce(path, 1500*time.Millisecond, func() { watcher.upsert(path) })
		}

	case event.Has(fsnotify.Write):
		if isMP3 {
			watcher.debounce(path, 1500*time.Millisecond, func() { watcher.upsert(path) })
		}

	case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
		fi, err := os.Stat(path)
		isDir := err == nil && fi.IsDir()
		if isDir {
			watcher.debounce(path+":del", 500*time.Millisecond, func() { watcher.deleteDir(path) })
		} else if isMP3 {
			watcher.debounce(path+":del", 500*time.Millisecond, func() { watcher.deleteFile(path) })
		} else if filepath.Ext(path) == "" {
			// Ordner wurde umbenannt/entfernt – vollständigen Scan auslösen
			watcher.debounce("__rescan__", 2*time.Second, func() {
				go scan.Incremental(watcher.base, watcher.notify)
			})
		}
	}
}

func (watcher *Watcher) debounce(key string, delay time.Duration, fn func()) {
	if t, ok := watcher.timers.Load(key); ok {
		t.(*time.Timer).Stop()
	}
	timer := time.AfterFunc(delay, func() {
		watcher.timers.Delete(key)
		fn()
	})
	watcher.timers.Store(key, timer)
}

// notifyDone sendet ein einzelnes "done:"-SSE nach 500 ms Stille —
// bündelt mehrere schnelle DB-Änderungen zu einer einzigen Frontend-Aktualisierung.
func (watcher *Watcher) notifyDone() {
	watcher.debounce("__done__", 500*time.Millisecond, func() {
		count, _ := db.Count()
		watcher.notify("done:" + itoa(count))
	})
}

func (watcher *Watcher) upsert(path string) {
	fi, err := os.Stat(path)
	if err != nil {
		return
	}
	mtime := float64(fi.ModTime().UnixNano()) / 1e9
	f, err := scan.ProcessFile(path, watcher.base, mtime)
	if err != nil {
		slog.Warn("Watchdog upsert-Fehler", "datei", filepath.Base(path), "err", err)
		return
	}
	db.Upsert(f)
	watcher.notifyDone()
	slog.Info("Watchdog: Datei aktualisiert", "datei", filepath.Base(path))
}

func (watcher *Watcher) deleteFile(path string) {
	rel := filepath.ToSlash(strings.TrimPrefix(path, watcher.base+string(os.PathSeparator)))
	exists, _ := db.Exists(rel)
	if !exists {
		return
	}
	db.Delete(rel)
	watcher.notifyDone()
	slog.Info("Watchdog: Datei gelöscht", "datei", filepath.Base(path))
}

func (watcher *Watcher) deleteDir(dirPath string) {
	rel := filepath.ToSlash(strings.TrimPrefix(dirPath, watcher.base+string(os.PathSeparator)))
	n, _ := db.DeletePrefix(rel + "/")
	if n > 0 {
		watcher.notifyDone()
		slog.Info("Watchdog: Ordner gelöscht", "ordner", filepath.Base(dirPath), "dateien", n)
	}
}

func (watcher *Watcher) scanDir(dirPath string) {
	var batch []db.AudioFile
	filepath.WalkDir(dirPath, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".mp3") {
			return nil
		}
		fi, _ := d.Info()
		mtime := float64(fi.ModTime().UnixNano()) / 1e9
		f, err := scan.ProcessFile(path, watcher.base, mtime)
		if err == nil {
			batch = append(batch, f)
		}
		return nil
	})
	if len(batch) > 0 {
		db.UpsertBatch(batch)
		watcher.notifyDone()
		slog.Info("Watchdog: Ordner gescannt", "ordner", filepath.Base(dirPath), "dateien", len(batch))
	}
}

func (watcher *Watcher) reconcile() {
	known, err := db.GetMtimeMap()
	if err != nil {
		return
	}
	fsPaths := make(map[string]struct{})
	filepath.WalkDir(watcher.base, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".mp3") {
			rel := filepath.ToSlash(strings.TrimPrefix(path, watcher.base+string(os.PathSeparator)))
			fsPaths[rel] = struct{}{}
		}
		return nil
	})

	changed := false
	for p := range known {
		if _, ok := fsPaths[p]; !ok {
			db.Delete(p)
			changed = true
		}
	}
	if changed {
		watcher.notifyDone()
	}
}

func (watcher *Watcher) reconcileLoop() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			watcher.reconcile()
		case <-watcher.done:
			return
		}
	}
}

func (watcher *Watcher) Close() {
	close(watcher.done)
	watcher.w.Close()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}
