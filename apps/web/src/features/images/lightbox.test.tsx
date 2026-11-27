import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithQuery } from '../../test/render'
import { ImageGrid } from './ImageGrid'

const urls = ['/api/images/a', '/api/images/b', '/api/images/c']

function setup() {
  const user = userEvent.setup()
  renderWithQuery(<ImageGrid urls={urls} />)
  return user
}

const dialog = () => screen.getByRole('dialog', { name: '图片查看器' })
const shown = () => within(dialog()).getAllByRole('img')[0]

describe('image viewer', () => {
  it('opens in-page at the clicked image instead of a new tab', async () => {
    const user = setup()
    expect(document.querySelector('a[target="_blank"]')).toBeNull() // no new-tab links in the grid
    await user.click(screen.getByRole('button', { name: /图片 2/ }))
    expect(dialog()).toHaveAttribute('aria-modal', 'true')
    expect(shown()).toHaveAttribute('src', '/api/images/b')
    expect(within(dialog()).getByText('第 2 张，共 3 张')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden') // page scroll locked
    expect(within(dialog()).getByRole('button', { name: '关闭' })).toHaveFocus()
  })

  it('pages with buttons and arrow keys, wrapping around', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: /图片 3/ }))
    await user.click(within(dialog()).getByRole('button', { name: '下一张' }))
    expect(shown()).toHaveAttribute('src', '/api/images/a')
    await user.keyboard('{ArrowLeft}')
    expect(shown()).toHaveAttribute('src', '/api/images/c')
    await user.keyboard('{ArrowLeft}')
    expect(shown()).toHaveAttribute('src', '/api/images/b')
  })

  it('swipes on touch screens', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: /图片 1/ }))
    fireEvent.touchStart(dialog(), { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 150 }] })
    expect(shown()).toHaveAttribute('src', '/api/images/b')
    fireEvent.touchStart(dialog(), { touches: [{ clientX: 100 }] })
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 130 }] }) // too short: ignored
    expect(shown()).toHaveAttribute('src', '/api/images/b')
  })

  it('jumps via thumbnails and links to the original', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: /图片 1/ }))
    await user.click(within(dialog()).getByRole('button', { name: '第 3 张，共 3 张' }))
    expect(shown()).toHaveAttribute('src', '/api/images/c')
    const original = within(dialog()).getByRole('link', { name: '查看原图' })
    expect(original).toHaveAttribute('href', '/api/images/c')
    expect(original).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('closes on Esc and returns focus to the thumbnail', async () => {
    const user = setup()
    const thumb = screen.getByRole('button', { name: /图片 2/ })
    await user.click(thumb)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(thumb).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes on the close button and on a backdrop click, but not on the image', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: /图片 1/ }))
    await user.click(shown() as HTMLElement)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(dialog())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /图片 1/ }))
    await user.click(within(dialog()).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a single image has no paging controls', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ImageGrid urls={['/api/images/only']} />)
    await user.click(screen.getByRole('button', { name: /图片 1/ }))
    expect(within(dialog()).queryByRole('button', { name: '下一张' })).toBeNull()
    expect(within(dialog()).queryByText(/共/)).toBeNull()
  })
})
