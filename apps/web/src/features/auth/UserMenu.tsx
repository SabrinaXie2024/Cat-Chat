import { Link, useLocation } from '@tanstack/react-router'
import { useCurrentUser, useSignOut } from './useCurrentUser'

export function UserMenu() {
  const { data: user } = useCurrentUser()
  const signOut = useSignOut()
  const { pathname } = useLocation()

  if (user === undefined) return null
  if (user === null) {
    const redirect = pathname === '/login' || pathname === '/register' ? undefined : pathname
    return (
      <div className="ml-auto flex gap-3 text-sm">
        <Link to="/login" search={{ redirect }} className="text-stone-600 hover:text-stone-900">
          登录
        </Link>
        <Link to="/register" search={{ redirect }} className="font-medium text-brand-700">
          注册
        </Link>
      </div>
    )
  }
  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      <Link to="/settings" className="text-stone-700 hover:text-stone-900" title="账号设置">
        {user.nickname}
      </Link>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        className="text-stone-500 hover:text-stone-900"
      >
        退出
      </button>
    </div>
  )
}
