# ── Stage 1: Frontend (Node) ──────────────────────────────────────────────────
# vite.config.ts baut nach "../filestation-go/webembed/web/" relativ zu frontend-react/.
# Deshalb die Verzeichnisstruktur aus dem Repo nachbauen.
FROM node:22-alpine AS frontend
WORKDIR /workspace/frontend-react
COPY frontend-react/package*.json ./
RUN npm ci
COPY frontend-react/ .
RUN npm run build
# Ergebnis liegt jetzt in /workspace/filestation-go/webembed/web/

# ── Stage 2: Go-Server ────────────────────────────────────────────────────────
FROM golang:1.26-alpine AS builder
ARG VERSION=dev
WORKDIR /build
COPY filestation-go/go.mod filestation-go/go.sum ./
RUN go mod download
COPY filestation-go/ .
# Eingebettete statische Dateien aus Stage 1
COPY --from=frontend /workspace/filestation-go/webembed/web/ ./webembed/web/
RUN CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o filestation ./cmd/server

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM alpine:3.20
# /data wird als Volume gemountet:
#   config.json      – audio_path, port, webdav_*, settings_password
#   ui_settings.json – wird beim ersten Start automatisch angelegt
#   filestation.db   – wird beim ersten Start automatisch angelegt
WORKDIR /data
COPY --from=builder /build/filestation /usr/local/bin/filestation
EXPOSE 58427
CMD ["/usr/local/bin/filestation"]
