import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">欢迎来到 Cat Chat 🐾</h1>
      <p className="text-stone-600">养猫攻略、我家猫咪的日常，以及和大家分享你的猫。</p>
      <Link
        to="/community"
        className="inline-block rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-700"
      >
        去看看猫咪日常
      </Link>
    </section>
  )
}
