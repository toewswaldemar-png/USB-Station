package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"filestation/internal/db"
	"golang.org/x/crypto/bcrypt"
)

const SessionDuration = 30 * 24 * time.Hour

var ErrInvalidCredentials = errors.New("ungültige Zugangsdaten")

func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(b), err
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func ValidateSession(token string) (*db.User, error) {
	return db.GetSessionUser(token)
}

func NewSession(userID int64) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	return token, db.CreateSession(token, userID, time.Now().Add(SessionDuration))
}

func Login(username, password string) (*db.User, string, error) {
	u, err := db.GetUserByUsername(username)
	if err != nil {
		return nil, "", ErrInvalidCredentials
	}
	if !CheckPassword(u.PasswordHash, password) {
		return nil, "", ErrInvalidCredentials
	}
	token, err := NewSession(u.ID)
	if err != nil {
		return nil, "", err
	}
	return u, token, nil
}
