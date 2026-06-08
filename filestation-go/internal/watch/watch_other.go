//go:build !windows

// Revert: //go:build !windows-Tag entfernen damit diese Datei auf allen Plattformen gilt.

package watch

import (
	"os"
	"path/filepath"
)

// setupWatcher registriert basePath und alle vorhandenen Unterordner bei fsnotify.
// Auf Linux/macOS öffnet inotify keine exklusiven Directory-Handles — kein Rename-Lock.
func (watcher *Watcher) setupWatcher(basePath string) {
	filepath.WalkDir(basePath, func(p string, d os.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			_ = watcher.w.Add(p)
		}
		return nil
	})
}

// addNewDir fügt einen neu erstellten Ordner und seine Unterordner dem Watcher hinzu.
func (watcher *Watcher) addNewDir(dirPath string) {
	filepath.WalkDir(dirPath, func(p string, d os.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			_ = watcher.w.Add(p)
		}
		return nil
	})
}
