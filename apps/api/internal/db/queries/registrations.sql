-- name: GetPendingRegistration :one
SELECT * FROM pending_registrations WHERE email = $1;

-- name: SavePendingRegistration :exec
INSERT INTO pending_registrations
    (email, nickname, password_hash, code_hash, attempts, expires_at, last_sent_at, send_count, window_start)
VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)
ON CONFLICT (email) DO UPDATE SET
    nickname = EXCLUDED.nickname,
    password_hash = EXCLUDED.password_hash,
    code_hash = EXCLUDED.code_hash,
    attempts = 0,
    expires_at = EXCLUDED.expires_at,
    last_sent_at = EXCLUDED.last_sent_at,
    send_count = EXCLUDED.send_count,
    window_start = EXCLUDED.window_start;

-- name: IncrementPendingAttempts :one
UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = $1 RETURNING attempts;

-- name: DeletePendingRegistration :exec
DELETE FROM pending_registrations WHERE email = $1;

-- name: DeleteStalePendingRegistrations :execrows
-- Expired codes whose rate-limit window is also over carry no information.
DELETE FROM pending_registrations
WHERE expires_at <= @now::timestamptz AND window_start <= @window_cutoff::timestamptz;
