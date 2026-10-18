import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '../src/components/Dialog'
import { HootUIProvider } from '../src/components/HootUIProvider'
import { useConfirm, type Confirm } from '../src/components/confirmContext'
import { useToast, type ToastApi } from '../src/components/toastContext'
import { byName, click, key, render, wait } from './render'

function Capture({
  onReady
}: {
  onReady: (api: { toast: ToastApi; confirm: Confirm }) => void
}): null {
  const toast = useToast()
  const confirm = useConfirm()
  onReady({ toast, confirm })
  return null
}

function setup(): { toast: ToastApi; confirm: Confirm } {
  let api: { toast: ToastApi; confirm: Confirm } | undefined
  render(
    <HootUIProvider>
      <Capture onReady={(a) => (api = a)} />
    </HootUIProvider>
  )
  if (!api) throw new Error('provider did not render')
  return api
}

describe('Toast', () => {
  it('announces in a polite live region and runs its action once', () => {
    const { toast } = setup()
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    act(() => {
      toast.show({ message: 'Chat deleted', action: { label: 'Undo', onAction }, onDismiss })
    })
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live.closest('section')?.getAttribute('aria-label')).toBe('Notifications')
    expect(live.textContent).toContain('Chat deleted')
    click(byName(document, 'button', 'Undo'))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after its duration, but not while hovered', async () => {
    const { toast } = setup()
    const onDismiss = vi.fn()
    act(() => {
      toast.show({ message: 'Saved', duration: 60, onDismiss })
    })
    const item = document.querySelector('.hoot-toast')!
    act(() => {
      item.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
      item.dispatchEvent(new PointerEvent('pointerenter'))
    })
    await wait(120)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      item.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
      item.dispatchEvent(new PointerEvent('pointerleave'))
    })
    await wait(120)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('marks danger toasts as alerts and dismisses on Esc', () => {
    const { toast } = setup()
    const onDismiss = vi.fn()
    act(() => {
      toast.show({ message: "Couldn't reach Gemini.", tone: 'danger', duration: null, onDismiss })
    })
    const item = document.querySelector('.hoot-toast')!
    expect(item.getAttribute('role')).toBe('alert')
    key(item, 'Escape')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps at most three, dismissing the oldest', () => {
    const { toast } = setup()
    const first = vi.fn()
    act(() => {
      toast.show({ message: 'one', onDismiss: first })
      toast.show({ message: 'two' })
      toast.show({ message: 'three' })
      toast.show({ message: 'four' })
    })
    expect(first).toHaveBeenCalledTimes(1)
  })
})

describe('useConfirm', () => {
  it('resolves true on confirm, as an alertdialog', async () => {
    const { confirm } = setup()
    let result: Promise<boolean> | undefined
    act(() => {
      result = confirm({ title: 'Clear all data?', confirmLabel: 'Clear all data', tone: 'danger' })
    })
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Clear all data?'
    )
    // Destructive: the safe choice gets focus.
    expect(document.activeElement?.textContent).toBe('Cancel')
    click(byName(dialog, 'button', 'Clear all data'))
    await expect(result).resolves.toBe(true)
    expect(dialog.open).toBe(false)
  })

  it('resolves false on Esc (cancel) and when superseded', async () => {
    const { confirm } = setup()
    let a: Promise<boolean> | undefined
    let b: Promise<boolean> | undefined
    act(() => {
      a = confirm({ title: 'Delete chat?', confirmLabel: 'Delete' })
    })
    act(() => {
      b = confirm({ title: 'Delete pin?', confirmLabel: 'Delete' })
    })
    await expect(a).resolves.toBe(false)
    const dialog = document.querySelector('dialog')!
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    })
    await expect(b).resolves.toBe(false)
  })
})

describe('Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }): React.JSX.Element {
    const [open, setOpen] = useState(true)
    return (
      <Dialog
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        title="Rename chat"
        description="Give this chat a name you'll find later."
      >
        <input data-autofocus aria-label="Chat name" />
      </Dialog>
    )
  }

  it('focuses data-autofocus, describes itself, and closes on backdrop click', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const dialog = document.querySelector('dialog')!
    expect(dialog.hasAttribute('role')).toBe(false)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Chat name')
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent
    ).toContain('Give this chat a name')
    // A press that starts inside and ends on the backdrop doesn't count.
    const input = dialog.querySelector('input')!
    act(() => {
      input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(false)
  })
})
