-- +goose Up
CREATE TABLE videos (
    id              uuid        PRIMARY KEY,       -- generated in Go; blob key
    owner_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    container       text        NOT NULL CHECK (container IN ('mp4', 'webm')),
    poster_image_id uuid        NOT NULL REFERENCES images (id),
    width           integer     NOT NULL CHECK (width > 0),
    height          integer     NOT NULL CHECK (height > 0),
    bytes           bigint      NOT NULL CHECK (bytes > 0),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- The site owner's own gallery ("我的猫咪"). Exactly one of image_id /
-- video_id is set, matching kind.
CREATE TABLE gallery_items (
    id         uuid        PRIMARY KEY DEFAULT uuidv7(),
    kind       text        NOT NULL CHECK (kind IN ('photo', 'video')),
    image_id   uuid        REFERENCES images (id) ON DELETE CASCADE,
    video_id   uuid        REFERENCES videos (id) ON DELETE CASCADE,
    caption    text        NOT NULL DEFAULT '' CHECK (char_length(caption) <= 200),
    created_by uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'photo') = (image_id IS NOT NULL)),
    CHECK ((kind = 'video') = (video_id IS NOT NULL))
);
CREATE INDEX gallery_items_created_at_idx ON gallery_items (created_at DESC);

-- +goose Down
DROP TABLE gallery_items;
DROP TABLE videos;
