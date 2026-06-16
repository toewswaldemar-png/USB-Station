package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	userauth "filestation/internal/auth"
	"filestation/internal/db"
)

type ctxKey struct{}

func currentUser(r *http.Request) *db.User {
	u, _ := r.Context().Value(ctxKey{}).(*db.User)
	return u
}

// WithAuth schützt alle /api/-Routen außer Login/Logout/Setup.
// Fallback: X-Role-Header (Nginx Proxy Manager) umgeht die Session-Prüfung.
func WithAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Statische Dateien: immer öffentlich
		if !strings.HasPrefix(path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		// Öffentliche API-Endpunkte
		switch path {
		case "/api/login", "/api/logout", "/api/setup":
			next.ServeHTTP(w, r)
			return
		}

		// X-Role-Header Fallback (Nginx Proxy Manager — kein DB-Login)
		if r.Header.Get("X-Role") != "" {
			next.ServeHTTP(w, r)
			return
		}

		// Setup noch nicht abgeschlossen? Geht auch im Kiosk vor — ohne eingerichteten
		// Admin/Audioverzeichnis gibt es nichts sinnvoll anzuzeigen.
		n, _ := db.CountUsers()
		if n == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]bool{"setup": true})
			return
		}

		// Kiosk-Cookie: Login überspringen, aber als Nicht-Admin behandeln
		// (kein Zugriff auf Rename/Benutzerverwaltung/Einstellungen-Aktionen).
		if _, err := r.Cookie("fs_kiosk"); err == nil {
			ctx := context.WithValue(r.Context(), ctxKey{}, &db.User{Role: "user"})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// Session-Cookie prüfen
		cookie, err := r.Cookie("fs_session")
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]bool{"login": true})
			return
		}
		user, err := userauth.ValidateSession(cookie.Value)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]bool{"login": true})
			return
		}

		ctx := context.WithValue(r.Context(), ctxKey{}, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
