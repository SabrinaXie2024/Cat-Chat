package store

import (
	"context"

	"github.com/google/uuid"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

func (p *Postgres) UpdateProfile(ctx context.Context, userID string, nickname *string, avatar *api.Avatar) (api.User, error) {
	uid, err := parseID(userID)
	if err != nil {
		return api.User{}, err
	}
	var av *string
	if avatar != nil {
		s := string(*avatar)
		av = &s
	}
	r, err := p.q.UpdateProfile(ctx, dbq.UpdateProfileParams{ID: uid, Nickname: nickname, Avatar: av})
	if err != nil {
		return api.User{}, notFound(err)
	}
	return api.User{Id: r.ID.String(), Email: r.Email, Nickname: r.Nickname, Avatar: api.Avatar(r.Avatar), CreatedAt: r.CreatedAt.UTC()}, nil
}

func (p *Postgres) Profile(ctx context.Context, userID, viewerID string) (api.Profile, error) {
	uid, err := parseID(userID)
	if err != nil {
		return api.Profile{}, err
	}
	r, err := p.q.GetProfile(ctx, dbq.GetProfileParams{ID: uid, Viewer: optID(viewerID)})
	if err != nil {
		return api.Profile{}, notFound(err)
	}
	return api.Profile{
		Id: r.ID.String(), Nickname: r.Nickname, Avatar: api.Avatar(r.Avatar), CreatedAt: r.CreatedAt.UTC(),
		PostCount: int(r.PostCount), FollowerCount: int(r.FollowerCount), FollowingCount: int(r.FollowingCount),
		FollowedByMe: r.FollowedByMe,
	}, nil
}

func (p *Postgres) ListUserPosts(ctx context.Context, userID, viewerID string) ([]api.Post, error) {
	uid, err := parseID(userID)
	if err != nil {
		return nil, err
	}
	if err := p.requireUser(ctx, uid); err != nil {
		return nil, err
	}
	rows, err := p.q.ListUserPosts(ctx, dbq.ListUserPostsParams{AuthorID: uid, Viewer: optID(viewerID)})
	if err != nil {
		return nil, err
	}
	return convertRows(rows), nil
}

func (p *Postgres) requireUser(ctx context.Context, id uuid.UUID) error {
	ok, err := p.q.UserExists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return api.ErrNotFound
	}
	return nil
}

func (p *Postgres) followIDs(followerID, followeeID string) (uuid.UUID, uuid.UUID, error) {
	a, err := parseID(followerID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	b, err := parseID(followeeID)
	return a, b, err
}

func (p *Postgres) Follow(ctx context.Context, followerID, followeeID string) error {
	a, b, err := p.followIDs(followerID, followeeID)
	if err != nil {
		return err
	}
	if a == b {
		return api.ErrSelfFollow
	}
	if err := p.requireUser(ctx, b); err != nil {
		return err
	}
	// A followee deleted between the check and the insert hits the FK and
	// surfaces as a 500 — acceptable for an almost-impossible race.
	return p.q.Follow(ctx, dbq.FollowParams{FollowerID: a, FolloweeID: b})
}

func (p *Postgres) Unfollow(ctx context.Context, followerID, followeeID string) error {
	a, b, err := p.followIDs(followerID, followeeID)
	if err != nil {
		return err
	}
	if err := p.requireUser(ctx, b); err != nil {
		return err
	}
	return p.q.Unfollow(ctx, dbq.UnfollowParams{FollowerID: a, FolloweeID: b})
}
