package store

import (
	"context"
	"slices"

	"github.com/cat-chat/api/internal/api"
)

func (m *Memory) UpdateProfile(_ context.Context, userID string, nickname *string, avatar *api.Avatar) (api.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.users[userID]
	if !ok {
		return api.User{}, api.ErrNotFound
	}
	if nickname != nil {
		row.user.Nickname = *nickname
	}
	if avatar != nil {
		row.user.Avatar = *avatar
	}
	m.users[userID] = row
	// Posts/replies show the author's current name and avatar (Postgres joins).
	for i := range m.posts {
		if m.posts[i].AuthorId == userID {
			m.posts[i].Author, m.posts[i].AuthorAvatar = row.user.Nickname, row.user.Avatar
		}
	}
	for pid, rs := range m.replies {
		for i := range rs {
			if rs[i].AuthorId == userID {
				m.replies[pid][i].Author, m.replies[pid][i].AuthorAvatar = row.user.Nickname, row.user.Avatar
			}
		}
	}
	return row.user, nil
}

func (m *Memory) Profile(_ context.Context, userID, viewerID string) (api.Profile, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row, ok := m.users[userID]
	if !ok {
		return api.Profile{}, api.ErrNotFound
	}
	p := api.Profile{
		Id: userID, Nickname: row.user.Nickname, Avatar: row.user.Avatar, CreatedAt: row.user.CreatedAt,
		FollowedByMe: m.follows[[2]string{viewerID, userID}],
	}
	for _, post := range m.posts {
		if post.AuthorId == userID {
			p.PostCount++
		}
	}
	for k := range m.follows {
		if k[1] == userID {
			p.FollowerCount++
		}
		if k[0] == userID {
			p.FollowingCount++
		}
	}
	return p, nil
}

func (m *Memory) ListUserPosts(_ context.Context, userID string) ([]api.Post, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.users[userID]; !ok {
		return nil, api.ErrNotFound
	}
	out := []api.Post{}
	for _, p := range slices.Backward(m.posts) {
		if p.AuthorId == userID {
			out = append(out, p)
		}
	}
	return out, nil
}

func (m *Memory) Follow(_ context.Context, followerID, followeeID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if followerID == followeeID {
		return api.ErrSelfFollow
	}
	if _, ok := m.users[followeeID]; !ok {
		return api.ErrNotFound
	}
	m.follows[[2]string{followerID, followeeID}] = true
	return nil
}

func (m *Memory) Unfollow(_ context.Context, followerID, followeeID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.users[followeeID]; !ok {
		return api.ErrNotFound
	}
	delete(m.follows, [2]string{followerID, followeeID})
	return nil
}
