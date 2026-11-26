package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/cat-chat/api/internal/api"
	"github.com/cat-chat/api/internal/db/dbq"
)

func (p *Postgres) CreateVideo(ctx context.Context, v api.VideoRecord) error {
	id, err := uuid.Parse(v.ID)
	if err != nil {
		return err
	}
	owner, err := parseID(v.OwnerID)
	if err != nil {
		return err
	}
	poster, err := uuid.Parse(v.PosterImageID)
	if err != nil {
		return err
	}
	return p.q.CreateVideo(ctx, dbq.CreateVideoParams{
		ID: id, OwnerID: owner, Container: v.Container, PosterImageID: poster,
		Width: int32(v.Width), Height: int32(v.Height), Bytes: v.Size,
	})
}

func (p *Postgres) VideoContainer(ctx context.Context, id string) (string, error) {
	vid, err := parseID(id)
	if err != nil {
		return "", err
	}
	c, err := p.q.VideoContainer(ctx, vid)
	return c, notFound(err)
}

func (p *Postgres) CreateGalleryItem(ctx context.Context, author api.User, kind, mediaID, caption string) (api.GalleryEntry, error) {
	uid, err := parseID(author.Id)
	if err != nil {
		return api.GalleryEntry{}, err
	}
	mid, err := uuid.Parse(mediaID)
	if err != nil {
		return api.GalleryEntry{}, api.ErrInvalidMedia
	}
	var out api.GalleryEntry
	err = pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		q := p.q.WithTx(tx)
		params := dbq.CreateGalleryItemParams{Kind: kind, Caption: caption, CreatedBy: uid}
		out = api.GalleryEntry{Kind: kind, Caption: caption}
		switch kind {
		case "photo":
			n, err := q.CountOwnedImages(ctx, dbq.CountOwnedImagesParams{OwnerID: uid, Ids: []uuid.UUID{mid}})
			if err != nil {
				return err
			}
			if n != 1 {
				return api.ErrInvalidMedia
			}
			dims, err := q.ImageDims(ctx, mid)
			if err != nil {
				return err
			}
			params.ImageID = &mid
			out.ImageID, out.Width, out.Height = mid.String(), int(dims.Width), int(dims.Height)
		case "video":
			v, err := q.VideoInfo(ctx, mid)
			if errors.Is(err, pgx.ErrNoRows) {
				return api.ErrInvalidMedia
			}
			if err != nil {
				return err
			}
			if v.OwnerID != uid {
				return api.ErrInvalidMedia
			}
			params.VideoID = &mid
			out.VideoID, out.PosterImageID = mid.String(), v.PosterImageID.String()
			out.Width, out.Height = int(v.Width), int(v.Height)
		default:
			return api.ErrInvalidMedia
		}
		row, err := q.CreateGalleryItem(ctx, params)
		if err != nil {
			return err
		}
		out.ID, out.CreatedAt = row.ID.String(), row.CreatedAt.UTC()
		return nil
	})
	return out, err
}

func (p *Postgres) ListGallery(ctx context.Context) ([]api.GalleryEntry, error) {
	rows, err := p.q.ListGallery(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]api.GalleryEntry, len(rows))
	for i, r := range rows {
		e := api.GalleryEntry{ID: r.ID.String(), Kind: r.Kind, Caption: r.Caption, CreatedAt: r.CreatedAt.UTC()}
		if r.ImageID != nil {
			e.ImageID, e.Width, e.Height = r.ImageID.String(), int(deref(r.ImageWidth)), int(deref(r.ImageHeight))
		}
		if r.VideoID != nil {
			e.VideoID, e.Width, e.Height = r.VideoID.String(), int(deref(r.VideoWidth)), int(deref(r.VideoHeight))
			if r.PosterImageID != nil {
				e.PosterImageID = r.PosterImageID.String()
			}
		}
		out[i] = e
	}
	return out, nil
}

func (p *Postgres) DeleteGalleryItem(ctx context.Context, id string) error {
	gid, err := parseID(id)
	if err != nil {
		return err
	}
	n, err := p.q.DeleteGalleryItem(ctx, gid)
	if err != nil {
		return err
	}
	if n == 0 {
		return api.ErrNotFound
	}
	return nil
}

func deref(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}
