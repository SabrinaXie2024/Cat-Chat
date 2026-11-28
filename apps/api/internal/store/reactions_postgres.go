package store

import (
	"context"

	"github.com/google/uuid"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

// optID parses an optional viewer id ("" or invalid → nil, i.e. signed out).
func optID(s string) *uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		return nil
	}
	return &id
}

// Every post-list query selects the same columns, so their rows convert.
type postRow interface {
	dbq.ListPostsRow | dbq.ListUserPostsRow | dbq.ListLikedPostsRow | dbq.ListFavoritePostsRow
}

func convertRows[T postRow](rows []T) []api.Post {
	out := make([]dbq.ListPostsRow, len(rows))
	for i, r := range rows {
		out[i] = dbq.ListPostsRow(r)
	}
	return postRows(out)
}

func postRows(rows []dbq.ListPostsRow) []api.Post {
	out := make([]api.Post, len(rows))
	for i, r := range rows {
		out[i] = api.Post{
			Id: r.ID.String(), AuthorId: r.AuthorID.String(), Author: r.Author, AuthorAvatar: api.Avatar(r.AuthorAvatar),
			Content: r.Content, Images: nonNil(r.Images), ReplyCount: int(r.ReplyCount), CreatedAt: r.CreatedAt.UTC(),
			LikeCount: int(r.LikeCount), LikedByMe: r.LikedByMe, FavoritedByMe: r.FavoritedByMe,
		}
	}
	return out
}

func (p *Postgres) ListLikedPosts(ctx context.Context, userID, viewerID string) ([]api.Post, error) {
	uid, err := parseID(userID)
	if err != nil {
		return nil, err
	}
	if err := p.requireUser(ctx, uid); err != nil {
		return nil, err
	}
	rows, err := p.q.ListLikedPosts(ctx, dbq.ListLikedPostsParams{UserID: uid, Viewer: optID(viewerID)})
	if err != nil {
		return nil, err
	}
	return convertRows(rows), nil
}

func (p *Postgres) ListFavorites(ctx context.Context, userID string) ([]api.Post, error) {
	uid, err := parseID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := p.q.ListFavoritePosts(ctx, dbq.ListFavoritePostsParams{UserID: uid, Viewer: &uid})
	if err != nil {
		return nil, err
	}
	return convertRows(rows), nil
}

func (p *Postgres) reactionIDs(ctx context.Context, userID, postID string) (uuid.UUID, uuid.UUID, error) {
	uid, err := parseID(userID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	pid, err := parseID(postID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	ok, err := p.q.PostExists(ctx, pid)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	if !ok {
		return uuid.Nil, uuid.Nil, api.ErrNotFound
	}
	return uid, pid, nil
}

func (p *Postgres) SetLike(ctx context.Context, userID, postID string, on bool) error {
	uid, pid, err := p.reactionIDs(ctx, userID, postID)
	if err != nil {
		return err
	}
	if on {
		return p.q.Like(ctx, dbq.LikeParams{UserID: uid, PostID: pid})
	}
	return p.q.Unlike(ctx, dbq.UnlikeParams{UserID: uid, PostID: pid})
}

func (p *Postgres) SetFavorite(ctx context.Context, userID, postID string, on bool) error {
	uid, pid, err := p.reactionIDs(ctx, userID, postID)
	if err != nil {
		return err
	}
	if on {
		return p.q.Favorite(ctx, dbq.FavoriteParams{UserID: uid, PostID: pid})
	}
	return p.q.Unfavorite(ctx, dbq.UnfavoriteParams{UserID: uid, PostID: pid})
}

func summaries[T dbq.ListFollowersRow | dbq.ListFollowingRow](rows []T) []api.UserSummary {
	out := make([]api.UserSummary, len(rows))
	for i, r := range rows {
		f := dbq.ListFollowersRow(r)
		out[i] = api.UserSummary{Id: f.ID.String(), Nickname: f.Nickname, Avatar: api.Avatar(f.Avatar)}
	}
	return out
}

func (p *Postgres) ListFollowers(ctx context.Context, userID string) ([]api.UserSummary, error) {
	uid, err := parseID(userID)
	if err != nil {
		return nil, err
	}
	if err := p.requireUser(ctx, uid); err != nil {
		return nil, err
	}
	rows, err := p.q.ListFollowers(ctx, uid)
	if err != nil {
		return nil, err
	}
	return summaries(rows), nil
}

func (p *Postgres) ListFollowing(ctx context.Context, userID string) ([]api.UserSummary, error) {
	uid, err := parseID(userID)
	if err != nil {
		return nil, err
	}
	if err := p.requireUser(ctx, uid); err != nil {
		return nil, err
	}
	rows, err := p.q.ListFollowing(ctx, uid)
	if err != nil {
		return nil, err
	}
	return summaries(rows), nil
}
