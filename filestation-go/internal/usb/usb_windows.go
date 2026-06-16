//go:build windows

package usb

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32           = windows.NewLazySystemDLL("kernel32.dll")
	getLogicalDrives   = kernel32.NewProc("GetLogicalDrives")
	getDriveTypeW      = kernel32.NewProc("GetDriveTypeW")
	getVolumeInfoW     = kernel32.NewProc("GetVolumeInformationW")
	getDiskFreeSpaceEx = kernel32.NewProc("GetDiskFreeSpaceExW")
)

const driveRemovable = 2

// GetDrives listet alle USB/Wechsellaufwerke unter Windows auf.
func GetDrives() []Drive {
	bitmask, _, _ := getLogicalDrives.Call()
	drives := []Drive{}

	for i := 0; i < 26; i++ {
		if bitmask&(1<<uint(i)) == 0 {
			continue
		}
		letter := string(rune('A' + i))
		root := letter + `:\`
		rootPtr, _ := syscall.UTF16PtrFromString(root)

		driveType, _, _ := getDriveTypeW.Call(uintptr(unsafe.Pointer(rootPtr)))
		if driveType != driveRemovable {
			continue
		}

		// Volume-Label ermitteln
		var nameBuf [261]uint16
		getVolumeInfoW.Call(
			uintptr(unsafe.Pointer(rootPtr)),
			uintptr(unsafe.Pointer(&nameBuf[0])),
			261,
			0, 0, 0, 0, 0,
		)
		name := syscall.UTF16ToString(nameBuf[:])

		label := fmt.Sprintf("Wechseldatenträger (%s:)", letter)
		if name != "" {
			label = fmt.Sprintf("%s (%s:)", name, letter)
		}

		// Freier Speicher
		var free, total, totalFree uint64
		rootPtr2, _ := syscall.UTF16PtrFromString(root)
		getDiskFreeSpaceEx.Call(
			uintptr(unsafe.Pointer(rootPtr2)),
			uintptr(unsafe.Pointer(&free)),
			uintptr(unsafe.Pointer(&total)),
			uintptr(unsafe.Pointer(&totalFree)),
		)

		drives = append(drives, Drive{
			Label: label,
			Path:  root,
			Free:  free,
			Total: total,
		})
	}
	return drives
}
