# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FileStation v2** – A self-hosted audio file management app. A Go backend indexes MP3 files from a local directory into SQLite, watches for changes in real time, and serves a React frontend. A separate **Client** desktop client (`fileclient.exe`) uses Go + WebView2 to wrap the web UI for kiosk use on a different machine.

The UI language is German throughout (labels, log messages, comments).

The `backend/` (Python/FastAPI) and `frontend/` (Vue 3) directories are **deprecated** and no longer used.

## Verzeichnisstruktur

```
USB-Station/
├── _build/
│   ├── Server/          ← filestation.exe + config.json + ui_settings.json + filestation.db
│   └── Client/      ← fileclient.exe + fileclient.json
├── frontend-react/      ← React-Quellcode
├── filestation-go/      ← Go-Quellcode
├── config.example.json  ← Vorlage für _build/Server/config.json
└── starten.bat
```

Laufzeitkonfiguration (`config.json`, `ui_settings.json`, `filestation.db`) liegt in `_build/Server/` (Produktion) bzw. `filestation-go/` (Dev mit `air`/`go run`).

## Building After Changes

After every code change (TSX, TS, CSS, Go), rebuild in this order — without waiting to be asked:

```powershell
Stop-Process -Name "filestation" -ErrorAction SilentlyContinue
cd frontend-react; npm run build
cd ..\filestation-go; go build -o ..\_build\Server\filestation.exe ./cmd/server
```

**Windows .exe lock:** A running `filestation.exe` prevents `go build` from overwriting it. The build appears to succeed (no error output) but the binary keeps its old timestamp. Always stop the process first and verify the timestamp afterward with `Get-Item ..\_build\Server\filestation.exe | Select-Object LastWriteTime`.

## Running the App

**Production (full stack):**
```bat
starten.bat
```
Builds the React frontend into `filestation-go/webembed/web/`, compiles `_build/Server/filestation.exe` and `_build/Client/fileclient.exe`, then starts the server from `_build/Server/` at `http://localhost:8000`.

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

**Client kiosk client:**
```powershell
# Nach dem Build: _build/Client/fileclient.exe ausführen
# _build/Client/config.json anpassen: {"server_url": "http://HOST:8000"}
```

## Architecture

### Backend (`filestation-go/`)

| Module | Responsibility |
|---|---|
| `cmd/server/main.go` | Entry point: initializes config, DB, SSE hub, watcher, USB poller; serves on `:8000` |
| `internal/api/routes.go` | All HTTP handler registrations (Go 1.22 `net/http` ServeMux with method+path patterns) |
| `internal/db/db.go` | SQLite (WAL mode, `modernc.org/sqlite`). Table `files` keyed by relative path; atomic `_version` counter + ETag for cache invalidation |
| `internal/scan/` | Incremental scan with 8-worker goroutine pool; `date.go` extracts dates (ISO → 8-digit → German `DD.MM.YYYY` → 6-digit → year-only → ID3 fallback); unit tests in `date_test.go` |
| `internal/fs/service.go` | `DirService`: cached directory listings (TTL + fsnotify), SWR background-refresh, per-directory RWMutex, `os.ReadDir`-based (never recursive). Used by `Open` and `Browse` handlers. |
| `internal/watch/watch.go` | `fsnotify` watcher: watches all subdirs recursively, per-path debounce, 10-min reconcile loop (safety net). Fires `dir_invalidated` SSE via DirService callback on external FS changes. |
| `internal/sse/sse.go` | Hub: `Register`/`Unregister` channels, `Notify()`, 30 s ping keepalive |
| `internal/usb/` | Windows: `GetLogicalDrives`+`GetDriveTypeW` syscalls; Linux/macOS: glob `/media/*/*`, `/run/media/*/*`, `/mnt/usb*` |
| `internal/config/config.go` | `config.json` + `ui_settings.json` with `sync.RWMutex` |
| `internal/verse/verse.go` | Daily Bible verse (getbible.net API + local fallback) |
| `internal/webdav/webdav.go` | PROPFIND proxy; SSL verification disabled for self-signed NAS certs |
| `webembed/webembed.go` | `//go:embed all:web` for the built React frontend |

**File cache invalidation**: `_db_version` counter incremented on every DB write. Frontend checks `/api/version` before fetching `/api/files` (gzip JSON, ETag-cached).

**Date extraction order** (`internal/scan/date.go`): ISO `YYYY-MM-DD` → 8-digit `YYYYMMDD` → German `DD.MM.YYYY` → 6-digit `YYMMDD` → year-only → ID3 `TDRC` tag.

### Frontend (`frontend-react/src/`)

React 19 + TypeScript + Zustand + Tailwind CSS v4.

