-- Every post list selects the same columns (store converts rows to ListPostsRow).
-- name: ListPosts :many
SELECT p.id, p.author_id, u.nickname AS author, u.avatar AS author_avatar, p.content, p.images, p.reply_count, p.created_at,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = sqlc.narg(viewer)::uuid) AS liked_by_me,
       EXISTS (SELECT 1 FROM favorites f WHERE f.post_id = p.id AND f.user_id = sqlc.narg(viewer)::uuid) AS favorited_by_me
FROM posts p
JOIN users u ON u.id = p.author_id
ORDER BY p.created_at DESC, p.id DESC
LIMIT 100;

-- name: CreatePost :one
INSERT INTO posts (author_id, content, images)
VALUES ($1, $2, $3)
RETURNING id, content, images, reply_count, created_at;

-- name: PostExists :one
SELECT EXISTS (SELECT 1 FROM posts WHERE id = $1);

-- name: ListReplies :many
SELECT r.id, r.post_id, r.author_id, u.nickname AS author, u.avatar AS author_avatar, r.content, r.images, r.created_at
FROM replies r
JOIN users u ON u.id = r.author_id
WHERE r.post_id = $1
ORDER BY r.created_at, r.id;

-- Atomically claims one of the post's reply slots. Zero rows means the post
-- is missing or full; concurrent repliers can't push past the limit.
-- name: ClaimReplySlot :execrows
UPDATE posts
SET reply_count = reply_count + 1
WHERE id = $1 AND reply_count < @max_replies::int;

-- name: CreateReply :one
INSERT INTO replies (post_id, author_id, content, images)
VALUES ($1, $2, $3, $4)
RETURNING id, post_id, content, images, created_at;

-- name: ListUserPosts :many
SELECT p.id, p.author_id, u.nickname AS author, u.avatar AS author_avatar, p.content, p.images, p.reply_count, p.created_at,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = sqlc.narg(viewer)::uuid) AS liked_by_me,
       EXISTS (SELECT 1 FROM favorites f WHERE f.post_id = p.id AND f.user_id = sqlc.narg(viewer)::uuid) AS favorited_by_me
FROM posts p
JOIN users u ON u.id = p.author_id
WHERE p.author_id = sqlc.arg(author_id)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 100;

-- name: ListLikedPosts :many
SELECT p.id, p.author_id, u.nickname AS author, u.avatar AS author_avatar, p.content, p.images, p.reply_count, p.created_at,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = sqlc.narg(viewer)::uuid) AS liked_by_me,
       EXISTS (SELECT 1 FROM favorites f WHERE f.post_id = p.id AND f.user_id = sqlc.narg(viewer)::uuid) AS favorited_by_me
FROM posts p
JOIN users u ON u.id = p.author_id
JOIN likes mine ON mine.post_id = p.id
WHERE mine.user_id = sqlc.arg(user_id)
ORDER BY mine.created_at DESC, p.id DESC
LIMIT 100;

-- name: ListFavoritePosts :many
SELECT p.id, p.author_id, u.nickname AS author, u.avatar AS author_avatar, p.content, p.images, p.reply_count, p.created_at,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = sqlc.narg(viewer)::uuid) AS liked_by_me,
       EXISTS (SELECT 1 FROM favorites f WHERE f.post_id = p.id AND f.user_id = sqlc.narg(viewer)::uuid) AS favorited_by_me
FROM posts p
JOIN users u ON u.id = p.author_id
JOIN favorites mine ON mine.post_id = p.id
WHERE mine.user_id = sqlc.arg(user_id)
ORDER BY mine.created_at DESC, p.id DESC
LIMIT 100;

-- name: Like :exec
INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: Unlike :exec
DELETE FROM likes WHERE user_id = $1 AND post_id = $2;

-- name: Favorite :exec
INSERT INTO favorites (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: Unfavorite :exec
DELETE FROM favorites WHERE user_id = $1 AND post_id = $2;
