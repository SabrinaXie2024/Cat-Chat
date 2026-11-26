-- name: CreateImage :exec
INSERT INTO images (id, owner_id, width, height, bytes)
VALUES ($1, $2, $3, $4, $5);

-- name: CountOwnedImages :one
SELECT count(*) FROM images WHERE owner_id = $1 AND id = ANY(@ids::uuid[]);
