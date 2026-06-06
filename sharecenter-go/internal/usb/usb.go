package usb

// Drive repräsentiert ein USB-Laufwerk.
type Drive struct {
	Label string `json:"label"`
	Path  string `json:"path"`
	Free  uint64 `json:"free"`
	Total uint64 `json:"total"`
}
