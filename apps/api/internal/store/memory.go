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
	mu        sync.RWMutex
	posts     []api.Post // newest last
	replies   map[string][]api.Reply
	users     map[string]userRow // by id
	byEmail   map[string]string  // email -> id
	sessions  map[string]session // token hash -> session
	images    map[string]string  // image id -> owner id
	imgDims   map[string][2]int
	videos    map[string]api.VideoRecord
	gallery   []api.GalleryEntry // newest last
	pending   map[string]api.PendingRegistration
	resets    map[string]api.ResetCode
	follows   pairs // {follower, followee}, oldest first
	likes     pairs // {user, post}
	favorites pairs // {user, post}
	now       func() time.Time
}

var _ api.Store = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{
		replies:  map[string][]api.Reply{},
		users:    map[string]userRow{},
		byEmail:  map[string]string{},
		sessions: map[string]session{},
		images:   map[string]string{},
		imgDims:  map[string][2]int{},
		videos:   map[string]api.VideoRecord{},
		pending:  map[string]api.PendingRegistration{},
		resets:   map[string]api.ResetCode{},
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
	u := api.User{Id: newID(), Email: email, Nickname: nickname, Avatar: api.Orange, CreatedAt: m.now().UTC()}
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

func (m *Memory) ChangePassword(_ context.Context, userID, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.users[userID]
	if !ok {
		return api.ErrNotFound
	}
	row.hash = hash
	m.users[userID] = row
	for k, s := range m.sessions {
		if s.userID == userID {
			delete(m.sessions, k)
		}
	}
	return nil
}

// --- pending registrations ---

func (m *Memory) PendingRegistration(_ context.Context, email string) (api.PendingRegistration, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, ok := m.pending[email]
	if !ok {
		return api.PendingRegistration{}, api.ErrNotFound
	}
	return p, nil
}

func (m *Memory) SavePendingRegistration(_ context.Context, p api.PendingRegistration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p.Attempts = 0
	m.pending[p.Email] = p
	return nil
}

func (m *Memory) RecordWrongCode(_ context.Context, email string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.pending[email]
	if !ok {
		return 0, api.ErrNotFound
	}
	p.Attempts++
	m.pending[email] = p
	return p.Attempts, nil
}

func (m *Memory) DeletePendingRegistration(_ context.Context, email string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.pending, email)
	return nil
}

func (m *Memory) CompleteRegistration(ctx context.Context, email string) (api.User, error) {
	m.mu.Lock()
	p, ok := m.pending[email]
	m.mu.Unlock()
	if !ok {
		return api.User{}, api.ErrNotFound
	}
	u, err := m.CreateUser(ctx, p.Email, p.Nickname, p.PasswordHash)
	if err != nil {
		return api.User{}, err
	}
	_ = m.DeletePendingRegistration(ctx, email)
	return u, nil
}

// --- password resets ---

func (m *Memory) PasswordReset(_ context.Context, email string) (api.ResetCode, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.resets[email]
	if !ok {
		return api.ResetCode{}, api.ErrNotFound
	}
	return r, nil
}

func (m *Memory) SavePasswordReset(_ context.Context, r api.ResetCode) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	r.Attempts = 0
	m.resets[r.Email] = r
	return nil
}

func (m *Memory) RecordWrongResetCode(_ context.Context, email string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.resets[email]
	if !ok {
		return 0, api.ErrNotFound
	}
	r.Attempts++
	m.resets[email] = r
	return r.Attempts, nil
}

func (m *Memory) DeletePasswordReset(_ context.Context, email string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.resets, email)
	return nil
}

// --- images ---

func (m *Memory) CreateImage(_ context.Context, id, ownerID string, w, h, _ int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.images[id] = ownerID
	m.imgDims[id] = [2]int{w, h}
	return nil
}

// --- videos & gallery ---

func (m *Memory) CreateVideo(_ context.Context, v api.VideoRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.videos[v.ID] = v
	return nil
}

func (m *Memory) VideoContainer(_ context.Context, id string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.videos[id]
	if !ok {
		return "", api.ErrNotFound
	}
	return v.Container, nil
}

func (m *Memory) CreateGalleryItem(_ context.Context, author api.User, kind, mediaID, caption string) (api.GalleryEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := api.GalleryEntry{ID: newID(), Kind: kind, Caption: caption, CreatedAt: m.now().UTC()}
	switch kind {
	case "photo":
		if m.images[mediaID] != author.Id {
			return api.GalleryEntry{}, api.ErrInvalidMedia
		}
		d := m.imgDims[mediaID]
		e.ImageID, e.Width, e.Height = mediaID, d[0], d[1]
	case "video":
		v, ok := m.videos[mediaID]
		if !ok || v.OwnerID != author.Id {
			return api.GalleryEntry{}, api.ErrInvalidMedia
		}
		e.VideoID, e.PosterImageID, e.Width, e.Height = mediaID, v.PosterImageID, v.Width, v.Height
	default:
		return api.GalleryEntry{}, api.ErrInvalidMedia
	}
	m.gallery = append(m.gallery, e)
	return e, nil
}

func (m *Memory) ListGallery(context.Context) ([]api.GalleryEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := slices.Clone(m.gallery)
	slices.Reverse(out)
	return nonNil(out), nil
}

func (m *Memory) DeleteGalleryItem(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := slices.IndexFunc(m.gallery, func(e api.GalleryEntry) bool { return e.ID == id })
	if i < 0 {
		return api.ErrNotFound
	}
	m.gallery = slices.Delete(m.gallery, i, i+1)
	return nil
}

func (m *Memory) checkImages(owner string, ids []string) error {
	for _, id := range ids {
		if m.images[id] != owner {
			return api.ErrInvalidImages
		}
	}
	return nil
}

// --- posts & replies ---

func (m *Memory) ListPosts(_ context.Context, viewerID string) ([]api.Post, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []api.Post{}
	for _, p := range slices.Backward(m.posts) {
		out = append(out, m.decorate(p, viewerID))
	}
	return out, nil
}

func (m *Memory) CreatePost(_ context.Context, author api.User, in api.NewPost) (api.Post, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.checkImages(author.Id, in.Images); err != nil {
		return api.Post{}, err
	}
	p := api.Post{
		Id:           newID(),
		AuthorId:     author.Id,
		Author:       author.Nickname,
		AuthorAvatar: author.Avatar,
		Content:      in.Content,
		Images:       nonNil(in.Images),
		CreatedAt:    m.now().UTC(),
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
	if err := m.checkImages(author.Id, in.Images); err != nil {
		return api.Reply{}, err
	}
	if len(m.replies[postID]) >= api.MaxRepliesPerPost {
		return api.Reply{}, api.ErrThreadFull
	}
	r := api.Reply{
		Id:           newID(),
		PostId:       postID,
		AuthorId:     author.Id,
		Author:       author.Nickname,
		AuthorAvatar: author.Avatar,
		Content:      in.Content,
		Images:       nonNil(in.Images),
		CreatedAt:    m.now().UTC(),
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
