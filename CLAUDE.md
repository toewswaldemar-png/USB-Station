# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FileStation v2** – A self-hosted audio file management app. A Go backend indexes MP3 files from a local directory into SQLite, watches for changes in real time, and serves a React frontend. A separate **CopyCenter** desktop client (`copycenter.exe`) uses Go + WebView2 to wrap the web UI for kiosk use on a different machine.

The UI language is German throughout (labels, log messages, comments).

The `backend/` (Python/FastAPI) and `frontend/` (Vue 3) directories are **deprecated** and no longer used.

## Verzeichnisstruktur

```
USB-Station/
├── _build/
│   ├── Server/          ← filestation.exe + config.json + ui_settings.json + filestation.db
│   └── CopyCenter/      ← copycenter.exe + copycenter.json
├── frontend-react/      ← React-Quellcode
├── filestation-go/      ← Go-Quellcode
├── config.example.json  ← Vorlage für _build/Server/config.json
└── starten.bat
```

Laufzeitkonfiguration (`config.json`, `ui_settings.json`, `filestation.db`) liegt in `_build/Server/` (Produktion) bzw. `filestation-go/` (Dev mit `air`/`go run`).

## Running the App

**Production (full stack):**
```bat
starten.bat
```
Builds the React frontend into `filestation-go/webembed/web/`, compiles `_build/Server/filestation.exe` and `_build/CopyCenter/copycenter.exe`, then starts the server from `_build/Server/` at `http://localhost:8000`.

**Development (split servers):**
```powershell
# Terminal 1 – Go backend (API), config aus filestation-go/config.json
cd filestation-go
go run ./cmd/server
# or with hot-reload:
air

# Terminal 2 – React frontend (Vite dev server with HMR)
cd frontend-react
npm run dev
```
Vite proxies `/api/*` to `http://localhost:8000` in dev mode.

**Frontend build only:**
```powershell
cd frontend-react
npm run build   # outputs to ../filestation-go/webembed/web/
```

**Lint:**
```powershell
cd frontend-react
npm run lint
```

**Go tests** (date extraction logic):
```powershell
cd filestation-go
go test ./internal/scan -v
```

**CopyCenter kiosk client:**
```powershell
# Nach dem Build: _build/CopyCenter/copycenter.exe ausführen
# copycenter.json in _build/CopyCenter/ anpassen (server_url)
```

## Architecture

### Backend (`filestation-go/`)

| Module | Responsibility |
|---|---|
| `cmd/server/main.go` | Entry point: initializes config, DB, SSE hub, watcher, USB poller; serves on `:8000` |
| `internal/api/routes.go` | All HTTP handler registrations (Go 1.22 `net/http` ServeMux with method+path patterns) |
| `internal/db/db.go` | SQLite (WAL mode, `modernc.org/sqlite`). Table `files` keyed by relative path; atomic `_version` counter + ETag for cache invalidation |
| `internal/scan/` | Incremental scan with 8-worker goroutine pool; `date.go` extracts dates (ISO → 8-digit → German `DD.MM.YYYY` → 6-digit → year-only → ID3 fallback); unit tests in `date_test.go` |
| `internal/watch/watch.go` | `fsnotify` watcher with per-path debounce + 5-minute reconcile loop (safety net for missed events) |
| `internal/sse/sse.go` | Hub: `Register`/`Unregister` channels, `Notify()`, 30 s ping keepalive |
| `internal/usb/` | Windows: `GetLogicalDrives`+`GetDriveTypeW` syscalls; Linux: glob `/media` |
| `internal/config/config.go` | `config.json` + `ui_settings.json` with `sync.RWMutex` |
| `internal/verse/verse.go` | Daily Bible verse (getbible.net API + local fallback) |
| `internal/webdav/webdav.go` | PROPFIND proxy; SSL verification disabled for self-signed NAS certs |
| `webembed/webembed.go` | `//go:embed all:web` for the built React frontend |

**File cache invalidation**: `_db_version` counter incremented on every DB write. Frontend checks `/api/version` before fetching `/api/files` (gzip JSON, ETag-cached).

**Date extraction order** (`internal/scan/date.go`): ISO `YYYY-MM-DD` → 8-digit `YYYYMMDD` → German `DD.MM.YYYY` → 6-digit `YYMMDD` → year-only → ID3 `TDRC` tag.

### Frontend (`frontend-react/src/`)

React 19 + TypeScript + Zustand + Tailwind CSS v4.

**Stores:**
- `filesStore.ts` – all MP3 records; two-layer cache: IndexedDB (`idbGet`/`idbSet`) for instant load + `/api/version` check before network fetch. `set()` is called before `idbSet()` to avoid blocking on IDB errors.
- `selectionStore.ts` – selected file paths with group-level and file-level filter logic; `effectivePaths` is what gets copied
- `uiSettingsStore.ts` – visual customization (color presets, fonts, calendar options); auto-saves with 400 ms debounce
- `configStore.ts` – audio path and server config
- `webdavStore.ts` – WebDAV directory listing and navigation state

**Key components:**
- `App.tsx` – root layout; owns SSE connection (3 s reconnect); passes `sseMsg: { data: string }` prop (object wrapper, not plain string — ensures React re-renders even when two consecutive SSE messages carry identical text)
- `CalendarView.tsx` – month grid; files grouped by `groupKey()` (date + folder name), max 2 entries per day cell
- `ExplorerView.tsx` – folder tree browser with virtual scrolling (`@tanstack/react-virtual`) and rubber-band selection
- `SettingsView.tsx` – overlay panel; uses `sseMsg` + `useRef(scanStarted)` to detect scan completion and call `refreshFiles()`
- `SelectionPanel.tsx` – accordion list of selected groups in sidebar; one group open at a time

**Accent color**: CSS variables `--accent`, `--accent-l`, `--accent-xl` set globally from `uiSettingsStore.calColorPreset`. All themed elements use these variables.

**`groupKey(f)`** (in `lib/groupKey.ts`): returns `f.date + ' ' + (f.folder || f.title)` — used as the grouping key in both the calendar and the selection panel.

### WebDAV Proxy

Routes: `GET /api/webdav/list`, `GET /api/webdav/stream`, `PUT /api/webdav/put`, `GET /api/webdav/test`. Credentials read from `config.json` at request time.

### CopyCenter (`cmd/copycenter/main.go`)

Go + `go-webview2` (no CGO). Reads `copycenter.json` for `server_url`. Polls every 1 s until `/api/config` is reachable, then loads the app; polls every 30 s while connected.

## Key API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files` | All indexed MP3s (gzip JSON, ETag-cached) |
| GET | `/api/version` | DB version counter (cache check) |
| GET | `/api/events` | SSE stream: `done:<count>`, `progress:<pct>:<done>:<total>`, `reload`, `usb`, `copy:...` |
| GET | `/api/scan` | Trigger incremental rescan |
| POST | `/api/scan/cancel` | Cancel running scan |
| GET | `/api/stream?path=` | Stream an MP3 file |
| GET | `/api/usb` | List USB drives |
| POST | `/api/copy` | Copy selected files to USB |
| GET/POST | `/api/config` | Read/write config |
| GET/POST | `/api/ui-settings` | Read/write UI settings |
| POST | `/api/rename` | Rename file or folder (atomic DB update) |
| GET | `/api/verse` | Daily Bible verse |
