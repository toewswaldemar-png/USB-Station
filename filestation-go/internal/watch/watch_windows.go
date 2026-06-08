//go:build windows

// Revert: Diese Datei löschen und den //go:build !windows-Tag aus watch_other.go entfernen.

package watch

import (
	"log/slog"
	"path/filepath"
	"unsafe"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

// Ein Handle auf basePath, ReadDirectoryChangesW mit bWatchSubtree=TRUE.
// Kein Handle auf Unterordner → kein SMB-Rename-Lock.
const wdcFilter = windows.FILE_NOTIFY_CHANGE_FILE_NAME |
	windows.FILE_NOTIFY_CHANGE_DIR_NAME |
	windows.FILE_NOTIFY_CHANGE_LAST_WRITE |
	windows.FILE_NOTIFY_CHANGE_SIZE

const (
	fileActionAdded          uint32 = 1
	fileActionRemoved        uint32 = 2
	fileActionModified       uint32 = 3
	fileActionRenamedOldName uint32 = 4
	fileActionRenamedNewName uint32 = 5
)

func (watcher *Watcher) setupWatcher(basePath string) {
	p, err := windows.UTF16PtrFromString(basePath)
	if err != nil {
		_ = watcher.w.Add(basePath)
		return
	}
	handle, err := windows.CreateFile(
		p,
		windows.FILE_LIST_DIRECTORY,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err != nil {
		slog.Warn("Watchdog: rekursiver Handle fehlgeschlagen, Fallback auf Root", "err", err)
		_ = watcher.w.Add(basePath)
		return
	}
	// I/O abbrechen wenn der Watcher geschlossen wird
	go func() {
		<-watcher.done
		windows.CancelIoEx(handle, nil)
	}()
	go watcher.runWindowsLoop(handle, basePath)
	slog.Info("Watchdog: rekursiver Windows-Watcher aktiv (kein Subdir-Lock)", "pfad", basePath)
}

// addNewDir ist leer — der rekursive Handle erfasst neue Unterordner automatisch.
func (watcher *Watcher) addNewDir(_ string) {}

func (watcher *Watcher) runWindowsLoop(handle windows.Handle, basePath string) {
	defer windows.CloseHandle(handle)
	buf := make([]byte, 64*1024)

	for {
		var n uint32
		err := windows.ReadDirectoryChanges(
			handle,
			&buf[0],
			uint32(len(buf)),
			true, // bWatchSubtree = TRUE — gesamter Verzeichnisbaum
			wdcFilter,
			&n,
			nil,
			0,
		)
		select {
		case <-watcher.done:
			return
		default:
		}
		if err != nil || n == 0 {
			continue
		}

		offset := uintptr(0)
		basePtr := uintptr(unsafe.Pointer(&buf[0]))
		for {
			info := (*windows.FileNotifyInformation)(unsafe.Pointer(basePtr + offset))
			nChars := info.FileNameLength / 2
			name := windows.UTF16ToString(unsafe.Slice(&info.FileName, nChars))
			fullPath := filepath.Join(basePath, filepath.FromSlash(name))

			var op fsnotify.Op
			switch info.Action {
			case fileActionAdded, fileActionRenamedNewName:
				op = fsnotify.Create
			case fileActionRemoved, fileActionRenamedOldName:
				op = fsnotify.Remove
			case fileActionModified:
				op = fsnotify.Write
			}
			if op != 0 {
				watcher.handleEvent(fsnotify.Event{Name: fullPath, Op: op})
			}

			if info.NextEntryOffset == 0 {
				break
			}
			offset += uintptr(info.NextEntryOffset)
		}
	}
}
