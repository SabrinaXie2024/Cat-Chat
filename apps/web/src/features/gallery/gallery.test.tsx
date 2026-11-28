import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryItem } from '../../api/generated/model'
import { db } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

vi.mock('browser-image-compression', () => ({ default: async (f: File) => f }))

const file = (name: string, type: string, size = 2000) =>
  new File([new Uint8Array(size)], name, { type })

function seedGallery() {
  const items: GalleryItem[] = [
    {
      id: 'g2',
      kind: 'video',
      url: '/api/videos/v1',
      posterUrl: '/api/images/p1',
      width: 640,
      height: 360,
      caption: '追逗猫棒',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'g1',
      kind: 'photo',
      url: '/api/images/i1',
      width: 800,
      height: 600,
      caption: '晒太阳',
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  ]
  db.gallery = items
}

const grid = () => screen.findByRole('list', { name: '我的猫咪相册' })

describe('gallery (visitor)', () => {
  it('shows photos and videos, newest first, without admin controls', async () => {
    seedGallery()
    renderApp('/gallery')
    const list = await grid()
    const cards = within(list).getAllByRole('listitem')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['追逗猫棒', '晒太阳'])

    const video = cards[0]?.querySelector('video')
    expect(video).toHaveAttribute('src', '/api/videos/v1')
    expect(video).toHaveAttribute('poster', '/api/images/p1')
    expect(video).toHaveAttribute('preload', 'none') // don't download until played
    expect(within(cards[1] as HTMLElement).getByRole('img', { name: '晒太阳' })).toHaveAttribute(
      'src',
      '/api/images/i1',
    )

    expect(screen.queryByText('添加照片或视频')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    renderApp('/gallery')
    expect(await screen.findByText('还没有照片或视频')).toBeInTheDocument()
  })

  it('signed-in non-admins still only view', async () => {
    db.users.push({
      id: 'u2',
      email: 'u2@cat.dev',
      nickname: '路人',
      password: 'password123',
      isAdmin: false,
      avatar: 'orange',
      createdAt: new Date().toISOString(),
    })
    db.sessionUserId = 'u2'
    renderApp('/gallery')
    expect(await screen.findByText('还没有照片或视频')).toBeInTheDocument()
    expect(screen.queryByText('添加照片或视频')).not.toBeInTheDocument()
  })
})

describe('gallery (admin)', () => {
  beforeEach(() => {
    db.sessionUserId = 'demo' // demo account is admin in mocks
  })
  afterEach(() => vi.unstubAllGlobals())

  const form = async () =>
    (await screen.findByRole('heading', { name: '添加照片或视频' })).closest(
      'form',
    ) as HTMLFormElement

  it('publishes a photo with a caption', async () => {
    const user = userEvent.setup()
    renderApp('/gallery')
    const f = await form()
    await user.upload(within(f).getByLabelText('选择照片或视频'), file('cat.png', 'image/png'))
    await user.type(within(f).getByLabelText('说明（可选）'), '午睡')
    await user.click(within(f).getByRole('button', { name: '发布' }))

    const card = await within(await grid()).findByRole('listitem', { name: '午睡' })
    expect(within(card).getByRole('img')).toHaveAttribute(
      'src',
      expect.stringMatching(/^\/api\/images\//),
    )
    await waitFor(() => expect(within(f).getByLabelText('说明（可选）')).toHaveValue(''))
  })

  it('uploads a video and shows it with a poster', async () => {
    const user = userEvent.setup()
    renderApp('/gallery')
    const f = await form()
    await user.upload(within(f).getByLabelText('选择照片或视频'), file('clip.mp4', 'video/mp4'))
    await user.click(within(f).getByRole('button', { name: '发布' }))

    const card = await within(await grid()).findByRole('listitem', { name: '视频' })
    const video = card.querySelector('video')
    expect(video?.getAttribute('src')).toMatch(/^\/api\/videos\//)
    expect(video?.getAttribute('poster')).toMatch(/^\/api\/images\//)
  })

  it('validates file and caption before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderApp('/gallery')
    const f = await form()
    await user.click(within(f).getByRole('button', { name: '发布' }))
    expect(await within(f).findByRole('alert')).toHaveTextContent('请先选择文件')

    await user.upload(
      within(f).getByLabelText('选择照片或视频'),
      file('clip.mov', 'video/quicktime'),
    )
    await user.click(within(f).getByRole('button', { name: '发布' }))
    expect(await within(f).findByRole('alert')).toHaveTextContent('只支持 MP4、WebM 格式的视频')

    await user.upload(within(f).getByLabelText('选择照片或视频'), file('cat.png', 'image/png'))
    await user.click(within(f).getByLabelText('说明（可选）'))
    await user.paste('猫'.repeat(201))
    await user.click(within(f).getByRole('button', { name: '发布' }))
    expect(await within(f).findByRole('alert')).toHaveTextContent('说明最多 200 字')
    expect(db.images.size).toBe(0)
  })

  it('deletes after confirmation, keeps on cancel', async () => {
    seedGallery()
    const confirm = vi.fn<(msg?: string) => boolean>()
    vi.stubGlobal('confirm', confirm)
    const user = userEvent.setup()
    renderApp('/gallery')
    const list = await grid()

    confirm.mockReturnValueOnce(false)
    await user.click(within(list).getByRole('button', { name: '删除 晒太阳' }))
    expect(db.gallery).toHaveLength(2)

    confirm.mockReturnValueOnce(true)
    await user.click(within(list).getByRole('button', { name: '删除 晒太阳' }))
    await waitFor(() =>
      expect(within(list).queryByRole('listitem', { name: '晒太阳' })).not.toBeInTheDocument(),
    )
    expect(db.gallery.map((g) => g.id)).toEqual(['g2'])
    expect(confirm).toHaveBeenCalledWith('确定删除这条内容吗？')
  })
})
