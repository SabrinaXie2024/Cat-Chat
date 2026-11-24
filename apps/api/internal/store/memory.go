// Package store is a temporary in-memory store. It will be replaced by
// PostgreSQL (pgx + sqlc, migrations via goose) — keep the method set small
// so the swap is mechanical.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/cat-chat/api/internal/api"
)

// MaxRepliesPerPost is the product limit on interaction rounds per post.
const MaxRepliesPerPost = 10

var (
	ErrNotFound   = errors.New("not found")
	ErrThreadFull = errors.New("thread is full")
)

type Memory struct {
	mu      sync.RWMutex
	posts   []api.Post // newest last
	replies map[string][]api.Reply
	now     func() time.Time
}

func NewMemory() *Memory {
	return &Memory{replies: map[string][]api.Reply{}, now: time.Now}
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (m *Memory) ListPosts() []api.Post {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := slices.Clone(m.posts)
	slices.Reverse(out)
	return out
}

func (m *Memory) CreatePost(author string, in api.NewPost) api.Post {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := api.Post{
		Id:        newID(),
		Author:    author,
		Content:   in.Content,
		Images:    nonNil(in.Images),
		CreatedAt: m.now().UTC(),
	}
	m.posts = append(m.posts, p)
	return p
}

func (m *Memory) ListReplies(postID string) ([]api.Reply, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.findPost(postID) < 0 {
		return nil, ErrNotFound
	}
	return slices.Clone(nonNil(m.replies[postID])), nil
}

func (m *Memory) CreateReply(postID, author string, in api.NewReply) (api.Reply, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := m.findPost(postID)
	if i < 0 {
		return api.Reply{}, ErrNotFound
	}
	if len(m.replies[postID]) >= MaxRepliesPerPost {
		return api.Reply{}, ErrThreadFull
	}
	r := api.Reply{
		Id:        newID(),
		PostId:    postID,
		Author:    author,
		Content:   in.Content,
		Images:    nonNil(in.Images),
		CreatedAt: m.now().UTC(),
	}
	m.replies[postID] = append(m.replies[postID], r)
	m.posts[i].ReplyCount++
	return r, nil
}

func (m *Memory) findPost(id string) int {
	return slices.IndexFunc(m.posts, func(p api.Post) bool { return p.Id == id })
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
