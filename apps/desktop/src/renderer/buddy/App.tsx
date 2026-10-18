import '@hoot/ui/styles.css'
import './buddy.css'
import { DEFAULT_SUBSCRIPTIONS, type HootApi } from '@hoot/core'
import { applyAccent, applyTheme, Buddy, HootUIProvider, useHootState } from '@hoot/ui'
import { useEffect } from 'react'

const SLICES = DEFAULT_SUBSCRIPTIONS.buddy

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <BuddyWindow hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

/** The transparent, always-on-top buddy window: main owns its mode and bounds. */
function BuddyWindow({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element | null {
  const { state } = useHootState(hoot, SLICES)

  const system = state?.system
  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  // Nothing to draw until main answers; the window stays fully transparent.
  if (!hoot || !state?.buddy || !state.chat || !state.settings) return null
  return (
    <Buddy
      host={hoot}
      buddy={state.buddy}
      chat={state.chat}
      voice={state.voice}
      captureHotkey={state.settings.settings.captureHotkey}
    />
  )
}
