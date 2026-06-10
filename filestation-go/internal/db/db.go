package db

import (
	"crypto/md5"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

// AudioFile repräsentiert einen MP3-Eintrag in der Datenbank.
type AudioFile struct {
	Path   string  `db:"path"   json:"path"`
	Date   string  `db:"date"   json:"date"`
	Title  string  `db:"title"  json:"title"`
	Folder string  `db:"folder" json:"folder"`
	Artist string  `db:"artist" json:"artist"`
	Album  string  `db:"album"  json:"album"`
	Size   int64   `db:"size"   json:"size"`
	Mtime  float64 `db:"mtime"  json:"mtime"`
}

var (
	instance   *sqlx.DB
	dbVersion  atomic.Int64
	currentETag string
	etagMu     sync.Mutex
)

func Init(path string) error {
	conn, err := sqlx.Open("sqlite", path+"?_journal_mode=WAL&_synchronous=NORMAL")
	if err != nil {
		return err
	}
	conn.SetMaxOpenConns(1)
	instance = conn

	_, err = instance.Exec(`CREATE TABLE IF NOT EXISTS files (
		path TEXT PRIMARY KEY, date TEXT, title TEXT, folder TEXT,
		artist TEXT, album TEXT, size INTEGER, mtime REAL)`)
	if err != nil {
		return err
	}
	_, _ = instance.Exec(`CREATE INDEX IF NOT EXISTS idx_date ON files(date)`)

	dbVersion.Store(time.Now().Unix())
	invalidateETag()
	return nil
}

func invalidateETag() {
	sum := md5.Sum([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	etagMu.Lock()
	currentETag = fmt.Sprintf("%x", sum[:4])
	etagMu.Unlock()
}

func CurrentETag() string {
	etagMu.Lock()
	defer etagMu.Unlock()
	return currentETag
}

func Version() int64 {
	return dbVersion.Load()
}

func BumpVersion() {
	dbVersion.Add(1)
	invalidateETag()
}

func GetAll() ([]AudioFile, error) {
	var files []AudioFile
	err := instance.Select(&files, "SELECT path,date,title,folder,artist,album,size,mtime FROM files ORDER BY date,path")
	return files, err
}

func GetMtimeMap() (map[string]float64, error) {
	rows, err := instance.Query("SELECT path,mtime FROM files")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[string]float64)
	for rows.Next() {
		var path string
		var mtime float64
		if err := rows.Scan(&path, &mtime); err != nil {
			continue
		}
		m[path] = mtime
	}
	return m, rows.Err()
}

func UpsertBatch(files []AudioFile) error {
	tx, err := instance.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT OR REPLACE INTO files
		(path,date,title,folder,artist,album,size,mtime)
		VALUES (?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, f := range files {
		if _, err := stmt.Exec(f.Path, f.Date, f.Title, f.Folder, f.Artist, f.Album, f.Size, f.Mtime); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	BumpVersion()
	return nil
}

func Upsert(f AudioFile) error {
	_, err := instance.Exec(`INSERT OR REPLACE INTO files
		(path,date,title,folder,artist,album,size,mtime)
		VALUES (?,?,?,?,?,?,?,?)`,
		f.Path, f.Date, f.Title, f.Folder, f.Artist, f.Album, f.Size, f.Mtime)
	if err != nil {
		return err
	}
	BumpVersion()
	return nil
}

func Delete(path string) error {
	_, err := instance.Exec("DELETE FROM files WHERE path=?", path)
	if err != nil {
		return err
	}
	BumpVersion()
	return nil
}

func DeletePrefix(prefix string) (int, error) {
	res, err := instance.Exec("DELETE FROM files WHERE path LIKE ?", prefix+"%")
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		BumpVersion()
	}
	return int(n), nil
}

func UpdatePathPrefix(oldPrefix, newPrefix, newFolder string) error {
	rows, err := instance.Query("SELECT path FROM files WHERE path LIKE ?", oldPrefix+"%")
	if err != nil {
		return err
	}
	var paths []string
	for rows.Next() {
		var p string
		rows.Scan(&p)
		paths = append(paths, p)
	}
	rows.Close()

	tx, err := instance.Begin()
	if err != nil {
		return err
	}
	for _, p := range paths {
		rest := p[len(oldPrefix):]
		newPath := newPrefix + rest
		tx.Exec("UPDATE files SET path=?, folder=? WHERE path=?", newPath, newFolder, p)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	BumpVersion()
	return nil
}

func UpdatePath(oldPath, newPath string) error {
	_, err := instance.Exec("UPDATE files SET path=? WHERE path=?", newPath, oldPath)
	if err != nil {
		return err
	}
	BumpVersion()
	return nil
}

func Clear() error {
	_, err := instance.Exec("DELETE FROM files")
	if err != nil {
		return err
	}
	BumpVersion()
	return nil
}

func Search(q string, limit int) ([]AudioFile, error) {
	like := "%" + q + "%"
	var files []AudioFile
	err := instance.Select(&files,
		`SELECT path,date,title,folder,artist,album,size,mtime FROM files
		 WHERE title LIKE ? OR path LIKE ?
		 ORDER BY date DESC, path
		 LIMIT ?`, like, like, limit)
	return files, err
}

func Count() (int, error) {
	var n int
	err := instance.QueryRow("SELECT COUNT(*) FROM files").Scan(&n)
	return n, err
}

func Exists(path string) (bool, error) {
	var n int
	err := instance.QueryRow("SELECT COUNT(*) FROM files WHERE path=?", path).Scan(&n)
	return n > 0, err
}
