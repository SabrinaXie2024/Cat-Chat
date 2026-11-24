import { HttpResponse, http } from 'msw'
import type { NewPost, NewReply, Post, Reply } from '../api/generated/model'
import { getGetHealthMockHandler } from '../api/generated/system/system.msw'
import {
  charCount,
  MAX_REPLIES_PER_POST,
  POST_MAX_CHARS,
  POST_MAX_IMAGES,
  REPLY_MAX_CHARS,
  REPLY_MAX_IMAGES,
} from '../lib/limits'

// Single source of mock truth for dev (browser) and tests (node).
// Stateful so create → list round-trips work; mirrors the Go server's rules.
// Types come from the generated client, so spec drift breaks typecheck.

type Db = { posts: Post[]; replies: Map<string, Reply[]> }

export const db: Db = { posts: [], replies: new Map() }

export function resetDb(seed: Post[] = defaultSeed()) {
  db.posts = structuredClone(seed)
  db.replies = new Map()
}

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

  http.get('*/api/posts', () => HttpResponse.json(db.posts)),

  http.post<never, NewPost>('*/api/posts', async ({ request }) => {
    const body = await request.json()
    const n = charCount(body.content)
    if (n === 0) return bad('content is required')
    if (n > POST_MAX_CHARS) return bad(`content must be at most ${POST_MAX_CHARS} characters`)
    if (body.images.length > POST_MAX_IMAGES)
      return bad(`at most ${POST_MAX_IMAGES} images allowed`)
    const post: Post = {
      id: id(),
      author: 'guest',
      content: body.content,
      images: body.images,
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
      const post = db.posts.find((p) => p.id === params.postId)
      if (!post) return bad('post not found', 404)
      const body = await request.json()
      const n = charCount(body.content)
      if (n === 0) return bad('content is required')
      if (n > REPLY_MAX_CHARS) return bad(`content must be at most ${REPLY_MAX_CHARS} characters`)
      if (body.images.length > REPLY_MAX_IMAGES)
        return bad(`at most ${REPLY_MAX_IMAGES} images allowed`)
      const list = db.replies.get(post.id) ?? []
      if (list.length >= MAX_REPLIES_PER_POST) {
        return bad('this post already has the maximum number of replies', 409)
      }
      const reply: Reply = {
        id: id(),
        postId: post.id,
        author: 'guest',
        content: body.content,
        images: body.images,
        createdAt: new Date().toISOString(),
      }
      db.replies.set(post.id, [...list, reply])
      post.replyCount++
      return HttpResponse.json(reply, { status: 201 })
    },
  ),
]
