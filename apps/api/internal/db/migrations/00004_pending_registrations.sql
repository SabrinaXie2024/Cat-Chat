-- +goose Up
-- Sign-ups waiting for their emailed code. A users row is only created once
-- the code is verified. One row per email; re-sending replaces the code.
CREATE TABLE pending_registrations (
    email         text        PRIMARY KEY CHECK (email = lower(email)),
    nickname      text        NOT NULL,
    password_hash text        NOT NULL,
    code_hash     text        NOT NULL,          -- sha256(email || ':' || code), hex
    attempts      integer     NOT NULL DEFAULT 0, -- wrong codes for the current code
    expires_at    timestamptz NOT NULL,
    last_sent_at  timestamptz NOT NULL,
    send_count    integer     NOT NULL,          -- sends within the current window
    window_start  timestamptz NOT NULL
);
CREATE INDEX pending_registrations_expires_at_idx ON pending_registrations (expires_at);

-- +goose Down
DROP TABLE pending_registrations;
