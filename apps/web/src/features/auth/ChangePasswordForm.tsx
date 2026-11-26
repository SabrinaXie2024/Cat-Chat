import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useChangePassword } from '../../api/generated/auth/auth'
import { errorMessage } from '../../api/http'
import { Field, inputClass, submitClass } from './AuthCard'

// Must match apps/api/internal/api/auth.go.
const schema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z.string().min(8, '新密码至少 8 位').max(128, '新密码最多 128 位'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: '两次输入的新密码不一致',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: '新密码不能和当前密码相同',
  })
type Values = z.infer<typeof schema>

export function ChangePasswordForm({ email }: { email: string }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })
  const change = useChangePassword({
    mutation: {
      onSuccess: () => {
        form.reset()
        toast.success('密码已修改，其他设备上的登录已失效')
      },
    },
  })
  const { errors } = form.formState

  return (
    <form
      onSubmit={form.handleSubmit(({ currentPassword, newPassword }) =>
        change.mutate({ data: { currentPassword, newPassword } }),
      )}
      className="space-y-4"
      noValidate
    >
      {/* Lets password managers attach the new password to the right
          account instead of guessing. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field id="currentPassword" label="当前密码" error={errors.currentPassword?.message}>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          {...form.register('currentPassword')}
        />
      </Field>
      <Field id="newPassword" label="新密码（至少 8 位）" error={errors.newPassword?.message}>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('newPassword')}
        />
      </Field>
      <Field id="confirm" label="确认新密码" error={errors.confirm?.message}>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('confirm')}
        />
      </Field>
      {change.error && (
        <p role="alert" className="text-sm text-red-600">
          {changeErrorText(change.error)}
        </p>
      )}
      <button type="submit" disabled={change.isPending} className={submitClass}>
        修改密码
      </button>
    </form>
  )
}

function changeErrorText(err: unknown) {
  const msg = errorMessage(err)
  if (msg.startsWith('current password')) return '当前密码不正确'
  if (msg.startsWith('too many')) return '失败次数太多，请 15 分钟后再试'
  if (msg.startsWith('new password must differ')) return '新密码不能和当前密码相同'
  return msg
}
