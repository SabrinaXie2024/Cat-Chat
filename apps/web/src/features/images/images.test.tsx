import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../mocks/handlers'
import { renderApp } from '../../test/render'

// Canvas/worker compression isn't available in happy-dom; pass files through.
vi.mock('browser-image-compression', () => ({ default: async (f: File) => f }))

const png = (name = 'cat.png', size = 1000, type = 'image/png') =>
  new File([new Uint8Array(size)], name, { type })

const postForm = async () =>
  (await screen.findByLabelText('分享你的猫咪日常')).closest('form') as HTMLFormElement

const fileInput = (scope: HTMLElement) =>
  scope.querySelector('input[type="file"]') as HTMLInputElement

describe('image upload', () => {
  beforeEach(() => {
    db.sessionUserId = 'demo'
  })

  it('uploads, previews, and attaches images to a new post', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const form = await postForm()
    await user.upload(fileInput(form), [png('a.png'), png('b.png')])

    const picked = within(form).getByRole('list', { name: '已选图片' })
    await waitFor(() =>
      expect(within(picked).getAllByRole('button', { name: /移除/ })).toHaveLength(2),
    )
    expect(within(form).getByText(/2\/5 张/)).toBeInTheDocument()

    await user.type(within(form).getByLabelText('分享你的猫咪日常'), '两张猫片')
    await user.click(within(form).getByRole('button', { name: '发布' }))

    const card = await screen.findByRole('listitem', { name: '演示用户 的帖子' })
    const imgs = within(within(card).getByRole('list', { name: '图片' })).getAllByRole('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]?.getAttribute('src')).toMatch(/^\/api\/images\//)
    // Form is cleared, including the picker.
    await waitFor(() => expect(within(form).getByText(/0\/5 张/)).toBeInTheDocument())
  })

  it('removes a picked image before posting', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const form = await postForm()
    await user.upload(fileInput(form), [png('a.png'), png('b.png')])
    await user.click(await within(form).findByRole('button', { name: '移除第 1 张图片' }))
    await waitFor(() => expect(within(form).getByText(/1\/5 张/)).toBeInTheDocument())
  })

  it('caps a post at 5 images and hides the add button when full', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const form = await postForm()
    await user.upload(
      fileInput(form),
      Array.from({ length: 6 }, (_, i) => png(`${i}.png`)),
    )
    expect(await within(form).findByRole('alert')).toHaveTextContent('最多 5 张图片')
    await waitFor(() => expect(within(form).getByText(/5\/5 张/)).toBeInTheDocument())
    expect(fileInput(form)).toBeNull()
  })

  it('rejects unsupported types and files over 5 MB in the browser', async () => {
    // applyAccept: false lets the test bypass the input's accept filter, like
    // a user choosing "All files" in the OS picker.
    const user = userEvent.setup({ applyAccept: false })
    renderApp('/community')
    const form = await postForm()
    await user.upload(fileInput(form), png('a.gif', 100, 'image/gif'))
    expect(await within(form).findByRole('alert')).toHaveTextContent('只支持 JPG、PNG、WebP 格式')
    await user.upload(fileInput(form), png('big.png', 5 * 1024 * 1024 + 1))
    expect(await within(form).findByRole('alert')).toHaveTextContent('单张图片不能超过 5MB')
    expect(db.images.size).toBe(0)
  })

  it('attaches up to 3 images to a reply', async () => {
    const user = userEvent.setup()
    renderApp('/community')
    const card = await screen.findByRole('listitem', { name: '橘子妈 的帖子' })
    await user.click(within(card).getByRole('button', { name: /回复 0\/10/ }))
    const box = await within(card).findByLabelText('写下你的回复')
    const form = box.closest('form') as HTMLFormElement
    expect(within(form).getByText(/0\/3 张/)).toBeInTheDocument()

    await user.upload(fileInput(form), png())
    await waitFor(() => expect(within(form).getByText(/1\/3 张/)).toBeInTheDocument())
    await user.type(box, '看我家的')
    await user.click(within(form).getByRole('button', { name: '回复' }))

    const replies = await within(card).findByRole('list', { name: '回复列表' })
    expect(await within(replies).findByRole('img')).toHaveAttribute(
      'src',
      expect.stringMatching(/^\/api\/images\//),
    )
  })
})
