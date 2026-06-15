package config

import (
	"encoding/json"
	"os"
	"sync"
)

var (
	mu         sync.RWMutex
	configPath string
	uiPath     string
)

// Config enthält die persistente Anwendungskonfiguration.
type Config struct {
	AppName          string `json:"app_name,omitempty"`
	AppSubtitle      string `json:"app_subtitle,omitempty"`
	AudioPath        string `json:"audio_path"`
	Port             int    `json:"port,omitempty"`
	SettingsPassword string `json:"settings_password,omitempty"`
	WebDavURL        string `json:"webdav_url,omitempty"`
	WebDavUser       string `json:"webdav_user,omitempty"`
	WebDavPassword   string `json:"webdav_password,omitempty"`
	WebDavFolder     string `json:"webdav_folder,omitempty"`
}

func Init(cfgPath, uiSettingsPath string) {
	configPath = cfgPath
	uiPath = uiSettingsPath
}

func Load() Config {
	mu.RLock()
	defer mu.RUnlock()
	data, err := os.ReadFile(configPath)
	if err != nil {
		return Config{}
	}
	var c Config
	_ = json.Unmarshal(data, &c)
	return c
}

func Save(c Config) error {
	mu.Lock()
	defer mu.Unlock()
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, data, 0644)
}

func LoadUI() map[string]any {
	mu.RLock()
	defer mu.RUnlock()
	data, err := os.ReadFile(uiPath)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return map[string]any{}
	}
	return m
}

func SaveUI(m map[string]any) error {
	mu.Lock()
	defer mu.Unlock()
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(uiPath, data, 0644)
}
