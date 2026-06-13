package db

import (
	"errors"
	"time"
)

// User repräsentiert einen Benutzer in der Datenbank.
type User struct {
	ID           int64  `db:"id"            json:"id"`
	Username     string `db:"username"      json:"username"`
	PasswordHash string `db:"password_hash" json:"-"`
	Role         string `db:"role"          json:"role"`
	CreatedAt    string `db:"created_at"    json:"created_at"`
}

var ErrUserNotFound = errors.New("benutzer nicht gefunden")

func initUserTables() error {
	_, err := instance.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'guest',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}
	_, err = instance.Exec(`CREATE TABLE IF NOT EXISTS sessions (
		token TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at DATETIME NOT NULL
	)`)
	return err
}

func CountUsers() (int, error) {
	var n int
	err := instance.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	return n, err
}

func CreateUser(username, passwordHash, role string) (*User, error) {
	res, err := instance.Exec(
		"INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
		username, passwordHash, role,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &User{ID: id, Username: username, Role: role}, nil
}

func GetUserByUsername(username string) (*User, error) {
	var u User
	err := instance.Get(&u, "SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?", username)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return &u, nil
}

func ListUsers() ([]User, error) {
	var users []User
	err := instance.Select(&users, "SELECT id, username, role, created_at FROM users ORDER BY id")
	return users, err
}

func UpdateUser(id int64, username, passwordHash, role string) error {
	if passwordHash != "" {
		_, err := instance.Exec(
			"UPDATE users SET username=?, password_hash=?, role=? WHERE id=?",
			username, passwordHash, role, id,
		)
		return err
	}
	_, err := instance.Exec("UPDATE users SET username=?, role=? WHERE id=?", username, role, id)
	return err
}

func DeleteUser(id int64) error {
	_, err := instance.Exec("DELETE FROM users WHERE id=?", id)
	return err
}

func CreateSession(token string, userID int64, expires time.Time) error {
	_, err := instance.Exec(
		"INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
		token, userID, expires.UTC().Format("2006-01-02 15:04:05"),
	)
	return err
}

func GetSessionUser(token string) (*User, error) {
	var u User
	err := instance.Get(&u, `
		SELECT u.id, u.username, u.password_hash, u.role, u.created_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token = ? AND s.expires_at > datetime('now')
	`, token)
	if err != nil {
		return nil, ErrUserNotFound
	}
	return &u, nil
}

func DeleteSession(token string) error {
	_, err := instance.Exec("DELETE FROM sessions WHERE token=?", token)
	return err
}

func DeleteExpiredSessions() error {
	_, err := instance.Exec("DELETE FROM sessions WHERE expires_at <= datetime('now')")
	return err
}
