-- +goose Up
-- Metadata for processed uploads. Bytes live in the blob store under the
-- same id. posts.images / replies.images hold these ids.
CREATE TABLE images (
    id         uuid        PRIMARY KEY,           -- generated in Go (UUIDv7) so the blob can be written first
    owner_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    width      integer     NOT NULL CHECK (width BETWEEN 1 AND 1920),
    height     integer     NOT NULL CHECK (height BETWEEN 1 AND 1920),
    bytes      integer     NOT NULL CHECK (bytes > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX images_owner_id_idx ON images (owner_id);

-- Pre-upload rows stored image URLs; none exist outside dev, so clear them.
UPDATE posts SET images = '{}' WHERE images <> '{}';
UPDATE replies SET images = '{}' WHERE images <> '{}';

-- +goose Down
DROP TABLE images;
