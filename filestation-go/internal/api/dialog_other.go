//go:build !windows

package api

import "fmt"

func pickFolderDialog() (string, error) {
	return "", fmt.Errorf("Ordnerwahl nur unter Windows verfügbar")
}
