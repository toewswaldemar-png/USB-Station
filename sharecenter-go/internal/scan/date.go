package scan

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	reISO   = regexp.MustCompile(`(\d{4})-(\d{2})-(\d{2})`)
	re8Dig  = regexp.MustCompile(`(20\d{2})(\d{2})(\d{2})`)
	reDE    = regexp.MustCompile(`(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})`)
	re6Dig  = regexp.MustCompile(`\d{6}`)
	reYear  = regexp.MustCompile(`(1[89]\d{2}|20[012]\d)`)
	reStrip = regexp.MustCompile(`^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:19|20)\d{2})\s*`)
)

// ExtractDate versucht ein Datum aus einem String zu extrahieren.
// Priorität: ISO → 8-stellig → Deutsch (TT.MM.JJJJ) → 6-stellig → Jahr-only.
func ExtractDate(s string) string {
	if s == "" {
		return ""
	}

	// 1. ISO 8601: YYYY-MM-DD
	if m := reISO.FindStringIndex(s); m != nil {
		sub := reISO.FindStringSubmatch(s[m[0]:])
		return sub[1] + "-" + sub[2] + "-" + sub[3]
	}

	// 2. 8-stellig: YYYYMMDD
	if m := re8Dig.FindStringSubmatchIndex(s); m != nil {
		start := m[0]
		if start > 0 && isDigit(s[start-1]) {
			goto skip8
		}
		end := m[1]
		if end < len(s) && isDigit(s[end]) {
			goto skip8
		}
		sub := re8Dig.FindStringSubmatch(s)
		return sub[1] + "-" + sub[2] + "-" + sub[3]
	}
skip8:

	// 3. Deutsches Format: TT.MM.JJJJ
	if m := reDE.FindStringSubmatch(s); m != nil {
		d, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		if d >= 1 && d <= 31 && mo >= 1 && mo <= 12 {
			return fmt.Sprintf("%s-%02d-%02d", m[3], mo, d)
		}
	}

	// 4. 6-stellig: YYMMDD
	idxs := re6Dig.FindAllStringIndex(s, -1)
	for _, idx := range idxs {
		start, end := idx[0], idx[1]
		if start > 0 && isDigit(s[start-1]) {
			continue
		}
		if end < len(s) && isDigit(s[end]) {
			continue
		}
		seg := s[start:end]
		yr := "20" + seg[0:2]
		mo := seg[2:4]
		dy := seg[4:6]
		if mo >= "01" && mo <= "12" && dy >= "01" && dy <= "31" {
			return yr + "-" + mo + "-" + dy
		}
	}

	// 5. Jahr: 1800-2099
	yearIdxs := reYear.FindAllStringIndex(s, -1)
	for _, idx := range yearIdxs {
		start, end := idx[0], idx[1]
		if start > 0 && isDigit(s[start-1]) {
			continue
		}
		if end < len(s) && isDigit(s[end]) {
			continue
		}
		return s[start:end] + "-01-01"
	}

	return ""
}

// FolderLabel entfernt ein führendes Datum (ISO oder TT.MM.JJJJ) aus einem Ordnernamen.
func FolderLabel(name string) string {
	result := strings.TrimSpace(reStrip.ReplaceAllString(name, ""))
	if result == "" {
		return name
	}
	return result
}

func isDigit(b byte) bool {
	return b >= '0' && b <= '9'
}
