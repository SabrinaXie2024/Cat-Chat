-- +goose Up
-- Preset cat avatars only (mirrors the Avatar enum in openapi.yaml).
ALTER TABLE users ADD COLUMN avatar text NOT NULL DEFAULT 'orange'
    CHECK (avatar IN ('orange', 'black', 'white', 'gray', 'calico', 'siamese', 'tuxedo', 'tabby'));

CREATE TABLE follows (
    follower_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followee_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC);

CREATE INDEX posts_author_created_idx ON posts (author_id, created_at DESC);

-- +goose Down
DROP INDEX posts_author_created_idx;
DROP TABLE follows;
ALTER TABLE users DROP COLUMN avatar;
