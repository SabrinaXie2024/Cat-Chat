-- +goose Up
-- New preset avatar: 狸花 (Dragon Li). Mirrors the Avatar enum.
ALTER TABLE users DROP CONSTRAINT users_avatar_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_check
    CHECK (avatar IN ('orange', 'black', 'white', 'gray', 'calico', 'siamese', 'tuxedo', 'tabby',
                      'silver', 'tortie', 'cream', 'orange-white', 'lihua'));

CREATE TABLE likes (
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_idx ON likes (post_id);
CREATE INDEX likes_user_created_idx ON likes (user_id, created_at DESC);

-- Favorites are private to their owner.
CREATE TABLE favorites (
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX favorites_user_created_idx ON favorites (user_id, created_at DESC);

CREATE INDEX follows_follower_idx ON follows (follower_id, created_at DESC);

-- +goose Down
DROP INDEX follows_follower_idx;
DROP TABLE favorites;
DROP TABLE likes;
UPDATE users SET avatar = 'tabby' WHERE avatar = 'lihua';
ALTER TABLE users DROP CONSTRAINT users_avatar_check;
ALTER TABLE users ADD CONSTRAINT users_avatar_check
    CHECK (avatar IN ('orange', 'black', 'white', 'gray', 'calico', 'siamese', 'tuxedo', 'tabby',
                      'silver', 'tortie', 'cream', 'orange-white'));
