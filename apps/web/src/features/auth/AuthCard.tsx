import type { ReactNode } from 'react'
import { buttonClass, inputClass as sharedInput } from '../../components/ui'

/** Centered card for sign-in / sign-up / reset pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-md py-4 sm:py-8">
      <div className="space-y-5 rounded-3xl bg-white p-6 shadow-lift ring-1 ring-stone-100 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-100 to-amber-50 text-3xl"
            aria-hidden
          >
            🐱
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        </div>
        {children}
      </div>
    </section>
  )
}

export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export const inputClass = sharedInput

export const submitClass = `${buttonClass.primary} w-full py-2.5`
