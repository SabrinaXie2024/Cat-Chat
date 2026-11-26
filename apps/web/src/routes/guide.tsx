import { createFileRoute } from '@tanstack/react-router'
import Markdown from 'react-markdown'
import guideEn from '../content/guide.en.md?raw'
import guideZh from '../content/guide.md?raw'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/guide')({ component: Guide })

function Guide() {
  const { lang } = useI18n()
  return (
    <article className="space-y-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <Markdown>{lang === 'zh' ? guideZh : guideEn}</Markdown>
    </article>
  )
}
