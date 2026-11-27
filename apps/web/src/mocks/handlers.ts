import { HttpResponse, http } from 'msw'
import type {
  ChangePasswordRequest,
  GalleryItem,
  LoginRequest,
  NewGalleryItem,
  NewPost,
  NewReply,
  PasswordResetCompleteRequest,
  PasswordResetStartRequest,
  Post,
  RegisterRequest,
  Reply,
  User,
  VerifyRegistrationRequest,
} from '../api/generated/model'
import { getGetHealthMockHandler } from '../api/generated/system/system.msw'
import {
  charCount,
  GALLERY_CAPTION_MAX_CHARS,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  MAX_REPLIES_PER_POST,
  POST_MAX_CHARS,
  POST_MAX_IMAGES,
  REPLY_MAX_CHARS,
  REPLY_MAX_IMAGES,
  VIDEO_MAX_BYTES,
  VIDEO_TYPES,
} from '../lib/limits'

// Single source of mock truth for dev (browser) and tests (node).
// Stateful so create → list round-trips work; mirrors the Go server's rules.
// Types come from the generated client, so spec drift breaks typecheck.

type MockUser = User & { password: string } // plaintext: mock only
type Db = {
  posts: Post[]
  replies: Map<string, Reply[]>
  users: MockUser[]
  /** Signed-in user id. Stands in for the httpOnly session cookie. */
  sessionUserId: string | null
  /** Uploaded images by id. */
  images: Map<string, { ownerId: string; blob: Blob }>
  videos: Map<string, { ownerId: string; blob: Blob; posterId: string }>
  gallery: GalleryItem[] // newest first
  /** Forgot-password codes, by email (also for unknown emails, like the server). */
  resets: Map<string, { code: string; attempts: number; sentAt: number; expiresAt: number }>
  /** Sign-ups awaiting their code, by email. */
  pending: Map<
    string,
    {
      nickname: string
      password: string
      code: string
      attempts: number
      sentAt: number
      expiresAt: number
    }
  >
}

/** Every mock verification code (sign-up and password reset). */
export const MOCK_CODE = '123456'

/** Dev convenience account: demo@meowsphere.dev / password123 (admin). */
export const DEMO_USER = {
  email: 'demo@meowsphere.dev',
  password: 'password123',
  nickname: '演示用户',
}

export const db: Db = {
  posts: [],
  replies: new Map(),
  users: [],
  sessionUserId: null,
  images: new Map(),
  videos: new Map(),
  gallery: [],
  pending: new Map(),
  resets: new Map(),
}

export function resetDb(seed: Post[] = defaultSeed()) {
  db.posts = structuredClone(seed)
  db.replies = new Map()
  db.users = [{ id: 'demo', createdAt: new Date(0).toISOString(), isAdmin: true, ...DEMO_USER }]
  db.sessionUserId = null
  db.images = new Map()
  db.videos = new Map()
  db.gallery = []
  db.pending = new Map()
  db.resets = new Map()
}

const imageUrl = (imageId: string) => `/api/images/${imageId}`

/** Mirrors the server: every id must be an upload owned by `ownerId`. */
function resolveImages(ids: string[], ownerId: string): string[] | null {
  if (new Set(ids).size !== ids.length) return null
  if (!ids.every((i) => db.images.get(i)?.ownerId === ownerId)) return null
  return ids.map(imageUrl)
}

const currentUser = () => db.users.find((u) => u.id === db.sessionUserId)
const publicUser = ({ password: _, ...u }: MockUser): User => u

