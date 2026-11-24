import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/gallery')({ component: Gallery })

function Gallery() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">我的猫咪</h1>
      <p className="text-stone-600">照片和视频即将上线。</p>
    </section>
  )
}
