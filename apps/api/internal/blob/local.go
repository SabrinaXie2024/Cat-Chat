// Package blob stores processed image bytes. Local is for development and
// single-server deploys; an S3-compatible implementation (R2/OSS/MinIO)
// satisfies the same interface.
package blob

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

var ErrNotFound = errors.New("blob not found")

type Store interface {
	Put(ctx context.Context, key string, data []byte) error
	// Open returns the blob and its size. Caller closes.
	Open(ctx context.Context, key string) (io.ReadCloser, int64, error)
}

// Local stores blobs as files under Dir. Keys must be UUIDs, which rules out
// path traversal by construction.
type Local struct{ Dir string }

var _ Store = Local{}

func (l Local) path(key string) (string, error) {
	id, err := uuid.Parse(key)
	if err != nil {
		return "", ErrNotFound
	}
	s := id.String()
	return filepath.Join(l.Dir, s[:2], s+".jpg"), nil // shard to keep dirs small
}

func (l Local) Put(_ context.Context, key string, data []byte) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	// Write-then-rename so readers never see a partial file.
	tmp, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}

func (l Local) Open(_ context.Context, key string) (io.ReadCloser, int64, error) {
	p, err := l.path(key)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil, 0, ErrNotFound
	}
	if err != nil {
		return nil, 0, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	return f, st.Size(), nil
}
