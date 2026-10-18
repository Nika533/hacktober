import type { HootApi } from '@hoot/core'
import type { CodeActionResult, CodeTagState } from '@hoot/core/code'
import { useCallback, useEffect, useState } from 'react'

/** `window.hoot.code`: what an answer's Show / Apply buttons ask of the code link. */
export type CodeActionsApi = HootApi['code']

export interface CodeActionNote {
  ok: boolean
  text: string
}

export interface CodeActions {
  /** undefined: not loaded yet; null: Hoot didn't read code for this answer. */
  states: CodeTagState[] | null | undefined
  /** The tag whose action is running. */
  busy: number | null
  /** What VS Code said about each tag's last action. */
  notes: Record<number, CodeActionNote>
  run(index: number, kind: 'apply' | 'reveal'): Promise<void>
}

const UNREACHABLE: CodeActionResult = { ok: false, message: 'Hoot couldn’t reach VS Code.' }

/**
 * An answer's code tags as the code link sees them (loaded once the answer is
 * `ready`, and again whenever VS Code changes), plus Show and Apply. Apply is
 * the user's call every time; VS Code checks the code is still what Hoot read.
 */
export function useCodeActions(
  api: CodeActionsApi | undefined,
  messageId: string,
  ready: boolean
): CodeActions {
  const [states, setStates] = useState<CodeTagState[] | null | undefined>(undefined)
  const [busy, setBusy] = useState<number | null>(null)
  const [notes, setNotes] = useState<Record<number, CodeActionNote>>({})

  useEffect(() => {
    if (!api || !ready) return
    let live = true
    const load = (): void =>
      void api.tagStates(messageId).then(
        (next) => {
          if (live) setStates(next)
        },
        () => {
          if (live) setStates(null)
        }
      )
    load()
    const off = api.onChange(load)
    return () => {
      live = false
      off()
    }
  }, [api, messageId, ready])

  const run = useCallback(
    async (index: number, kind: 'apply' | 'reveal'): Promise<void> => {
      if (!api) return
      setBusy(index)
      const result = await api[kind](messageId, index).catch(() => UNREACHABLE)
      setBusy((b) => (b === index ? null : b))
      if (kind === 'reveal' && result.ok) return
      setNotes((n) => ({
        ...n,
        [index]: {
          ok: result.ok,
          text: result.message ?? (result.ok ? 'Done.' : 'That didn’t work. Try again.')
        }
      }))
    },
    [api, messageId]
  )

  return { states, busy, notes, run }
}
