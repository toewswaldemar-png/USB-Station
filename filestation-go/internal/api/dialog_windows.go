//go:build windows

package api

import (
	"syscall"
	"time"

	"github.com/sqweek/dialog"
	"golang.org/x/sys/windows"
)

func pickFolderDialog() (string, error) {
	go raiseDialogToFront()
	return dialog.Directory().Title("Audioverzeichnis wählen").Browse()
}

// raiseDialogToFront polls for a visible window owned by this process and sets
// it as always-on-top via SetWindowPos(HWND_TOPMOST).
func raiseDialogToFront() {
	const (
		hwndTopmost = ^uintptr(0) // -1 → HWND_TOPMOST
		swpNoMove   = 0x0002
		swpNoSize   = 0x0001
		swpFlags    = swpNoMove | swpNoSize
	)

	pid := windows.GetCurrentProcessId()

	user32 := windows.NewLazySystemDLL("user32.dll")
	enumWindowsProc := user32.NewProc("EnumWindows")
	setWindowPosProc := user32.NewProc("SetWindowPos")
	setForegroundWindowProc := user32.NewProc("SetForegroundWindow")
	isWindowVisibleProc := user32.NewProc("IsWindowVisible")

	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		var wPid uint32
		windows.GetWindowThreadProcessId(windows.HWND(hwnd), &wPid)
		if wPid != pid {
			return 1
		}
		vis, _, _ := isWindowVisibleProc.Call(hwnd)
		if vis != 0 {
			setWindowPosProc.Call(hwnd, hwndTopmost, 0, 0, 0, 0, swpFlags)
			setForegroundWindowProc.Call(hwnd)
			return 0
		}
		return 1
	})

	for range 15 {
		time.Sleep(80 * time.Millisecond)
		enumWindowsProc.Call(cb, 0)
	}
}
