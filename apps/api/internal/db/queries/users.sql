-- name: CreateUser :one
INSERT INTO users (email, nickname, password_hash)
VALUES ($1, $2, $3)
RETURNING id, email, nickname, created_at;

-- name: UserByEmail :one
SELECT id, email, nickname, created_at, password_hash
FROM users
WHERE email = $1;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, expires_at)
VALUES ($1, $2, $3);

-- name: UserBySession :one
SELECT u.id, u.email, u.nickname, u.created_at
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1 AND s.expires_at > @now::timestamptz;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = $1;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at <= @now::timestamptz;
