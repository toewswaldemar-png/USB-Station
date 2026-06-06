//go:build !windows

package usb

import (
	"os"
	"path/filepath"
	"syscall"
)

// GetDrives listet USB-Laufwerke unter Linux/macOS auf.
func GetDrives() []Drive {
	patterns := []string{"/media/*/*", "/run/media/*/*", "/mnt/usb*"}
	var drives []Drive
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern)
		for _, p := range matches {
			fi, err := os.Stat(p)
			if err != nil || !fi.IsDir() {
				continue
			}
			var stat syscall.Statfs_t
			if err := syscall.Statfs(p, &stat); err != nil {
				continue
			}
			total := stat.Blocks * uint64(stat.Bsize)
			free := stat.Bfree * uint64(stat.Bsize)
			drives = append(drives, Drive{
				Label: filepath.Base(p),
				Path:  p,
				Free:  free,
				Total: total,
			})
		}
	}
	return drives
}
