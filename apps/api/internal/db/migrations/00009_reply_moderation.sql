-- +goose Up
ALTER TABLE replies ADD COLUMN pinned boolean NOT NULL DEFAULT false;
-- At most one pinned reply per post.
CREATE UNIQUE INDEX replies_one_pinned_idx ON replies (post_id) WHERE pinned;

-- Reply reports, reviewed by site admins. One per (reply, reporter);
-- reporting again updates it.
CREATE TABLE reply_reports (
    id          uuid        PRIMARY KEY DEFAULT uuidv7(),
    reply_id    uuid        NOT NULL REFERENCES replies (id) ON DELETE CASCADE,
    reporter_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason      text        NOT NULL CHECK (reason IN ('spam', 'abuse', 'inappropriate', 'other')),
    note        text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reply_id, reporter_id)
);
CREATE INDEX reply_reports_open_idx ON reply_reports (created_at) WHERE status = 'open';

-- +goose Down
DROP TABLE reply_reports;
DROP INDEX replies_one_pinned_idx;
ALTER TABLE replies DROP COLUMN pinned;
