// Package store implements api.Store: Postgres for real use, Memory as a
// fast test double. conformance_test.go runs the same suite against both.
package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"slices"
	"sync"
	"time"

	"github.com/cat-chat/api/internal/api"
)

type userRow struct {
	user api.User
	hash string
}

type session struct {
	userID  string
	expires time.Time
}

// Memory is an in-process store for tests. Not durable.
type Memory struct {
	mu       sync.RWMutex
	posts    []api.Post // newest last
	replies  map[string][]api.Reply
	users    map[string]userRow // by id
	byEmail  map[string]string  // email -> id
	sessions map[string]session // token hash -> session
	now      func() time.Time
}

var _ api.Store = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{
		replies:  map[string][]api.Reply{},
		users:    map[string]userRow{},
		byEmail:  map[string]string{},
		sessions: map[string]session{},
		now:      time.Now,
	}
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- users & sessions ---

func (m *Memory) CreateUser(_ context.Context, email, nickname, hash string) (api.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, taken := m.byEmail[email]; taken {
		return api.User{}, api.ErrEmailTaken
	}
	u := api.User{Id: newID(), Email: email, Nickname: nickname, CreatedAt: m.now().UTC()}
	m.users[u.Id] = userRow{user: u, hash: hash}
	m.byEmail[email] = u.Id
	return u, nil
}

func (m *Memory) UserByEmail(_ context.Context, email string) (api.User, string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byEmail[email]
	if !ok {
		return api.User{}, "", api.ErrNotFound
	}
	row := m.users[id]
	return row.user, row.hash, nil
}

func (m *Memory) CreateSession(_ context.Context, tokenHash, userID string, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[tokenHash] = session{userID: userID, expires: expires}
	return nil
}

func (m *Memory) UserBySession(_ context.Context, tokenHash string, now time.Time) (api.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[tokenHash]
	if !ok {
		return api.User{}, api.ErrNotFound
	}
	if !now.Before(s.expires) {
		delete(m.sessions, tokenHash)
		return api.User{}, api.ErrNotFound
	}
	row, ok := m.users[s.userID]
	if !ok {
		return api.User{}, api.ErrNotFound
	}
	return row.user, nil
}

func (m *Memory) DeleteSession(_ context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, tokenHash)
	return nil
}

// --- posts & replies ---

func (m *Memory) ListPosts(context.Context) ([]api.Post, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := slices.Clone(m.posts)
	slices.Reverse(out)
	return nonNil(out), nil
}

func (m *Memory) CreatePost(_ context.Context, author api.User, in api.NewPost) (api.Post, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := api.Post{
		Id:        newID(),
		Author:    author.Nickname,
		Content:   in.Content,
		Images:    nonNil(in.Images),
		CreatedAt: m.now().UTC(),
	}
	m.posts = append(m.posts, p)
	return p, nil
}

func (m *Memory) ListReplies(_ context.Context, postID string) ([]api.Reply, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.findPost(postID) < 0 {
		return nil, api.ErrNotFound
	}
	return slices.Clone(nonNil(m.replies[postID])), nil
}

func (m *Memory) CreateReply(_ context.Context, postID string, author api.User, in api.NewReply) (api.Reply, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := m.findPost(postID)
	if i < 0 {
		return api.Reply{}, api.ErrNotFound
	}
	if len(m.replies[postID]) >= api.MaxRepliesPerPost {
		return api.Reply{}, api.ErrThreadFull
	}
	r := api.Reply{
		Id:        newID(),
		PostId:    postID,
		Author:    author.Nickname,
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
