import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Reply } from '../../api/generated/model'
import { DEMO_USER, db } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

const SEED_POST = 'seed-1'

/** Card for the seeded post, after the list has loaded. */
async function seedCard() {
  return screen.findByRole('listitem', { name: '橘子妈 的帖子' })
}

async function openReplies(user: ReturnType<typeof userEvent.setup>) {
  const card = await seedCard()
  const toggle = within(card).getByRole('button', { name: /回复 \d+\/10/ })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return card
}

function seedReplies(n: number) {
  const post = db.posts.find((p) => p.id === SEED_POST)
  if (!post) throw new Error('seed post missing')
  const replies: Reply[] = Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    postId: SEED_POST,
    author: '路人',
    content: `第 ${i + 1} 条回复`,
    images: [],
    createdAt: new Date(Date.now() - (n - i) * 60_000).toISOString(),
  }))
  db.replies.set(SEED_POST, replies)
  post.replyCount = n
}

describe('replies (signed out)', () => {
  it('lets anyone read replies (newest first), but asks to sign in to reply', async () => {
    seedReplies(2)
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    const list = await within(card).findByRole('list', { name: '回复列表' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('第 2 条回复'), expect.stringContaining('第 1 条回复')])
    expect(within(card).getByText(/后参与回复/)).toBeInTheDocument()
    expect(within(card).queryByLabelText('写下你的回复')).not.toBeInTheDocument()
  })
})

describe('replies (signed in)', () => {
  beforeEach(() => {
    db.sessionUserId = 'demo'
  })

  it('collapses again', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    expect(await within(card).findByText('还没有回复')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /收起回复/ }))
    expect(within(card).queryByText('还没有回复')).not.toBeInTheDocument()
  })

  it('posts a reply, shows it, clears the box and bumps the count', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    const box = await within(card).findByLabelText('写下你的回复')
    await user.type(box, '我家猫也这样！')
    await user.click(within(card).getByRole('button', { name: '回复' }))

    expect(await within(card).findByText('我家猫也这样！')).toBeInTheDocument()
    expect(within(card).getByText(new RegExp(DEMO_USER.nickname))).toBeInTheDocument()
    await waitFor(() => expect(box).toHaveValue(''))
    expect(within(card).getByRole('button', { name: /收起回复 1\/10/ })).toBeInTheDocument()
  })

  it('blocks replies over 100 characters', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    await user.click(await within(card).findByLabelText('写下你的回复'))
    await user.paste('喵'.repeat(101))
    expect(within(card).getByText('101/100')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: '回复' }))
    expect(await within(card).findByText('最多 100 字')).toBeInTheDocument()
    expect(db.replies.get(SEED_POST) ?? []).toHaveLength(0)
  })

  it('hides the form once the thread has 10 replies', async () => {
    seedReplies(10)
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    expect(await within(card).findByText(/已经有 10 条回复/)).toBeInTheDocument()
    expect(within(card).queryByLabelText('写下你的回复')).not.toBeInTheDocument()
  })

  it('explains a 409 when someone else takes the last slot', async () => {
    seedReplies(9)
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    const box = await within(card).findByLabelText('写下你的回复')
    seedReplies(10) // another user replies while we're typing
    await user.type(box, '最后一个位置')
    await user.click(within(card).getByRole('button', { name: '回复' }))
    // Toast explains it (asserted below); the refetch swaps the form for the notice.
    expect(await screen.findByText('回复已满，刚刚被别人抢先了')).toBeInTheDocument()
    expect(await within(card).findByText(/已经有 10 条回复/)).toBeInTheDocument()
    expect(db.replies.get(SEED_POST)).toHaveLength(10)
  })
})

describe('reply layout', () => {
  beforeEach(() => {
    db.sessionUserId = 'demo'
  })

  it('puts the reply box above the list, and the newest reply on top', async () => {
    seedReplies(2)
    const user = userEvent.setup()
    renderApp('/community')
    const card = await openReplies(user)
    const box = await within(card).findByLabelText('写下你的回复')
    const list = within(card).getByRole('list', { name: '回复列表' })
    // DOCUMENT_POSITION_FOLLOWING: list comes after the box.
    expect(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.type(box, '刚刚发的')
    await user.click(within(card).getByRole('button', { name: '回复' }))
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('刚刚发的'),
    )
  })
})
