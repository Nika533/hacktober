import type { Session } from '@hoot/core'
import { hasCodeTags } from '@hoot/core/code'
import type { ReactNode } from 'react'
import { CodeChanges } from './CodeChanges'
import type { CodeActionsApi } from './useCodeActions'

/** `Transcript.answerFooter` for a chat: each answer's changes in VS Code, with Apply. */
export function codeChangesFor(
  api: CodeActionsApi | undefined,
  session: Session | null | undefined
): (messageId: string) => ReactNode {
  return function answerFooter(messageId) {
    const m = session?.messages.find((x) => x.id === messageId)
    return m && hasCodeTags(m.text) ? (
      <CodeChanges key={messageId} api={api} messageId={messageId} text={m.text} ready />
    ) : null
  }
}
