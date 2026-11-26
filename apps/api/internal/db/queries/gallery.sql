-- name: CreateVideo :exec
INSERT INTO videos (id, owner_id, container, poster_image_id, width, height, bytes)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: VideoContainer :one
SELECT container FROM videos WHERE id = $1;

-- name: ImageDims :one
SELECT width, height FROM images WHERE id = $1;

-- name: VideoInfo :one
SELECT owner_id, container, poster_image_id, width, height FROM videos WHERE id = $1;

-- name: CreateGalleryItem :one
INSERT INTO gallery_items (kind, image_id, video_id, caption, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at;

-- name: ListGallery :many
SELECT g.id, g.kind, g.caption, g.created_at,
       g.image_id, i.width AS image_width, i.height AS image_height,
       g.video_id, v.poster_image_id, v.width AS video_width, v.height AS video_height
FROM gallery_items g
LEFT JOIN images i ON i.id = g.image_id
LEFT JOIN videos v ON v.id = g.video_id
ORDER BY g.created_at DESC, g.id DESC;

-- name: DeleteGalleryItem :execrows
DELETE FROM gallery_items WHERE id = $1;
