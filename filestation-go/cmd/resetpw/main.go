package main

import (
	"fmt"
	"os"

	"filestation/internal/auth"
	"filestation/internal/db"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintf(os.Stderr, "Verwendung: resetpw <benutzername> <neues-passwort> [db-pfad]\n")
		os.Exit(1)
	}
	username := os.Args[1]
	password := os.Args[2]
	dbPath := "filestation.db"
	newRole := ""
	if len(os.Args) >= 4 {
		dbPath = os.Args[3]
	}
	if len(os.Args) >= 5 {
		newRole = os.Args[4]
	}
	if len(password) < 8 {
		fmt.Fprintf(os.Stderr, "Passwort muss mindestens 8 Zeichen haben\n")
		os.Exit(1)
	}
	if err := db.Init(dbPath); err != nil {
		fmt.Fprintf(os.Stderr, "DB-Fehler: %v\n", err)
		os.Exit(1)
	}
	u, err := db.GetUserByUsername(username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Benutzer %q nicht gefunden\n", username)
		users, _ := db.ListUsers()
		if len(users) > 0 {
			fmt.Fprintln(os.Stderr, "Vorhandene Benutzer:")
			for _, usr := range users {
				fmt.Fprintf(os.Stderr, "  id=%d  username=%q  role=%s\n", usr.ID, usr.Username, usr.Role)
			}
		}
		os.Exit(1)
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Hash-Fehler: %v\n", err)
		os.Exit(1)
	}
	role := u.Role
	if newRole != "" {
		role = newRole
	}
	if err := db.UpdateUser(u.ID, u.Username, hash, role); err != nil {
		fmt.Fprintf(os.Stderr, "Update-Fehler: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Benutzer %q aktualisiert: rolle=%s\n", u.Username, role)
}
