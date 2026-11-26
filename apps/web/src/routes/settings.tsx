import { createFileRoute, Navigate } from '@tanstack/react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm'
import { useCurrentUser } from '../features/auth/useCurrentUser'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const { data: user } = useCurrentUser()
  if (user === undefined) return null
  if (user === null) return <Navigate to="/login" search={{ redirect: '/settings' }} replace />

  return (
    <div className="space-y-6">
      <section className="mx-auto max-w-sm space-y-1 text-sm text-stone-600">
        <p>
          昵称：<span className="text-stone-900">{user.nickname}</span>
        </p>
        <p>
          邮箱：<span className="text-stone-900">{user.email}</span>
        </p>
      </section>
      <AuthCard title="修改密码">
        <ChangePasswordForm email={user.email} />
      </AuthCard>
    </div>
  )
}
