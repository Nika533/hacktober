import '@hoot/ui/styles.css'
import './agent.css'
import { DEFAULT_SUBSCRIPTIONS, type HootApi } from '@hoot/core'
import { Agent, applyAccent, applyTheme, HootUIProvider, useHootState } from '@hoot/ui'
import { useEffect } from 'react'

const SLICES = DEFAULT_SUBSCRIPTIONS.agent
/** Main opens each agent's window at agent.html#<agent id>. */
const AGENT_ID = decodeURIComponent(window.location.hash.slice(1))

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <AgentWindow hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

/** One agent's window: its chat card, or its coloured owl (main owns the size). */
function AgentWindow({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element | null {
  const { state } = useHootState(hoot, SLICES)
  const agent = state?.agents?.list.find((a) => a.id === AGENT_ID)
  const system = state?.system

  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  const title =
    agent && (agent.session?.title ? `${agent.session.title} – ${agent.name}` : agent.name)
  useEffect(() => {
    if (title) document.title = title
  }, [title])

  if (!hoot || !agent) return null
  return <Agent host={hoot} agent={agent} />
}
