-- +goose Up
-- Forgot-password codes. Rows are also kept for unregistered emails (with a
-- code nobody received) so rate limits behave identically and reveal nothing.
CREATE TABLE password_resets (
    email        text        PRIMARY KEY CHECK (email = lower(email)),
    code_hash    text        NOT NULL,
    attempts     integer     NOT NULL DEFAULT 0,
    expires_at   timestamptz NOT NULL,
    last_sent_at timestamptz NOT NULL,
    send_count   integer     NOT NULL,
    window_start timestamptz NOT NULL
);

-- +goose Down
DROP TABLE password_resets;
