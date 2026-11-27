import { Link, useLocation } from '@tanstack/react-router'
import { ChevronDown, LogOut, Settings } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { safeRedirect, useCurrentUser, useSignOut } from './useCurrentUser'

export function UserMenu() {
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  const { pathname } = useLocation()

  if (user === undefined) return null
  if (user === null) {
    // safeRedirect drops account pages and the auth pages themselves.
    const redirect =
      pathname === '/login' || pathname === '/register' ? undefined : safeRedirect(pathname)
    return (
      <div className="flex gap-3 text-sm">
        <Link to="/login" search={{ redirect }} className="text-stone-600 hover:text-stone-900">
          {t('auth.login')}
        </Link>
        <Link to="/register" search={{ redirect }} className="font-medium text-brand-700">
          {t('auth.register')}
        </Link>
      </div>
    )
  }
  return <AccountDropdown nickname={user.nickname} />
}

const itemClass =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 focus:bg-stone-100 focus:outline-none'

function AccountDropdown({ nickname }: { nickname: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const { t } = useI18n()
  const signOut = useSignOut()
  const { pathname } = useLocation()

  // Close on navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger
  useEffect(() => setOpen(false), [pathname])

  // Close on outside click and Escape (Escape returns focus to the button).
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
      >
        {nickname}
        <ChevronDown
          className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('menu.label')}
          className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-xl border border-stone-100 bg-white py-1.5 shadow-lift"
        >
          <Link to="/settings" role="menuitem" className={itemClass}>
            <Settings className="size-4" aria-hidden />
            {t('menu.settings')}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              signOut.mutate()
            }}
            className={itemClass}
          >
            <LogOut className="size-4" aria-hidden />
            {t('menu.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
