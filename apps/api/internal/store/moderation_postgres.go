package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

// moderationTarget loads a reply (which must be under postID) inside tx.
func moderationTarget(ctx context.Context, q *dbq.Queries, postID, replyID string) (pid, rid uuid.UUID, row dbq.ReplyForModerationRow, err error) {
	if pid, err = parseID(postID); err != nil {
		return
	}
	if rid, err = parseID(replyID); err != nil {
		return
	}
	row, err = q.ReplyForModeration(ctx, dbq.ReplyForModerationParams{ID: rid, PostID: pid})
	err = notFound(err)
	return
}

func requirePostAuthor(row dbq.ReplyForModerationRow, actorID string) error {
	if row.PostAuthorID.String() != actorID {
		return api.ErrForbidden
	}
	return nil
}

func (p *Postgres) DeleteReply(ctx context.Context, postID, replyID, actorID string) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		q := p.q.WithTx(tx)
		pid, rid, row, err := moderationTarget(ctx, q, postID, replyID)
		if err != nil {
			return err
		}
		if err := requirePostAuthor(row, actorID); err != nil {
			return err
		}
		n, err := q.DeleteReply(ctx, dbq.DeleteReplyParams{ID: rid, PostID: pid})
		if err != nil {
			return err
		}
		if n == 0 { // deleted concurrently
			return api.ErrNotFound
		}
		return q.ReleaseReplySlot(ctx, pid)
	})
}

func (p *Postgres) SetReplyPinned(ctx context.Context, postID, replyID, actorID string, pinned bool) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		q := p.q.WithTx(tx)
		pid, rid, row, err := moderationTarget(ctx, q, postID, replyID)
		if err != nil {
			return err
		}
		if err := requirePostAuthor(row, actorID); err != nil {
			return err
		}
		if pinned {
			// The partial unique index allows one pinned reply per post.
			if err := q.UnpinReplies(ctx, pid); err != nil {
				return err
			}
		}
		return q.SetReplyPinned(ctx, dbq.SetReplyPinnedParams{ID: rid, PostID: pid, Pinned: pinned})
	})
}

func (p *Postgres) ReportReply(ctx context.Context, postID, replyID, reporterID string, reason api.ReportReason, note string) error {
	uid, err := parseID(reporterID)
	if err != nil {
		return err
	}
	_, rid, row, err := moderationTarget(ctx, p.q, postID, replyID)
	if err != nil {
		return err
	}
	if row.ReplyAuthorID == uid {
		return api.ErrOwnReply
	}
	return p.q.UpsertReplyReport(ctx, dbq.UpsertReplyReportParams{
		ReplyID: rid, ReporterID: uid, Reason: string(reason), Note: note,
	})
}
