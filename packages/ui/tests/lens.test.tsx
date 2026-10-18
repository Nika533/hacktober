import { describe, expect, it } from 'vitest'
import { ExtensionStatus } from '../src/lens/ExtensionStatus'
import { render } from './render'

describe('ExtensionStatus', () => {
  const statusOf = (
    bridge: 'stopped' | 'listening' | 'connected',
    clients: number
  ): HTMLElement => {
    const { container } = render(<ExtensionStatus bridge={bridge} clients={clients} />)
    return container.querySelector<HTMLElement>('[role="status"]')!
  }

  it('says when the extension is connected, and in how many browsers', () => {
    const one = statusOf('connected', 1)
    expect(one.dataset.state).toBe('connected')
    expect(one.textContent).toContain('Hoot Lens is connected')
    expect(statusOf('connected', 2).textContent).toContain('connected in 2 browsers')
  })

  it('waits while the bridge listens (or claims connected with no clients)', () => {
    expect(statusOf('listening', 0).textContent).toContain('Waiting for the browser extension')
    expect(statusOf('connected', 0).dataset.state).toBe('listening')
  })

  it('tells the user what to do when the bridge is stopped', () => {
    const s = statusOf('stopped', 0)
    expect(s.dataset.state).toBe('stopped')
    expect(s.textContent).toContain('Quit Hoot from the tray')
  })
})
