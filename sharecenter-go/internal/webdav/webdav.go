package webdav

import (
	"crypto/tls"
	"encoding/xml"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"

	"sharecenter/internal/config"
)

// Item repräsentiert einen WebDAV-Eintrag.
type Item struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"is_dir"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

func credentials() (baseURL, user, pw string, err error) {
	cfg := config.Load()
	baseURL = strings.TrimRight(cfg.WebDavURL, "/")
	if baseURL == "" {
		return "", "", "", fmt.Errorf("keine WebDAV-URL konfiguriert")
	}
	return baseURL, cfg.WebDavUser, cfg.WebDavPassword, nil
}

func buildURL(baseURL, p string) string {
	if p == "" || p == "/" {
		return baseURL + "/"
	}
	parts := strings.Split(strings.Trim(p, "/"), "/")
	encoded := make([]string, len(parts))
	for i, seg := range parts {
		encoded[i] = url.PathEscape(seg)
	}
	return baseURL + "/" + strings.Join(encoded, "/")
}

// propfindBody ist das PROPFIND-XML-Minimal-Request
const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`

type davResponse struct {
	XMLName  xml.Name  `xml:"response"`
	Href     string    `xml:"href"`
	PropStat []propStat `xml:"propstat"`
}

type propStat struct {
	Prop   prop   `xml:"prop"`
	Status string `xml:"status"`
}

type prop struct {
	DisplayName     string      `xml:"displayname"`
	ResourceType    resType     `xml:"resourcetype"`
	ContentLength   int64       `xml:"getcontentlength"`
	LastModified    string      `xml:"getlastmodified"`
}

type resType struct {
	Collection *struct{} `xml:"collection"`
}

type multiStatus struct {
	XMLName   xml.Name      `xml:"multistatus"`
	Responses []davResponse `xml:"response"`
}

func propfind(baseURL, davPath, user, pw string) ([]Item, error) {
	target := buildURL(baseURL, davPath)

	req, err := http.NewRequest("PROPFIND", target, strings.NewReader(propfindBody))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(user, pw)
	req.Header.Set("Depth", "1")
	req.Header.Set("Content-Type", "application/xml; charset=utf-8")
	req.Header.Set("User-Agent", "ShareCenter/2.0")

	tr := &http.Transport{TLSClientConfig: insecureTLS()}
	client := &http.Client{Transport: tr, Timeout: 10e9}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("WebDAV nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("WebDAV: Ungültige Zugangsdaten (401)")
	}
	if resp.StatusCode == 403 {
		return nil, fmt.Errorf("WebDAV: Zugriff verweigert (403) – App-Passwort verwenden")
	}
	if resp.StatusCode != 207 && resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("WebDAV-Fehler %d: %s", resp.StatusCode, string(body[:min(200, len(body))]))
	}

	var ms multiStatus
	if err := xml.NewDecoder(resp.Body).Decode(&ms); err != nil {
		return nil, fmt.Errorf("WebDAV XML-Fehler: %w", err)
	}

	baseU, _ := url.Parse(baseURL)
	var items []Item
	for i, r := range ms.Responses {
		if i == 0 {
			continue // eigenes Verzeichnis überspringen
		}
		hrefU, _ := url.Parse(r.Href)
		hrefPath := hrefU.Path

		var p prop
		for _, ps := range r.PropStat {
			if strings.Contains(ps.Status, "200") {
				p = ps.Prop
				break
			}
		}

		name := p.DisplayName
		if name == "" {
			name = path.Base(strings.TrimRight(hrefPath, "/"))
		}

		isDir := p.ResourceType.Collection != nil

		// Relativer Pfad zur Basis-URL
		basePath := baseU.Path
		rel := strings.TrimPrefix(hrefPath, basePath)
		rel = strings.Trim(rel, "/")

		items = append(items, Item{
			Name:     name,
			Path:     rel,
			IsDir:    isDir,
			Size:     p.ContentLength,
			Modified: p.LastModified,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items, nil
}

// List gibt den Inhalt eines WebDAV-Verzeichnisses zurück.
func List(davPath string) ([]Item, error) {
	baseURL, user, pw, err := credentials()
	if err != nil {
		return nil, err
	}
	return propfind(baseURL, davPath, user, pw)
}

// Stream gibt einen HTTP-Handler zurück, der eine WebDAV-Datei streamt.
func Stream(w http.ResponseWriter, r *http.Request, davPath string) {
	baseURL, user, pw, err := credentials()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	target := buildURL(baseURL, davPath)
	req, _ := http.NewRequest("GET", target, nil)
	req.SetBasicAuth(user, pw)

	tr := &http.Transport{TLSClientConfig: insecureTLS()}
	client := &http.Client{Transport: tr, Timeout: 30e9}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		http.Error(w, resp.Status, resp.StatusCode)
		return
	}

	filename := path.Base(strings.Trim(davPath, "/"))
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" || contentType == "application/octet-stream" {
		if t := mime.TypeByExtension("." + strings.ToLower(path.Ext(filename))); t != "" {
			contentType = t
		}
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filename))
	io.Copy(w, resp.Body)
}

// Put lädt eine Datei auf den WebDAV-Server hoch.
func Put(davPath string, body io.Reader) error {
	baseURL, user, pw, err := credentials()
	if err != nil {
		return err
	}

	target := buildURL(baseURL, davPath)
	req, err := http.NewRequest("PUT", target, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(user, pw)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("User-Agent", "ShareCenter/2.0")

	tr := &http.Transport{TLSClientConfig: insecureTLS()}
	client := &http.Client{Transport: tr, Timeout: 15e9}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("WebDAV PUT %d: %s", resp.StatusCode, string(b[:min(300, len(b))]))
	}
	return nil
}

// Test prüft die WebDAV-Verbindung.
func Test() (int, error) {
	items, err := List("")
	if err != nil {
		return 0, err
	}
	return len(items), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func insecureTLS() *tls.Config {
	return &tls.Config{InsecureSkipVerify: true} //nolint:gosec
}

func init() {
	slog.Debug("WebDAV-Paket geladen")
}
