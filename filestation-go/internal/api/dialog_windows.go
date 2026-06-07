//go:build windows

package api

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ── COM GUIDs ─────────────────────────────────────────────────────────────────

var (
	clsidFileOpenDialog = windows.GUID{
		Data1: 0xDC1C5A9C, Data2: 0xE88A, Data3: 0x4dde,
		Data4: [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7},
	}
	iidIFileOpenDialog = windows.GUID{
		Data1: 0xD57C7288, Data2: 0xD4AD, Data3: 0x4768,
		Data4: [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60},
	}
)

// ── DLL procs ─────────────────────────────────────────────────────────────────

var (
	ole32          = windows.NewLazySystemDLL("ole32.dll")
	procCoInitEx   = ole32.NewProc("CoInitializeEx")
	procCoUninit   = ole32.NewProc("CoUninitialize")
	procCoCreate   = ole32.NewProc("CoCreateInstance")
	procCoTaskFree = ole32.NewProc("CoTaskMemFree")

	user32                  = windows.NewLazySystemDLL("user32.dll")
	procGetForegroundWindow = user32.NewProc("GetForegroundWindow")
)

// ── IFileOpenDialog vtable offsets ────────────────────────────────────────────
//
// Inheritance: IUnknown(0-2) → IModalWindow(3) → IFileDialog(4-26) → IFileOpenDialog
//
//	2  Release
//	3  Show
//	9  SetOptions
//	20 GetResult
//
// IShellItem:
//
//	2  Release
//	5  GetDisplayName

const (
	mtdRelease    uintptr = 2
	mtdShow       uintptr = 3
	mtdSetOptions uintptr = 9
	mtdGetResult  uintptr = 20
	mtdGetName    uintptr = 5

	fosPickFolders     uint32  = 0x00000020
	fosForceFileSystem uint32  = 0x00000040
	sigdnFileSysPath   uintptr = 0x80058000

	clsctxInprocServer uintptr = 0x1
	coinitApt          uintptr = 0x2

	hrCancelled uintptr = 0x800704C7
)

func comCall(obj uintptr, method uintptr, args ...uintptr) uintptr {
	vtbl := *(*uintptr)(unsafe.Pointer(obj))
	fn := *(*uintptr)(unsafe.Pointer(vtbl + method*unsafe.Sizeof(uintptr(0))))
	all := make([]uintptr, 0, 1+len(args))
	all = append(all, obj)
	all = append(all, args...)
	hr, _, _ := syscall.SyscallN(fn, all...)
	return hr
}

func comRelease(obj *uintptr) {
	if *obj != 0 {
		comCall(*obj, mtdRelease)
		*obj = 0
	}
}

// pickFolderDialog opens an IFileOpenDialog folder picker.
//
// The current foreground window (the browser) is passed as hwndOwner to
// Show(). Windows then treats the dialog as owned by the browser window:
// it appears in front of it, stays there naturally, and Cancel/OK work
// without any manual z-order management.
func pickFolderDialog() (string, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	procCoInitEx.Call(0, coinitApt)
	defer procCoUninit.Call()

	// Capture the foreground window before the dialog opens.
	// Passing it as hwndOwner makes Windows manage the dialog's z-order
	// and modal focus automatically — no polling needed.
	hwndOwner, _, _ := procGetForegroundWindow.Call()

	var dlg uintptr
	if hr, _, _ := procCoCreate.Call(
		uintptr(unsafe.Pointer(&clsidFileOpenDialog)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIFileOpenDialog)),
		uintptr(unsafe.Pointer(&dlg)),
	); int32(hr) < 0 {
		return "", fmt.Errorf("CoCreateInstance: 0x%08X", uint32(hr))
	}
	defer comRelease(&dlg)

	if hr := comCall(dlg, mtdSetOptions, uintptr(fosPickFolders|fosForceFileSystem)); int32(hr) < 0 {
		return "", fmt.Errorf("SetOptions: 0x%08X", uint32(hr))
	}

	hr := comCall(dlg, mtdShow, hwndOwner)
	if hr == hrCancelled {
		return "", nil
	}
	if int32(hr) < 0 {
		return "", fmt.Errorf("Show: 0x%08X", uint32(hr))
	}

	var item uintptr
	if hr := comCall(dlg, mtdGetResult, uintptr(unsafe.Pointer(&item))); int32(hr) < 0 {
		return "", fmt.Errorf("GetResult: 0x%08X", uint32(hr))
	}
	defer comRelease(&item)

	var namePtr uintptr
	if hr := comCall(item, mtdGetName, sigdnFileSysPath, uintptr(unsafe.Pointer(&namePtr))); int32(hr) < 0 {
		return "", fmt.Errorf("GetDisplayName: 0x%08X", uint32(hr))
	}
	defer procCoTaskFree.Call(namePtr)

	return windows.UTF16PtrToString((*uint16)(unsafe.Pointer(namePtr))), nil
}
