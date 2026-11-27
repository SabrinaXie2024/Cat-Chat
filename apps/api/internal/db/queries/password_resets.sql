-- name: GetPasswordReset :one
SELECT * FROM password_resets WHERE email = $1;

-- name: SavePasswordReset :exec
INSERT INTO password_resets (email, code_hash, attempts, expires_at, last_sent_at, send_count, window_start)
VALUES ($1, $2, 0, $3, $4, $5, $6)
ON CONFLICT (email) DO UPDATE SET
    code_hash = EXCLUDED.code_hash,
    attempts = 0,
    expires_at = EXCLUDED.expires_at,
    last_sent_at = EXCLUDED.last_sent_at,
    send_count = EXCLUDED.send_count,
    window_start = EXCLUDED.window_start;

-- name: IncrementPasswordResetAttempts :one
UPDATE password_resets SET attempts = attempts + 1 WHERE email = $1 RETURNING attempts;

-- name: DeletePasswordReset :exec
DELETE FROM password_resets WHERE email = $1;

-- name: DeleteStalePasswordResets :execrows
DELETE FROM password_resets
WHERE expires_at <= @now::timestamptz AND window_start <= @window_cutoff::timestamptz;
