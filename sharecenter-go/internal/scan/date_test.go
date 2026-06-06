package scan

import "testing"

func TestExtractDate(t *testing.T) {
	cases := []struct{ input, want string }{
		{"2024-03-15 Vortrag", "2024-03-15"},
		{"20240315_aufnahme", "2024-03-15"},
		{"240315_datei", "2024-03-15"},
		{"Bericht 2023", "2023-01-01"},
		{"keine_zahl_hier", ""},
		{"", ""},
		{"1999-12-31", "1999-12-31"},
		{"Ordner 20230101 rest", "2023-01-01"},
		{"text2024text", "2024-01-01"}, // Jahr ohne Grenze
		// Deutsches Format
		{"15.01.2024 Gottesdienst", "2024-01-15"},
		{"5.1.2024", "2024-01-05"},
		{"01.12.2023 Abendmahlsfeier", "2023-12-01"},
		{"31.03.2022", "2022-03-31"},
	}
	for _, c := range cases {
		got := ExtractDate(c.input)
		if got != c.want {
			t.Errorf("ExtractDate(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestFolderLabel(t *testing.T) {
	cases := []struct{ input, want string }{
		{"2024-03-15 Weihnacht", "Weihnacht"},
		{"2024-03-15", "2024-03-15"}, // nur Datum → Original zurück
		{"Keine Datum", "Keine Datum"},
		{"2024-03-15  Leerzeichen", "Leerzeichen"},
		// Deutsches Format
		{"15.01.2024 Gottesdienst", "Gottesdienst"},
		{"01.12.2023 Abendmahlsfeier", "Abendmahlsfeier"},
	}
	for _, c := range cases {
		got := FolderLabel(c.input)
		if got != c.want {
			t.Errorf("FolderLabel(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}
