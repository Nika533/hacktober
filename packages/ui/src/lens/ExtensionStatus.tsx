import type { StateSlices } from '@hoot/core'
import { CircleAlert, CircleCheck, Puzzle } from 'lucide-react'
import { cx } from '../cx'

export type ExtensionStatusProps = Pick<StateSlices['lens'], 'bridge' | 'clients'> & {
  className?: string
}

const COPY = {
  connected: {
    title: (n: number) =>
      n > 1 ? `Hoot Lens is connected in ${n} browsers` : 'Hoot Lens is connected',
    body: 'Select a hard word or sentence on any page, and Hoot can explain it in place.'
  },
  listening: {
    title: () => 'Waiting for the browser extension',
    body: 'Open Chrome or Edge with the Hoot Lens extension. It connects on its own.'
  },
  stopped: {
    title: () => 'Hoot Lens can’t connect right now',
    body: 'Hoot couldn’t open the link to your browser. Quit Hoot from the tray and open it again.'
  }
} as const

/**
 * Live state of the link between the app and the browser extension, from the
 * `lens` slice. A polite status region, so a change (say, the extension just
 * connected) is announced once.
 */
export function ExtensionStatus({
  bridge,
  clients,
  className
}: ExtensionStatusProps): React.JSX.Element {
  const state =
    bridge === 'connected' && clients > 0
      ? 'connected'
      : bridge === 'stopped'
        ? 'stopped'
        : 'listening'
  const copy = COPY[state]
  const Icon = state === 'connected' ? CircleCheck : state === 'stopped' ? CircleAlert : Puzzle
  return (
    <div className={cx('hoot-extstatus', className)} data-state={state} role="status">
      <span className="hoot-extstatus__icon" aria-hidden>
        <Icon />
      </span>
      <span className="hoot-extstatus__text">
        <span className="hoot-extstatus__title">{copy.title(clients)}</span>
        <span className="hoot-extstatus__body">{copy.body}</span>
      </span>
    </div>
  )
}
