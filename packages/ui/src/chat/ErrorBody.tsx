import type { AiErrorCode } from '@hoot/core'
import { CircleAlert } from 'lucide-react'
import { Button } from '../components/Button'
import { describeChatError } from './describeError'

export interface ErrorBodyProps {
  /** Message.error: one of core's AI_ERROR_CODES. */
  code: AiErrorCode | undefined
  onRetry?: () => void
  /** Opens wherever the key is entered (Settings or onboarding). */
  onAddKey?: () => void
  onOpenSettings?: () => void
}

/** The body of an assistant message that failed: what happened plus one fix. */
export function ErrorBody({
  code,
  onRetry,
  onAddKey,
  onOpenSettings
}: ErrorBodyProps): React.JSX.Element {
  const copy = describeChatError(code)
  const handler =
    copy.action === 'add-key'
      ? onAddKey
      : copy.action === 'open-settings'
        ? (onOpenSettings ?? onAddKey)
        : copy.action === 'retry'
          ? onRetry
          : undefined
  return (
    <div className="hoot-msg-error" data-code={copy.code}>
      <CircleAlert className="hoot-msg-error__icon" aria-hidden />
      <p className="hoot-msg-error__text">{copy.message}</p>
      {handler && copy.actionLabel && (
        <Button
          size="sm"
          variant={copy.action === 'retry' ? 'secondary' : 'primary'}
          onClick={handler}
        >
          {copy.actionLabel}
        </Button>
      )}
    </div>
  )
}
