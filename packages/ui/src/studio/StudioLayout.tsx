import type { ReactNode } from 'react'

export interface StudioLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

/**
 * Studio's two-column frame over Mica: a heavier chrome sidebar and a
 * lighter content pane. The top strip of each column is a window drag
 * region (controls inside it opt out), and the pane keeps clear of the
 * Windows caption buttons via the titlebar-area env() variables.
 */
export function StudioLayout({ sidebar, children }: StudioLayoutProps): React.JSX.Element {
  return (
    <div className="hoot-studio">
      <aside className="hoot-studio__sidebar hoot-material hoot-material--chrome">{sidebar}</aside>
      <main className="hoot-studio__main hoot-material hoot-material--pane">{children}</main>
    </div>
  )
}
