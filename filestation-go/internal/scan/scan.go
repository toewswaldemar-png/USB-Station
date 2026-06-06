package scan

import (
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"filestation/internal/db"
)

const (
	workers     = 8
	batchSize   = 500
	notifyEvery = 50
)

var (
	scanRunning atomic.Int32
	scanCancel  atomic.Int32
)

func IsRunning() bool { return scanRunning.Load() == 1 }
func Cancel()         { scanCancel.Store(1) }

type NotifyFunc func(msg string)

// Incremental führt einen inkrementellen Scan durch.
func Incremental(basePath string, notify NotifyFunc) {
	if !scanRunning.CompareAndSwap(0, 1) {
		slog.Info("Scan läuft bereits, warte...")
		for !scanRunning.CompareAndSwap(0, 1) {
			time.Sleep(200 * time.Millisecond)
		}
	}
	scanCancel.Store(0)
	defer scanRunning.Store(0)

	t0 := time.Now()
	base := filepath.Clean(basePath)

	info, err := os.Stat(base)
	if err != nil || !info.IsDir() {
		slog.Warn("Verzeichnis nicht erreichbar", "pfad", base)
		notify("error:Verzeichnis nicht gefunden")
		notify("done:0")
		return
	}

	known, err := db.GetMtimeMap()
	if err != nil {
		notify("error:Datenbankfehler")
		notify("done:0")
		return
	}

	type fileEntry struct {
		full  string
		rel   string
		mtime float64
	}

	seen := make(map[string]struct{})
	var toScan []fileEntry

	filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".mp3") {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		rel := filepath.ToSlash(strings.TrimPrefix(path, base+string(os.PathSeparator)))
		seen[rel] = struct{}{}
		mtime := float64(fi.ModTime().UnixNano()) / 1e9
		if existingMtime, ok := known[rel]; ok && existingMtime == mtime {
			return nil
		}
		toScan = append(toScan, fileEntry{full: path, rel: rel, mtime: mtime})
		return nil
	})

	// Verwaiste DB-Einträge entfernen
	removed := 0
	for oldPath := range known {
		if _, ok := seen[oldPath]; !ok {
			db.Delete(oldPath)
			removed++
		}
	}

	if len(toScan) == 0 {
		totalInDB, _ := db.Count()
		slog.Info("Scan: keine Änderungen", "dateien", totalInDB, "dauer", time.Since(t0))
		notify("done:" + strconv.Itoa(totalInDB))
		return
	}

	type result struct {
		file db.AudioFile
		err  error
	}

	jobs := make(chan fileEntry, len(toScan))
	results := make(chan result, workers*2)

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				if scanCancel.Load() == 1 {
					continue
				}
				f, err := ProcessFile(job.full, base, job.mtime)
				results <- result{file: f, err: err}
			}
		}()
	}

	go func() {
		for _, job := range toScan {
			jobs <- job
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	added, updated, errors := 0, 0, 0
	done := 0
	lastNotify := 0
	total := len(toScan)
	var batch []db.AudioFile

	for res := range results {
		if res.err != nil {
			errors++
			continue
		}
		if _, exists := known[res.file.Path]; exists {
			updated++
		} else {
			added++
		}
		batch = append(batch, res.file)
		done++

		if done-lastNotify >= notifyEvery || done == total {
			pct := int(float64(done) / float64(total) * 100)
			notify("progress:" + strconv.Itoa(pct) + ":" + strconv.Itoa(done) + ":" + strconv.Itoa(total))
			lastNotify = done
		}

		if len(batch) >= batchSize {
			db.UpsertBatch(batch)
			batch = batch[:0]
		}
	}
	if len(batch) > 0 {
		db.UpsertBatch(batch)
	}

	totalInDB, _ := db.Count()

	if scanCancel.Load() == 1 {
		scanCancel.Store(0)
		slog.Info("Scan abgebrochen", "erledigt", done, "gesamt", total)
		notify("cancelled")
	} else {
		slog.Info("Scan abgeschlossen",
			"neu", added, "geändert", updated, "entfernt", removed,
			"fehler", errors, "dateien", totalInDB, "dauer", time.Since(t0))
		notify("done:" + strconv.Itoa(totalInDB))
	}
}

// ProcessFile ist auch für den Watchdog zugänglich.
func ProcessFile(fullPath, base string, mtime float64) (db.AudioFile, error) {
	fi, err := os.Stat(fullPath)
	if err != nil {
		return db.AudioFile{}, err
	}

	rel := filepath.ToSlash(strings.TrimPrefix(fullPath, base+string(os.PathSeparator)))

	dirName := filepath.Base(filepath.Dir(fullPath))
	folderLabel := ""
	folderDate := ""
	if dirName != "" && dirName != "." {
		folderLabel = FolderLabel(dirName)
		folderDate = ExtractDate(dirName)
	}

	stem := strings.TrimSuffix(filepath.Base(fullPath), filepath.Ext(fullPath))
	fileDate := ExtractDate(stem)
	id3 := ReadID3(fullPath)

	date := folderDate
	if date == "" {
		date = id3.Date
	}
	if date == "" {
		date = fileDate
	}

	title := id3.Title
	if title == "" {
		title = FolderLabel(stem)
	}
	if title == "" {
		title = folderLabel
	}

	album := id3.Album
	if album == "" {
		album = folderLabel
	}

	return db.AudioFile{
		Path:   rel,
		Date:   date,
		Title:  title,
		Folder: folderLabel,
		Artist: id3.Artist,
		Album:  album,
		Size:   fi.Size(),
		Mtime:  mtime,
	}, nil
}
