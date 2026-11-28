import { HttpResponse, http } from 'msw'
import {
  Avatar,
  type ChangePasswordRequest,
  type GalleryItem,
  type LoginRequest,
  type NewGalleryItem,
  type NewPost,
  type NewReply,
  type NewReport,
  type PasswordResetCompleteRequest,
  type PasswordResetStartRequest,
  type Post,
  type Profile,
  type ProfileUpdate,
  type RegisterRequest,
  type Reply,
  type ReportedReply,
  type ReportResolution,
  type User,
  type VerifyRegistrationRequest,
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
  /** `${followerId}>${followeeId}`, oldest first (Sets keep insertion order). */
  follows: Set<string>
  /** `${userId}>${postId}` */
  likes: Set<string>
  favorites: Set<string>
  /** Reply reports by `${replyId}>${reporterId}`. */
  reports: Map<string, NewReport & { status: 'open' | 'dismissed'; createdAt: string }>
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
  follows: new Set(),
  likes: new Set(),
  favorites: new Set(),
  reports: new Map(),
  pending: new Map(),
  resets: new Map(),
}

export function resetDb(seed: Post[] = defaultSeed()) {
  db.posts = structuredClone(seed)
  db.replies = new Map()
  db.users = [
    {
      id: 'demo',
      createdAt: new Date(0).toISOString(),
      isAdmin: true,
      avatar: Avatar.orange,
      ...DEMO_USER,
    },
    {
      id: SEED_AUTHOR_ID,
      email: 'juzi@meowsphere.dev',
      nickname: '橘子妈',
      password: crypto.randomUUID(),
      isAdmin: false,
      avatar: Avatar.calico,
      createdAt: new Date(0).toISOString(),
    },
  ]
  db.follows = new Set()
  db.likes = new Set()
  db.favorites = new Set()
  db.reports = new Map()
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

/** Counted and per-viewer fields, like the server computes them. */
function view(p: Post): Post {
  const me = db.sessionUserId
  return {
    ...p,
    likeCount: [...db.likes].filter((k) => k.endsWith(`>${p.id}`)).length,
    likedByMe: db.likes.has(`${me}>${p.id}`),
    favoritedByMe: db.favorites.has(`${me}>${p.id}`),
  }
}

/** Posts referenced by `${userId}>${postId}` keys, most recent first. */
function postsIn(set: Set<string>, userId: string): Post[] {
  return [...set]
    .reverse()
    .filter((k) => k.startsWith(`${userId}>`))
    .map((k) => db.posts.find((p) => `${userId}>${p.id}` === k))
    .filter((p): p is Post => !!p)
    .map(view)
}

const summary = (u: MockUser) => ({ id: u.id, nickname: u.nickname, avatar: u.avatar })

const currentUser = () => db.users.find((u) => u.id === db.sessionUserId)
const publicUser = ({ password: _, ...u }: MockUser): User => u

/** Author of the default seed post (a real mock user, so its profile works). */
export const SEED_AUTHOR_ID = 'seed-user'

function defaultSeed(): Post[] {
  return [
    {
      id: 'seed-1',
      authorId: SEED_AUTHOR_ID,
      author: '橘子妈',
      authorAvatar: Avatar.calico,
      likeCount: 0,
      likedByMe: false,
      favoritedByMe: false,
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
      avatar: Avatar.orange,
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

  http.get('*/api/posts', () => HttpResponse.json(db.posts.map(view))),

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
      authorId: user.id,
      author: user.nickname,
      authorAvatar: user.avatar,
      content: body.content,
      images,
      replyCount: 0,
      likeCount: 0,
      likedByMe: false,
      favoritedByMe: false,
      createdAt: new Date().toISOString(),
    }
    db.posts.unshift(post)
    return HttpResponse.json(post, { status: 201 })
  }),

  http.get<{ postId: string }>('*/api/posts/:postId/replies', ({ params }) => {
    if (!db.posts.some((p) => p.id === params.postId)) return bad('post not found', 404)
    const list = db.replies.get(params.postId) ?? []
    // Pinned first, then oldest first — like the server.
    return HttpResponse.json([...list.filter((r) => r.pinned), ...list.filter((r) => !r.pinned)])
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
        authorId: user.id,
        author: user.nickname,
        authorAvatar: user.avatar,
        content: body.content,
        images,
        pinned: false,
        createdAt: new Date().toISOString(),
      }
      db.replies.set(post.id, [...list, reply])
      post.replyCount++
      return HttpResponse.json(reply, { status: 201 })
    },
  ),
  http.patch<never, ProfileUpdate>('*/api/auth/me/profile', async ({ request }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    const body = await request.json()
    if (body.nickname !== undefined) {
      const n = body.nickname.trim()
      if (charCount(n) < 1 || charCount(n) > 20) return bad('nickname must be 1–20 characters')
      user.nickname = n
    }
    if (body.avatar !== undefined) {
      if (!Object.values(Avatar).includes(body.avatar)) return bad('unknown avatar')
      user.avatar = body.avatar
    }
    // Posts and replies show the author's current name/avatar (server joins).
    const sync = (x: Post | Reply) => {
      if (x.authorId === user.id) {
        x.author = user.nickname
        x.authorAvatar = user.avatar
      }
    }
    db.posts.forEach(sync)
    for (const list of db.replies.values()) list.forEach(sync)
    return HttpResponse.json(publicUser(user))
  }),

  http.get<{ userId: string }>('*/api/users/:userId', ({ params }) => {
    const u = db.users.find((x) => x.id === params.userId)
    if (!u) return bad('user not found', 404)
    const follows = [...db.follows].map((k) => k.split('>'))
    const profile: Profile = {
      id: u.id,
      nickname: u.nickname,
      avatar: u.avatar,
      createdAt: u.createdAt,
      postCount: db.posts.filter((p) => p.authorId === u.id).length,
      followerCount: follows.filter(([, b]) => b === u.id).length,
      followingCount: follows.filter(([a]) => a === u.id).length,
      followedByMe: db.follows.has(`${db.sessionUserId}>${u.id}`),
    }
    return HttpResponse.json(profile)
  }),

  http.get<{ userId: string }>('*/api/users/:userId/posts', ({ params }) => {
    if (!db.users.some((x) => x.id === params.userId)) return bad('user not found', 404)
    return HttpResponse.json(db.posts.filter((p) => p.authorId === params.userId).map(view))
  }),

  http.put<{ userId: string }>('*/api/users/:userId/follow', ({ params }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    if (user.id === params.userId) return bad("you can't follow yourself")
    if (!db.users.some((x) => x.id === params.userId)) return bad('user not found', 404)
    db.follows.add(`${user.id}>${params.userId}`)
    return new HttpResponse(null, { status: 204 })
  }),

  http.delete<{ userId: string }>('*/api/users/:userId/follow', ({ params }) => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    if (!db.users.some((x) => x.id === params.userId)) return bad('user not found', 404)
    db.follows.delete(`${user.id}>${params.userId}`)
    return new HttpResponse(null, { status: 204 })
  }),
  ...(['like', 'favorite'] as const).flatMap((kind) => {
    const set = () => (kind === 'like' ? db.likes : db.favorites)
    const toggle =
      (on: boolean) =>
      ({ params }: { params: { postId?: string | readonly string[] } }) => {
        const user = currentUser()
        if (!user) return bad('please sign in', 401)
        if (!db.posts.some((p) => p.id === params.postId)) return bad('post not found', 404)
        const key = `${user.id}>${params.postId}`
        if (on) set().add(key)
        else set().delete(key)
        return new HttpResponse(null, { status: 204 })
      }
    return [
      http.put(`*/api/posts/:postId/${kind}`, toggle(true)),
      http.delete(`*/api/posts/:postId/${kind}`, toggle(false)),
    ]
  }),

  http.get<{ userId: string }>('*/api/users/:userId/likes', ({ params }) => {
    if (!db.users.some((x) => x.id === params.userId)) return bad('user not found', 404)
    return HttpResponse.json(postsIn(db.likes, params.userId))
  }),

  http.get('*/api/auth/me/favorites', () => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    return HttpResponse.json(postsIn(db.favorites, user.id))
  }),

  ...(['followers', 'following'] as const).map((kind) =>
    http.get<{ userId: string }>(`*/api/users/:userId/${kind}`, ({ params }) => {
      if (!db.users.some((x) => x.id === params.userId)) return bad('user not found', 404)
      const ids = [...db.follows]
        .reverse()
        .map((k) => k.split('>') as [string, string])
        .filter(([a, b]) => (kind === 'followers' ? b : a) === params.userId)
        .map(([a, b]) => (kind === 'followers' ? a : b))
      return HttpResponse.json(
        ids.flatMap((id) => {
          const u = db.users.find((x) => x.id === id)
          return u ? [summary(u)] : []
        }),
      )
    }),
  ),
  // Reply moderation: the post's author may pin/delete; anyone but the
  // reply's author may report.
  ...(() => {
    type P = { postId: string; replyId: string }
    const find = (params: P) => {
      const post = db.posts.find((p) => p.id === params.postId)
      const list = db.replies.get(params.postId) ?? []
      const reply = list.find((r) => r.id === params.replyId)
      return post && reply ? { post, list, reply } : null
    }
    const guard = (params: P) => {
      const user = currentUser()
      if (!user) return bad('please sign in', 401)
      const found = find(params)
      if (!found) return bad('reply not found', 404)
      if (found.post.authorId !== user.id) return bad("only the post's author can do that", 403)
      return found
    }
    const pin =
      (on: boolean) =>
      ({ params }: { params: P }) => {
        const g = guard(params)
        if (g instanceof Response) return g
        if (on) for (const r of g.list) r.pinned = false
        g.reply.pinned = on
        return new HttpResponse(null, { status: 204 })
      }
    return [
      http.put<P>('*/api/posts/:postId/replies/:replyId/pin', pin(true)),
      http.delete<P>('*/api/posts/:postId/replies/:replyId/pin', pin(false)),
      http.delete<P>('*/api/posts/:postId/replies/:replyId', ({ params }) => {
        const user = currentUser()
        if (!user) return bad('please sign in', 401)
        const g = find(params)
        if (!g) return bad('reply not found', 404)
        if (g.post.authorId !== user.id && g.reply.authorId !== user.id)
          return bad("only the post's author or the comment's author can delete it", 403)
        db.replies.set(
          g.post.id,
          g.list.filter((r) => r.id !== g.reply.id),
        )
        g.post.replyCount--
        return new HttpResponse(null, { status: 204 })
      }),
      http.post<P, NewReport>(
        '*/api/posts/:postId/replies/:replyId/report',
        async ({ params, request }) => {
          const user = currentUser()
          if (!user) return bad('please sign in', 401)
          const found = find(params)
          if (!found) return bad('reply not found', 404)
          if (found.reply.authorId === user.id) return bad("you can't report your own reply")
          const body = await request.json()
          if (!['spam', 'abuse', 'inappropriate', 'other'].includes(body.reason))
            return bad('unknown report reason')
          const note = (body.note ?? '').trim()
          if (charCount(note) > 200) return bad('report note must be at most 200 characters')
          // Re-reporting moves the report to the back of the queue (Map order).
          db.reports.delete(`${found.reply.id}>${user.id}`)
          db.reports.set(`${found.reply.id}>${user.id}`, {
            reason: body.reason,
            note,
            status: 'open',
            createdAt: new Date().toISOString(),
          })
          return new HttpResponse(null, { status: 204 })
        },
      ),
    ]
  })(),
  http.get('*/api/admin/reports', () => {
    const user = currentUser()
    if (!user) return bad('please sign in', 401)
    if (!user.isAdmin) return bad('admin only', 403)
    const out: ReportedReply[] = []
    for (const [key, r] of db.reports) {
      if (r.status !== 'open') continue
      const [replyId, reporterId] = key.split('>')
      let group = out.find((g) => g.reply.id === replyId)
      if (!group) {
        const post = db.posts.find((p) => db.replies.get(p.id)?.some((x) => x.id === replyId))
        const reply = post && db.replies.get(post.id)?.find((x) => x.id === replyId)
        if (!post || !reply) continue
        group = {
          reply,
          postId: post.id,
          postExcerpt: [...post.content].slice(0, 80).join(''),
          reports: [],
        }
        out.push(group)
      }
      const reporter = db.users.find((u) => u.id === reporterId)
      if (reporter)
        group.reports.push({
          reason: r.reason,
          note: r.note ?? '',
          createdAt: r.createdAt,
          reporter: summary(reporter),
        })
    }
    return HttpResponse.json(out)
  }),

  http.post<{ replyId: string }, ReportResolution>(
    '*/api/admin/reports/:replyId',
    async ({ params, request }) => {
      const user = currentUser()
      if (!user) return bad('please sign in', 401)
      if (!user.isAdmin) return bad('admin only', 403)
      const { action } = await request.json()
      const post = db.posts.find((p) => db.replies.get(p.id)?.some((x) => x.id === params.replyId))
      if (!post) return bad('reply not found', 404)
      const mine = [...db.reports.keys()].filter((k) => k.startsWith(`${params.replyId}>`))
      if (action === 'delete') {
        db.replies.set(
          post.id,
          (db.replies.get(post.id) ?? []).filter((x) => x.id !== params.replyId),
        )
        post.replyCount--
        for (const k of mine) db.reports.delete(k)
      } else if (action === 'dismiss') {
        for (const k of mine) {
          const r = db.reports.get(k)
          if (r) r.status = 'dismissed'
        }
      } else return bad('action must be delete or dismiss')
      return new HttpResponse(null, { status: 204 })
    },
  ),
]
