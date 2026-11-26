import { createFileRoute, Navigate } from '@tanstack/react-router'
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm'
import { useCurrentUser } from '../features/auth/useCurrentUser'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

const card = 'space-y-4 rounded-xl bg-white p-6 shadow-sm'

function SettingsPage() {
  const { data: user } = useCurrentUser()
  if (user === undefined) return null
  // No ?redirect=: account pages are never a post-login destination.
  if (user === null) return <Navigate to="/login" search={{ redirect: undefined }} replace />

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">账号设置</h1>
      <section className={card} aria-labelledby="account-info">
        <h2 id="account-info" className="text-lg font-semibold">
          账号信息
        </h2>
        <dl className="grid grid-cols-[4rem_1fr] gap-y-2 text-sm">
          <dt className="text-stone-500">昵称</dt>
          <dd>{user.nickname}</dd>
          <dt className="text-stone-500">邮箱</dt>
          <dd>{user.email}</dd>
        </dl>
      </section>
      <section className={card} aria-labelledby="change-password">
        <h2 id="change-password" className="text-lg font-semibold">
          修改密码
        </h2>
        <ChangePasswordForm email={user.email} />
      </section>
    </div>
  )
}
