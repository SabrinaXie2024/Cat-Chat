-- +goose Up
-- Limits mirror packages/api-spec/openapi.yaml. They're enforced here too so
-- a bug in the HTTP layer can't write data the product says is impossible.
-- char_length counts characters, matching the API's rune-based limits.

CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT uuidv7(),
    email         text        NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) <= 254),
    nickname      text        NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 20),
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash text        PRIMARY KEY, -- sha256(cookie token), hex
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE posts (
    id          uuid        PRIMARY KEY DEFAULT uuidv7(),
    author_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content     text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
    images      text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(images) <= 5),
    reply_count integer     NOT NULL DEFAULT 0 CHECK (reply_count BETWEEN 0 AND 10),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_created_at_idx ON posts (created_at DESC);

CREATE TABLE replies (
    id         uuid        PRIMARY KEY DEFAULT uuidv7(),
    post_id    uuid        NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    author_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content    text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 100),
    images     text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(images) <= 3),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX replies_post_id_created_at_idx ON replies (post_id, created_at);

-- +goose Down
DROP TABLE replies;
DROP TABLE posts;
DROP TABLE sessions;
DROP TABLE users;