**Stores:**
- `filesStore.ts` – all MP3 records; two-layer cache: IndexedDB (`idbGet`/`idbSet`) for instant load + `/api/version` check before network fetch. Also maintains a pre-built `filesByYearMonth: Map<ym, Map<groupKey, AudioFile[]>>` index used by `CalendarView`. `set()` is called before `idbSet()` to avoid blocking on IDB errors.
- `selectionStore.ts` – selected file paths with group-level and file-level filter logic; `effectivePaths` is what gets copied
- `uiSettingsStore.ts` – visual customization (color presets, fonts, calendar options); auto-saves with 400 ms debounce
- `configStore.ts` – audio path and server config
- `webdavStore.ts` – WebDAV directory listing and navigation state

**Hooks (`src/hooks/`):**
- `useSSE.ts` – opens `EventSource('/api/events')` with 3 s reconnect; called by `App.tsx` with a callback
- `useUsbDrives.ts` – subscribes to USB SSE events and exposes the current drive list
- `useClock.ts` – live clock ticker for the header

**Key components:**
- `App.tsx` – root layout; uses `useSSE` hook; handles `done:` → `refreshFiles()`, `ui_settings` → `loadUI()`, `connected` → `refreshFiles()` (if empty); passes `sseMsg: { data: string }` prop (object wrapper, not plain string — ensures React re-renders even when two consecutive SSE messages carry identical text)
- `calendar/CalendarView.tsx` – month grid; reads `filesByYearMonth` from filesStore; files grouped by `groupKey()` (date + folder name), max 2 entries per day cell
- `explorer/ExplorerView.tsx` – folder tree browser with virtual scrolling (`@tanstack/react-virtual`) and rubber-band selection
- `settings/SettingsView.tsx` – overlay panel; uses `sseMsg` + `useRef(scanStarted)` to detect scan completion and call `refreshFiles()`
- `sidebar/SelectionPanel.tsx` – accordion list of selected groups in sidebar; one group open at a time

**Accent color**: CSS variables `--accent`, `--accent-l`, `--accent-xl` set globally from `uiSettingsStore.calColorPreset`. All themed elements use these variables.

**`groupKey(f)`** (in `lib/groupKey.ts`): returns `f.date + ' ' + (f.folder || f.title)` — used as the grouping key in both the calendar and the selection panel.

### WebDAV Proxy

Routes: `GET /api/webdav/list`, `GET /api/webdav/stream`, `PUT /api/webdav/put`, `GET /api/webdav/test`. Credentials read from `config.json` at request time.

### Client (`cmd/fileclient/main.go`)

Go + `go-webview2` (no CGO). Reads `config.json` (key `server_url`) from its working directory (`_build/Client/`). Polls every 1 s until `/api/config` is reachable, then loads the app; polls every 30 s while connected.

**Kiosk shortcut:** `Ctrl+Alt+Q` exits the kiosk window cleanly (normal window controls are hidden in kiosk mode).

## Key API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files` | All indexed MP3s (gzip JSON, ETag-cached) |
| GET | `/api/version` | DB version counter (cache check) |
| GET | `/api/events` | SSE stream: `done:<count>`, `progress:<pct>:<done>:<total>`, `reload`, `usb:<json>`, `copy_progress:<pct>:<done>:<total>`, `copy_error:<rel>`, `copy_done:<total>`, `ui_settings`, `connected`, `client:<cmd>`, `dir_invalidated` |
| GET | `/api/scan` | Trigger incremental rescan |
| POST | `/api/scan/cancel` | Cancel running scan |
| GET | `/api/stream?path=` | Stream an MP3 file; prefix `__cloud__/` for WebDAV |
| GET | `/api/open?path=` | Read text file content or directory listing (JSON, legacy flat array) — backed by DirService cache |
| GET | `/api/browse?path=&offset=&limit=&sort=&asc=&filter=` | Paginated directory listing with server-side sort + filter; `sort`: `name`\|`size`\|`modtime`\|`type` |
| POST | `/api/save` | Write text file content |
| GET | `/api/usb` | List USB drives |
| POST | `/api/copy` | Copy selected files to USB (async, progress via SSE) |
| GET/POST | `/api/config` | Read/write config |
| GET/POST | `/api/ui-settings` | Read/write UI settings; POST broadcasts `ui_settings` SSE |
| POST | `/api/rename` | Rename file or folder; updates DB + bumps version |
| POST | `/api/auth` | Verify settings password (`{"password":"..."}` → `{"ok":bool}`) |
| GET | `/api/pick-folder` | Native OS folder picker dialog (Windows: IFileDialog; other: no-op) |
| POST | `/api/client-command` | Send `fullscreen`/`reload`/`exit` command to kiosk client via SSE |
| GET | `/api/verse` | Daily Bible verse |
