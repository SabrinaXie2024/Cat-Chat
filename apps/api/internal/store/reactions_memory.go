package store

import (
	"context"
	"slices"

	"github.com/cat-chat/api/internal/api"
)

// pairs is an ordered set of {a, b} (oldest first).
type pairs [][2]string

func (ps pairs) has(a, b string) bool { return slices.Contains(ps, [2]string{a, b}) }

func (ps *pairs) add(a, b string) {
	if !ps.has(a, b) {
		*ps = append(*ps, [2]string{a, b})
	}
}

func (ps *pairs) remove(a, b string) {
	*ps = slices.DeleteFunc(*ps, func(p [2]string) bool { return p == [2]string{a, b} })
}

// decorate fills the per-viewer and counted fields (caller holds the lock).
func (m *Memory) decorate(p api.Post, viewerID string) api.Post {
	p.LikeCount = 0
	for _, l := range m.likes {
		if l[1] == p.Id {
			p.LikeCount++
		}
	}
	p.LikedByMe = m.likes.has(viewerID, p.Id)
	p.FavoritedByMe = m.favorites.has(viewerID, p.Id)
	return p
}

// postsBy lists the posts in ps belonging to user, most recent first.
func (m *Memory) postsBy(ps pairs, userID, viewerID string) []api.Post {
	out := []api.Post{}
	for _, pr := range slices.Backward(ps) {
		if pr[0] != userID {
			continue
		}
		if i := m.findPost(pr[1]); i >= 0 {
			out = append(out, m.decorate(m.posts[i], viewerID))
		}
	}
	return out
}

func (m *Memory) ListLikedPosts(_ context.Context, userID, viewerID string) ([]api.Post, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.users[userID]; !ok {
		return nil, api.ErrNotFound
	}
	return m.postsBy(m.likes, userID, viewerID), nil
}

func (m *Memory) ListFavorites(_ context.Context, userID string) ([]api.Post, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.postsBy(m.favorites, userID, userID), nil
}

func (m *Memory) setPair(ps *pairs, userID, postID string, on bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.findPost(postID) < 0 {
		return api.ErrNotFound
	}
	if on {
		ps.add(userID, postID)
	} else {
		ps.remove(userID, postID)
	}
	return nil
}

func (m *Memory) SetLike(_ context.Context, userID, postID string, on bool) error {
	return m.setPair(&m.likes, userID, postID, on)
}

func (m *Memory) SetFavorite(_ context.Context, userID, postID string, on bool) error {
	return m.setPair(&m.favorites, userID, postID, on)
}

func (m *Memory) summary(id string) api.UserSummary {
	u := m.users[id].user
	return api.UserSummary{Id: u.Id, Nickname: u.Nickname, Avatar: u.Avatar}
}

func (m *Memory) listFollows(userID string, followers bool) ([]api.UserSummary, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.users[userID]; !ok {
		return nil, api.ErrNotFound
	}
	out := []api.UserSummary{}
	for _, f := range slices.Backward(m.follows) {
		if followers && f[1] == userID {
			out = append(out, m.summary(f[0]))
		} else if !followers && f[0] == userID {
			out = append(out, m.summary(f[1]))
		}
	}
	return out, nil
}

func (m *Memory) ListFollowers(_ context.Context, userID string) ([]api.UserSummary, error) {
	return m.listFollows(userID, true)
}

func (m *Memory) ListFollowing(_ context.Context, userID string) ([]api.UserSummary, error) {
	return m.listFollows(userID, false)
}
