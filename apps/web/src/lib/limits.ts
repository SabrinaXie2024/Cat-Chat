// Content limits — must match packages/api-spec/openapi.yaml and
// apps/api/internal/api/server.go.
export const POST_MAX_CHARS = 500
export const POST_MAX_IMAGES = 5
export const REPLY_MAX_CHARS = 100
export const REPLY_MAX_IMAGES = 3
export const MAX_REPLIES_PER_POST = 10
// 我的猫咪 gallery (admin uploads) — must match apps/api.
export const GALLERY_CAPTION_MAX_CHARS = 200
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const

// Account rules — must match apps/api/internal/api/auth.go.
export const NICKNAME_MAX_CHARS = 20
export const PASSWORD_MIN_CHARS = 8
export const PASSWORD_MAX_CHARS = 128

// Image uploads: comparable sites (小红书/Instagram/Reddit) accept large
// originals but store ~1080–2048px. We cap the original at 5 MB and compress
// in the browser to ≤ 1920px / ~1 MB before upload.
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const IMAGE_MAX_EDGE_PX = 1920
export const IMAGE_TARGET_MB = 1

/** Counts user-perceived characters, so emoji and CJK count as one each. */
export function charCount(s: string): number {
  return [...s.trim()].length
}
