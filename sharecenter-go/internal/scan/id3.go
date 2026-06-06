package scan

import (
	"fmt"
	"os"

	"github.com/dhowden/tag"
)

type ID3Info struct {
	Title  string
	Artist string
	Album  string
	Date   string
}

func ReadID3(filepath string) ID3Info {
	f, err := os.Open(filepath)
	if err != nil {
		return ID3Info{}
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		return ID3Info{}
	}

	info := ID3Info{
		Title:  m.Title(),
		Artist: m.Artist(),
		Album:  m.Album(),
	}

	// TDRC als Datumsquelle versuchen
	raw := m.Raw()
	if tdrc, ok := raw["TDRC"]; ok {
		info.Date = ExtractDate(fmt.Sprintf("%v", tdrc))
	}

	return info
}
