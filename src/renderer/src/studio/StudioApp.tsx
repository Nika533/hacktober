import { useEffect } from 'react'
import { useAnnouncements, useAppState } from '../shared/hooks'
import { Sidebar } from './Sidebar'
import { ChatPane } from './ChatPane'
import { SettingsPane } from './SettingsPane'
import { Onboarding } from './Onboarding'

export function StudioApp(): React.JSX.Element | null {
  const state = useAppState()
  const liveMsg = useAnnouncements(state)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'l') window.hoot.windows.lock()
        else if (e.key === 'n') window.hoot.sessions.new()
        else return
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!state) return null
  if (state.studioView === 'onboarding') return <Onboarding state={state} />
  return (
    <div className="studio">
      <div className="visually-hidden" aria-live="polite">
        {liveMsg}
      </div>
      <Sidebar state={state} />
      {state.studioView === 'settings' ? (
        <SettingsPane state={state} />
      ) : (
        <ChatPane state={state} />
      )}
    </div>
  )
}
