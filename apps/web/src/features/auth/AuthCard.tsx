import type { ReactNode } from 'react'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
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
    <div className="space-y-1">
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

export const inputClass =
  'w-full rounded-lg border border-stone-200 px-3 py-2 focus:border-brand-500 focus:outline-none'

export const submitClass =
  'w-full rounded-lg bg-brand-500 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50'
