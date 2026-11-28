import type { ReactNode } from 'react'
import type { Avatar } from '../../api/generated/model'
import {
  AVATAR_PRESETS,
  BREEDS,
  CatAvatar,
  COATS,
  EYES,
  PATTERNS,
  PRESET_NAMES,
  sameAvatar,
} from '../../components/CatAvatar'
import { useI18n } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'

const optionClass =
  'flex cursor-pointer flex-col items-center gap-1 rounded-xl p-1.5 text-center text-xs text-stone-600 ring-2 ring-transparent transition hover:bg-stone-50 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 has-[:checked]:ring-brand-400 has-[:focus-visible]:ring-brand-500'

/**
 * Avatar editor: a live preview, the 13 classic looks as one-click presets,
 * then breed / coat / pattern / eyes, each option previewed on the cat.
 */
export function AvatarBuilder({
  value,
  onChange,
}: {
  value: Avatar
  onChange: (a: Avatar) => void
}) {
  const { t } = useI18n()

  const part = <K extends keyof Avatar>(key: K, options: Avatar[K][], legend: MessageKey) => (
    <Group legend={t(legend)}>
      {options.map((o) => (
        <Option
          key={o}
          name={`avatar-${key}`}
          checked={value[key] === o}
          onSelect={() => onChange({ ...value, [key]: o })}
          preview={{ ...value, [key]: o }}
          label={t(`avatar.${key}.${o}` as MessageKey)}
        />
      ))}
    </Group>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <CatAvatar
          avatar={value}
          size="lg"
          label={t('profile.avatarPreview')}
          className="ring-4 ring-brand-100"
        />
        <p className="text-sm text-stone-500">{t('profile.avatarHint')}</p>
      </div>
      <Group legend={t('avatar.presets')}>
        {PRESET_NAMES.map((name) => (
          <Option
            key={name}
            name="avatar-preset"
            // Presets set colours and pattern; the chosen breed is kept.
            checked={sameAvatar({ ...value, breed: 'shorthair' }, AVATAR_PRESETS[name])}
            onSelect={() => onChange({ ...AVATAR_PRESETS[name], breed: value.breed })}
            preview={{ ...AVATAR_PRESETS[name], breed: value.breed }}
            label={t(`avatar.${name}`)}
          />
        ))}
      </Group>
      {part('breed', BREEDS, 'avatar.breed')}
      {part('coat', COATS, 'avatar.coat')}
      {part('pattern', PATTERNS, 'avatar.pattern')}
      {part('eyes', EYES, 'avatar.eyes')}
    </div>
  )
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-stone-700">{legend}</legend>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{children}</div>
    </fieldset>
  )
}

function Option({
  name,
  checked,
  onSelect,
  preview,
  label,
}: {
  name: string
  checked: boolean
  onSelect: () => void
  preview: Avatar
  label: string
}) {
  return (
    <label className={optionClass}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <CatAvatar avatar={preview} className="size-11" />
      {label}
    </label>
  )
}
