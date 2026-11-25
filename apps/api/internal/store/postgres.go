package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

// Postgres implements api.Store on top of the sqlc queries in internal/db.
type Postgres struct {
	pool *pgxpool.Pool
	q    *dbq.Queries
}

var _ api.Store = (*Postgres)(nil)

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: dbq.New(pool)}
}

// ids in URLs are untrusted strings; anything that isn't a UUID can't exist.
func parseID(s string) (uuid.UUID, error) {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, api.ErrNotFound
	}
	return id, nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return api.ErrNotFound
	}
	return err
}

const pgUniqueViolation = "23505"

// --- users & sessions ---

func (p *Postgres) CreateUser(ctx context.Context, email, nickname, hash string) (api.User, error) {
	r, err := p.q.CreateUser(ctx, dbq.CreateUserParams{Email: email, Nickname: nickname, PasswordHash: hash})
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok && pgErr.Code == pgUniqueViolation {
		return api.User{}, api.ErrEmailTaken
	}
	if err != nil {
		return api.User{}, err
	}
	return api.User{Id: r.ID.String(), Email: r.Email, Nickname: r.Nickname, CreatedAt: r.CreatedAt.UTC()}, nil
}

func (p *Postgres) UserByEmail(ctx context.Context, email string) (api.User, string, error) {
	r, err := p.q.UserByEmail(ctx, email)
	if err != nil {
		return api.User{}, "", notFound(err)
	}
	return api.User{Id: r.ID.String(), Email: r.Email, Nickname: r.Nickname, CreatedAt: r.CreatedAt.UTC()}, r.PasswordHash, nil
}

func (p *Postgres) CreateSession(ctx context.Context, tokenHash, userID string, expires time.Time) error {
	uid, err := parseID(userID)
	if err != nil {
		return err
	}
	return p.q.CreateSession(ctx, dbq.CreateSessionParams{TokenHash: tokenHash, UserID: uid, ExpiresAt: expires})
}

func (p *Postgres) UserBySession(ctx context.Context, tokenHash string, now time.Time) (api.User, error) {
	r, err := p.q.UserBySession(ctx, dbq.UserBySessionParams{TokenHash: tokenHash, Now: now})
	if err != nil {
		return api.User{}, notFound(err)
	}
	return api.User{Id: r.ID.String(), Email: r.Email, Nickname: r.Nickname, CreatedAt: r.CreatedAt.UTC()}, nil
}

func (p *Postgres) DeleteSession(ctx context.Context, tokenHash string) error {
	return p.q.DeleteSession(ctx, tokenHash)
}

// DeleteExpiredSessions is called periodically from main.
func (p *Postgres) DeleteExpiredSessions(ctx context.Context, now time.Time) (int64, error) {
	return p.q.DeleteExpiredSessions(ctx, now)
}

// --- posts & replies ---

func (p *Postgres) ListPosts(ctx context.Context) ([]api.Post, error) {
	rows, err := p.q.ListPosts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]api.Post, len(rows))
	for i, r := range rows {
		out[i] = api.Post{
			Id: r.ID.String(), Author: r.Author, Content: r.Content, Images: nonNil(r.Images),
			ReplyCount: int(r.ReplyCount), CreatedAt: r.CreatedAt.UTC(),
		}
	}
	return out, nil
}

func (p *Postgres) CreatePost(ctx context.Context, author api.User, in api.NewPost) (api.Post, error) {
	uid, err := parseID(author.Id)
	if err != nil {
		return api.Post{}, err
	}
	r, err := p.q.CreatePost(ctx, dbq.CreatePostParams{AuthorID: uid, Content: in.Content, Images: nonNil(in.Images)})
	if err != nil {
		return api.Post{}, err
	}
	return api.Post{
		Id: r.ID.String(), Author: author.Nickname, Content: r.Content, Images: nonNil(r.Images),
		ReplyCount: int(r.ReplyCount), CreatedAt: r.CreatedAt.UTC(),
	}, nil
}

func (p *Postgres) ListReplies(ctx context.Context, postID string) ([]api.Reply, error) {
	pid, err := parseID(postID)
	if err != nil {
		return nil, err
	}
	// Two statements, but a post is never un-deleted, so a race here can only
	// return [] for a post deleted mid-request — harmless.
	exists, err := p.q.PostExists(ctx, pid)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, api.ErrNotFound
	}
	rows, err := p.q.ListReplies(ctx, pid)
	if err != nil {
		return nil, err
	}
	out := make([]api.Reply, len(rows))
	for i, r := range rows {
		out[i] = api.Reply{
			Id: r.ID.String(), PostId: r.PostID.String(), Author: r.Author, Content: r.Content,
			Images: nonNil(r.Images), CreatedAt: r.CreatedAt.UTC(),
		}
	}
	return out, nil
}

func (p *Postgres) CreateReply(ctx context.Context, postID string, author api.User, in api.NewReply) (api.Reply, error) {
	pid, err := parseID(postID)
	if err != nil {
		return api.Reply{}, err
	}
	uid, err := parseID(author.Id)
	if err != nil {
		return api.Reply{}, err
	}
	var out api.Reply
	err = pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		q := p.q.WithTx(tx)
		claimed, err := q.ClaimReplySlot(ctx, dbq.ClaimReplySlotParams{ID: pid, MaxReplies: api.MaxRepliesPerPost})
		if err != nil {
			return err
		}
		if claimed == 0 {
			exists, err := q.PostExists(ctx, pid)
			if err != nil {
				return err
			}
			if !exists {
				return api.ErrNotFound
			}
			return api.ErrThreadFull
		}
		r, err := q.CreateReply(ctx, dbq.CreateReplyParams{PostID: pid, AuthorID: uid, Content: in.Content, Images: nonNil(in.Images)})
		if err != nil {
			return err
		}
		out = api.Reply{
			Id: r.ID.String(), PostId: r.PostID.String(), Author: author.Nickname, Content: r.Content,
			Images: nonNil(r.Images), CreatedAt: r.CreatedAt.UTC(),
		}
		return nil
	})
	return out, err
}
