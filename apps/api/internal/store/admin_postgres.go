package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

func (p *Postgres) ListOpenReports(ctx context.Context) ([]api.ReportedReply, error) {
	rows, err := p.q.ListOpenReports(ctx)
	if err != nil {
		return nil, err
	}
	out := []api.ReportedReply{}
	index := map[string]int{}
	for _, r := range rows {
		id := r.ReplyID.String()
		i, ok := index[id]
		if !ok {
			i = len(out)
			index[id] = i
			out = append(out, api.ReportedReply{
				PostId:      r.PostID.String(),
				PostExcerpt: r.PostExcerpt,
				Reply: api.Reply{
					Id: id, PostId: r.PostID.String(), AuthorId: r.AuthorID.String(), Author: r.Author,
					AuthorAvatar: api.Avatar(r.AuthorAvatar), Content: r.Content, Images: nonNil(r.Images),
					Pinned: r.Pinned, CreatedAt: r.ReplyCreatedAt.UTC(),
				},
				Reports: []api.ReportEntry{},
			})
		}
		out[i].Reports = append(out[i].Reports, api.ReportEntry{
			Reason: api.ReportReason(r.Reason), Note: r.Note, CreatedAt: r.ReportCreatedAt.UTC(),
			Reporter: api.UserSummary{Id: r.ReporterID.String(), Nickname: r.Reporter, Avatar: api.Avatar(r.ReporterAvatar)},
		})
	}
	return out, nil
}

func (p *Postgres) AdminDeleteReply(ctx context.Context, replyID string) error {
	rid, err := parseID(replyID)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		q := p.q.WithTx(tx)
		pid, err := q.ReplyPost(ctx, rid)
		if err != nil {
			return notFound(err)
		}
		n, err := q.DeleteReply(ctx, dbq.DeleteReplyParams{ID: rid, PostID: pid})
		if err != nil {
			return err
		}
		if n == 0 {
			return api.ErrNotFound
		}
		return q.ReleaseReplySlot(ctx, pid)
	})
}

func (p *Postgres) DismissReports(ctx context.Context, replyID string) error {
	rid, err := parseID(replyID)
	if err != nil {
		return err
	}
	if _, err := p.q.ReplyPost(ctx, rid); err != nil {
		return notFound(err)
	}
	_, err = p.q.DismissReports(ctx, rid)
	return err
}
