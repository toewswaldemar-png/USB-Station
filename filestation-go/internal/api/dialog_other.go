//go:build !windows

package api

func pickFolderDialog() (string, error) {
	return "", nil
}

func pickFolderSupported() bool { return false }