function defaultSeed(): Post[] {
  return [
    {
      id: 'seed-1',
      author: '橘子妈',
      content: '今天橘子又把杯子推下桌了 🙃',
      images: [],
      replyCount: 0,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
  ]
}
resetDb()

const bad = (message: string, status = 400) => HttpResponse.json({ message }, { status })
let seq = 0
const id = () => `mock-${++seq}`

export const handlers = [
  getGetHealthMockHandler({ status: 'ok' }),

  // Two-step sign-up, mirroring the server: start emails a 6-digit code
  // (here: stored in db.pending and logged), verify creates the account.
  http.post<never, RegisterRequest>('*/api/auth/register/start', async ({ request }) => {
    const body = await request.json()
    const email = body.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('invalid email address')
    const nickname = body.nickname.trim()
    if (charCount(nickname) < 1 || charCount(nickname) > 20)
      return bad('nickname must be 1–20 characters')
    if (body.password.length < 8 || body.password.length > 128)
      return bad('password must be 8–128 characters')
    if (db.users.some((u) => u.email === email)) return bad('this email is already registered', 409)
    const prev = db.pending.get(email)
    const now = Date.now()
    if (prev && now - prev.sentAt < 60_000) {
      return HttpResponse.json(
        {
          message: 'please wait before requesting another code',
          retryAfterSeconds: Math.ceil((prev.sentAt + 60_000 - now) / 1000),
        },
        { status: 429 },
      )
    }
    const code = MOCK_CODE
    db.pending.set(email, {
      nickname,
      password: body.password,
      code,
      attempts: 0,
      sentAt: now,
      expiresAt: now + 300_000,
    })
    if (typeof window !== 'undefined' && !import.meta.env.VITEST) {
      console.info(`[mock mail] verification code for ${email}: ${code}`)
    }
    return HttpResponse.json({ expiresInSeconds: 300, resendAfterSeconds: 60 }, { status: 202 })
  }),

  http.post<never, VerifyRegistrationRequest>('*/api/auth/register/verify', async ({ request }) => {
    const body = await request.json()
    const email = body.email.trim().toLowerCase()
    const p = db.pending.get(email)
    if (!p || Date.now() >= p.expiresAt || p.attempts >= 5)
      return bad('code expired, request a new one', 410)
    if (body.code !== p.code) {
      p.attempts++
      return HttpResponse.json(
        { message: 'incorrect verification code', attemptsLeft: Math.max(5 - p.attempts, 0) },
        { status: 400 },
      )
    }
    db.pending.delete(email)
    if (db.users.some((u) => u.email === email)) return bad('this email is already registered', 409)
    const user: MockUser = {
      id: id(),
      email,
      nickname: p.nickname,
      password: p.password,
      isAdmin: false,
      createdAt: new Date().toISOString(),
    }
    db.users.push(user)
    db.sessionUserId = user.id
    return HttpResponse.json(publicUser(user), { status: 201 })
  }),

  // Forgot password, mirroring the server: same 202 for unknown emails; a
  // code is only "sent" (stored in db.resets + logged) for real accounts.
  http.post<never, PasswordResetStartRequest>(
    '*/api/auth/password-reset/start',
    async ({ request }) => {
      const email = (await request.json()).email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('invalid email address')
      const now = Date.now()
      const prev = db.resets.get(email)
      if (prev && now - prev.sentAt < 60_000) {
        return HttpResponse.json(
          {
            message: 'please wait before requesting another code',
            retryAfterSeconds: Math.ceil((prev.sentAt + 60_000 - now) / 1000),
          },
          { status: 429 },
        )
      }
      const code = MOCK_CODE
      db.resets.set(email, { code, attempts: 0, sentAt: now, expiresAt: now + 300_000 })
      if (
        db.users.some((u) => u.email === email) &&
        typeof window !== 'undefined' &&
        !import.meta.env.VITEST
      ) {
        console.info(`[mock mail] password reset code for ${email}: ${code}`)
      }
      return HttpResponse.json({ expiresInSeconds: 300, resendAfterSeconds: 60 }, { status: 202 })
    },
  ),

  http.post<never, PasswordResetCompleteRequest>(
    '*/api/auth/password-reset/complete',
    async ({ request }) => {
      const body = await request.json()
      const email = body.email.trim().toLowerCase()
      if (body.newPassword.length < 8 || body.newPassword.length > 128) {
        return HttpResponse.json(
          { message: 'password must be 8–128 characters', attemptsLeft: -1 },
          { status: 400 },
        )
      }
      const r = db.resets.get(email)
      if (!r || Date.now() >= r.expiresAt || r.attempts >= 5)
        return bad('code expired, request a new one', 410)
      if (body.code !== r.code) {
        r.attempts++
        return HttpResponse.json(
          { message: 'incorrect verification code', attemptsLeft: Math.max(5 - r.attempts, 0) },
          { status: 400 },
        )
      }
      const user = db.users.find((u) => u.email === email)
      db.resets.delete(email)
      if (!user) return bad('code expired, request a new one', 410)
      user.password = body.newPassword
      db.sessionUserId = user.id
      return HttpResponse.json(publicUser(user))
    },
  ),

  http.post<never, LoginRequest>('*/api/auth/login', async ({ request }) => {
    const body = await request.json()
    const user = db.users.find((u) => u.email === body.email.trim().toLowerCase())
    if (!user || user.password !== body.password) return bad('incorrect email or password', 401)
    db.sessionUserId = user.id
    return HttpResponse.json(publicUser(user))
  }),

  http.post('*/api/auth/logout', () => {
    db.sessionUserId = null
    return new HttpResponse(null, { status: 204 })
  }),

  http.post<never, ChangePasswordRequest>('*/api/auth/password', async ({ request }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    const body = await request.json()
    if (body.currentPassword !== user.password) return bad('current password is incorrect', 403)
    if (body.newPassword.length < 8 || body.newPassword.length > 128)
      return bad('password must be 8–128 characters')
    if (body.newPassword === body.currentPassword)
      return bad('new password must differ from the current one')
    user.password = body.newPassword
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('*/api/images', async ({ request }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob)) return bad('missing file')
    if (file.size > IMAGE_MAX_BYTES) return bad('image must be at most 5 MB', 413)
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type))
      return bad('only JPEG, PNG and WebP images are supported')
    const imageId = crypto.randomUUID()
    db.images.set(imageId, { ownerId: user.id, blob: file })
    return HttpResponse.json(
      { id: imageId, url: imageUrl(imageId), width: 800, height: 600 },
      { status: 201 },
    )
  }),

  http.get<{ imageId: string }>('*/api/images/:imageId', ({ params }) => {
    const img = db.images.get(params.imageId)
    if (!img) return bad('image not found', 404)
    return new HttpResponse(img.blob, { headers: { 'Content-Type': img.blob.type } })
  }),

  http.get('*/api/gallery', () => HttpResponse.json(db.gallery)),

  http.post<never, NewGalleryItem>('*/api/gallery', async ({ request }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    if (!user.isAdmin) return bad('admin only', 403)
    const body = await request.json()
    if (charCount(body.caption) > GALLERY_CAPTION_MAX_CHARS)
      return bad('caption must be at most 200 characters')
    const base = { id: id(), caption: body.caption.trim(), createdAt: new Date().toISOString() }
    let item: GalleryItem
    if (body.kind === 'photo' && db.images.get(body.mediaId)?.ownerId === user.id) {
      item = { ...base, kind: 'photo', url: imageUrl(body.mediaId), width: 800, height: 600 }
    } else if (body.kind === 'video' && db.videos.get(body.mediaId)?.ownerId === user.id) {
      const v = db.videos.get(body.mediaId)
      item = {
        ...base,
        kind: 'video',
        url: `/api/videos/${body.mediaId}`,
        posterUrl: imageUrl(v?.posterId ?? ''),
        width: 640,
        height: 360,
      }
    } else {
      return bad('media must be your own upload')
    }
    db.gallery.unshift(item)
    return HttpResponse.json(item, { status: 201 })
  }),

  http.delete<{ itemId: string }>('*/api/gallery/:itemId', ({ params }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    if (!user.isAdmin) return bad('admin only', 403)
    const before = db.gallery.length
    db.gallery = db.gallery.filter((g) => g.id !== params.itemId)
    if (db.gallery.length === before) return bad('gallery item not found', 404)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post('*/api/videos', async ({ request }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    if (!user.isAdmin) return bad('admin only', 403)
    const file = (await request.formData()).get('file')
    if (!(file instanceof Blob)) return bad('missing file')
    if (file.size > VIDEO_MAX_BYTES) return bad('video must be at most 200 MB', 413)
    if (!(VIDEO_TYPES as readonly string[]).includes(file.type))
      return bad('only MP4 and WebM videos are supported')
    const videoId = crypto.randomUUID()
    const posterId = crypto.randomUUID()
    db.images.set(posterId, { ownerId: user.id, blob: new Blob([], { type: 'image/jpeg' }) })
    db.videos.set(videoId, { ownerId: user.id, blob: file, posterId })
    return HttpResponse.json(
      {
        id: videoId,
        url: `/api/videos/${videoId}`,
        posterUrl: imageUrl(posterId),
        width: 640,
        height: 360,
      },
      { status: 201 },
    )
  }),

  http.get<{ videoId: string }>('*/api/videos/:videoId', ({ params }) => {
    const v = db.videos.get(params.videoId)
    if (!v) return bad('video not found', 404)
    return new HttpResponse(v.blob, { headers: { 'Content-Type': v.blob.type } })
  }),

  http.get('*/api/auth/me', () => {
    const user = currentUser()
    return user ? HttpResponse.json(publicUser(user)) : bad('please sign in', 401)
  }),

  http.get('*/api/posts', () => HttpResponse.json(db.posts)),

  http.post<never, NewPost>('*/api/posts', async ({ request }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    const body = await request.json()
    const n = charCount(body.content)
    if (n === 0) return bad('content is required')
    if (n > POST_MAX_CHARS) return bad(`content must be at most ${POST_MAX_CHARS} characters`)
    if (body.images.length > POST_MAX_IMAGES)
      return bad(`at most ${POST_MAX_IMAGES} images allowed`)
    const images = resolveImages(body.images, user.id)
    if (!images) return bad('images must be your own uploads')
    const post: Post = {
      id: id(),
      author: user.nickname,
      content: body.content,
      images,
      replyCount: 0,
      createdAt: new Date().toISOString(),
    }
    db.posts.unshift(post)
    return HttpResponse.json(post, { status: 201 })
  }),

  http.get<{ postId: string }>('*/api/posts/:postId/replies', ({ params }) => {
    if (!db.posts.some((p) => p.id === params.postId)) return bad('post not found', 404)
    return HttpResponse.json(db.replies.get(params.postId) ?? [])
  }),

  http.post<{ postId: string }, NewReply>(
    '*/api/posts/:postId/replies',
    async ({ params, request }) => {
      const user = currentUser()
      if (!user) return bad('please sign in', 401)
      const post = db.posts.find((p) => p.id === params.postId)
      if (!post) return bad('post not found', 404)
      const body = await request.json()
      const n = charCount(body.content)
      if (n === 0) return bad('content is required')
      if (n > REPLY_MAX_CHARS) return bad(`content must be at most ${REPLY_MAX_CHARS} characters`)
      if (body.images.length > REPLY_MAX_IMAGES)
        return bad(`at most ${REPLY_MAX_IMAGES} images allowed`)
      const images = resolveImages(body.images, user.id)
      if (!images) return bad('images must be your own uploads')
      const list = db.replies.get(post.id) ?? []
      if (list.length >= MAX_REPLIES_PER_POST) {
        return bad('this post already has the maximum number of replies', 409)
      }
      const reply: Reply = {
        id: id(),
        postId: post.id,
        author: user.nickname,
        content: body.content,
        images,
        createdAt: new Date().toISOString(),
      }
      db.replies.set(post.id, [...list, reply])
      post.replyCount++
      return HttpResponse.json(reply, { status: 201 })
    },
  ),
]
