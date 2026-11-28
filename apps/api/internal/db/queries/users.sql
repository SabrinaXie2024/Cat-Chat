-- name: CreateUser :one
INSERT INTO users (email, nickname, password_hash)
VALUES ($1, $2, $3)
RETURNING id, email, nickname, avatar, created_at;

-- name: UserByEmail :one
SELECT id, email, nickname, avatar, created_at, password_hash
FROM users
WHERE email = $1;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, expires_at)
VALUES ($1, $2, $3);

-- name: UserBySession :one
SELECT u.id, u.email, u.nickname, u.avatar, u.created_at
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1 AND s.expires_at > @now::timestamptz;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = $1;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at <= @now::timestamptz;

-- name: UpdatePasswordHash :execrows
UPDATE users SET password_hash = $2 WHERE id = $1;

-- name: DeleteUserSessions :exec
DELETE FROM sessions WHERE user_id = $1;

-- name: UpdateProfile :one
UPDATE users
SET nickname = coalesce(sqlc.narg(nickname), nickname),
    avatar   = coalesce(sqlc.narg(avatar), avatar)
WHERE id = $1
RETURNING id, email, nickname, avatar, created_at;

-- name: GetProfile :one
SELECT u.id, u.nickname, u.avatar, u.created_at,
       (SELECT count(*) FROM posts p WHERE p.author_id = u.id)::int AS post_count,
       (SELECT count(*) FROM follows f WHERE f.followee_id = u.id)::int AS follower_count,
       (SELECT count(*) FROM follows f WHERE f.follower_id = u.id)::int AS following_count,
       EXISTS (SELECT 1 FROM follows f WHERE f.followee_id = u.id AND f.follower_id = sqlc.narg(viewer)::uuid) AS followed_by_me
FROM users u
WHERE u.id = $1;

-- name: UserExists :one
SELECT EXISTS (SELECT 1 FROM users WHERE id = $1);

-- name: Follow :exec
INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: Unfollow :exec
DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2;
