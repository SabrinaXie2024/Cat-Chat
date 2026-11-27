package store

import (
	"context"
	"time"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

func (p *Postgres) PasswordReset(ctx context.Context, email string) (api.ResetCode, error) {
	r, err := p.q.GetPasswordReset(ctx, email)
	if err != nil {
		return api.ResetCode{}, notFound(err)
	}
	return api.ResetCode{
		Email: r.Email, CodeHash: r.CodeHash, Attempts: int(r.Attempts), SendCount: int(r.SendCount),
		ExpiresAt: r.ExpiresAt, LastSentAt: r.LastSentAt, WindowStart: r.WindowStart,
	}, nil
}

func (p *Postgres) SavePasswordReset(ctx context.Context, r api.ResetCode) error {
	return p.q.SavePasswordReset(ctx, dbq.SavePasswordResetParams{
		Email: r.Email, CodeHash: r.CodeHash, ExpiresAt: r.ExpiresAt, LastSentAt: r.LastSentAt,
		SendCount: int32(r.SendCount), WindowStart: r.WindowStart,
	})
}

func (p *Postgres) RecordWrongResetCode(ctx context.Context, email string) (int, error) {
	n, err := p.q.IncrementPasswordResetAttempts(ctx, email)
	return int(n), notFound(err)
}

func (p *Postgres) DeletePasswordReset(ctx context.Context, email string) error {
	return p.q.DeletePasswordReset(ctx, email)
}

// DeleteStalePasswordResets is called periodically from main.
func (p *Postgres) DeleteStalePasswordResets(ctx context.Context, now time.Time) (int64, error) {
	return p.q.DeleteStalePasswordResets(ctx, dbq.DeleteStalePasswordResetsParams{Now: now, WindowCutoff: now.Add(-time.Hour)})
}
