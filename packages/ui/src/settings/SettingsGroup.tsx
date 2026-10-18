import { useId, type ReactNode } from 'react'

/** A titled section of a Studio settings-style page (Settings, Reading, the profile). */
export function SettingsGroup({
  title,
  children
}: {
  title: string
  children: ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section className="hoot-settings__group" aria-labelledby={id}>
      <h2 id={id} className="hoot-settings__heading">
        {title}
      </h2>
      {children}
    </section>
  )
}
