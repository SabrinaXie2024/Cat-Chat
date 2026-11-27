package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

func (p *Postgres) PendingRegistration(ctx context.Context, email string) (api.PendingRegistration, error) {
	r, err := p.q.GetPendingRegistration(ctx, email)
	if err != nil {
		return api.PendingRegistration{}, notFound(err)
	}
	return api.PendingRegistration{
		Email: r.Email, Nickname: r.Nickname, PasswordHash: r.PasswordHash, CodeHash: r.CodeHash,
		Attempts: int(r.Attempts), ExpiresAt: r.ExpiresAt, LastSentAt: r.LastSentAt,
		WindowStart: r.WindowStart, SendCount: int(r.SendCount),
	}, nil
}

func (p *Postgres) SavePendingRegistration(ctx context.Context, r api.PendingRegistration) error {
	return p.q.SavePendingRegistration(ctx, dbq.SavePendingRegistrationParams{
		Email: r.Email, Nickname: r.Nickname, PasswordHash: r.PasswordHash, CodeHash: r.CodeHash,
		ExpiresAt: r.ExpiresAt, LastSentAt: r.LastSentAt, SendCount: int32(r.SendCount), WindowStart: r.WindowStart,
	})
}

func (p *Postgres) RecordWrongCode(ctx context.Context, email string) (int, error) {
	n, err := p.q.IncrementPendingAttempts(ctx, email)
	return int(n), notFound(err)
}

func (p *Postgres) DeletePendingRegistration(ctx context.Context, email string) error {
	return p.q.DeletePendingRegistration(ctx, email)
}

func (p *Postgres) CompleteRegistration(ctx context.Context, email string) (api.User, error) {
	var out api.User
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		q := p.q.WithTx(tx)
		pend, err := q.GetPendingRegistration(ctx, email)
		if err != nil {
			return notFound(err)
		}
		r, err := q.CreateUser(ctx, dbq.CreateUserParams{Email: pend.Email, Nickname: pend.Nickname, PasswordHash: pend.PasswordHash})
		if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok && pgErr.Code == pgUniqueViolation {
			return api.ErrEmailTaken
		}
		if err != nil {
			return err
		}
		out = api.User{Id: r.ID.String(), Email: r.Email, Nickname: r.Nickname, CreatedAt: r.CreatedAt.UTC()}
		return q.DeletePendingRegistration(ctx, email)
	})
	return out, err
}

// DeleteStalePendingRegistrations is called periodically from main.
func (p *Postgres) DeleteStalePendingRegistrations(ctx context.Context, now time.Time) (int64, error) {
	return p.q.DeleteStalePendingRegistrations(ctx, dbq.DeleteStalePendingRegistrationsParams{
		Now: now, WindowCutoff: now.Add(-time.Hour),
	})
}
