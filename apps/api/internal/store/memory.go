// Package store is a temporary in-memory store. It will be replaced by
// PostgreSQL (pgx + sqlc, migrations via goose) — keep the method set small
// so the swap is mechanical.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"slices"
	"sync"
	"time"

	"github.com/cat-chat/api/internal/api"
)

// MaxRepliesPerPost is the product limit on interaction rounds per post.
const MaxRepliesPerPost = 10

type userRow struct {
	user api.User
	hash string
}

type session struct {
	userID  string
	expires time.Time
}

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

func (m *Memory) CreateUser(email, nickname, hash string) (api.User, error) {
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

func (m *Memory) UserByEmail(email string) (api.User, string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.byEmail[email]
	if !ok {
		return api.User{}, "", api.ErrNotFound
	}
	row := m.users[id]
	return row.user, row.hash, nil
}

func (m *Memory) CreateSession(tokenHash, userID string, expires time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[tokenHash] = session{userID: userID, expires: expires}
}

func (m *Memory) UserBySession(tokenHash string, now time.Time) (api.User, error) {
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

func (m *Memory) DeleteSession(tokenHash string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, tokenHash)
}

// --- posts & replies ---

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
		return nil, api.ErrNotFound
	}
	return slices.Clone(nonNil(m.replies[postID])), nil
}

func (m *Memory) CreateReply(postID, author string, in api.NewReply) (api.Reply, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := m.findPost(postID)
	if i < 0 {
		return api.Reply{}, api.ErrNotFound
	}
	if len(m.replies[postID]) >= MaxRepliesPerPost {
		return api.Reply{}, api.ErrThreadFull
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
