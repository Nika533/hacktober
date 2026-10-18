import { useState } from 'react'
import { formatAccelerator } from '../settings/accelerator'
import { HotkeyRecorder } from '../settings/HotkeyRecorder'

const SUMMON = 'CommandOrControl+Shift+Space'
const CAPTURE = 'CommandOrControl+Alt+Space'

/** Hoot's two global shortcuts, each refusing the other's combination. */
export function ShortcutsDemo(): React.JSX.Element {
  const [summon, setSummon] = useState(SUMMON)
  const [capture, setCapture] = useState('CommandOrControl+Alt+C')
  const taken = (other: string, what: string) => (acc: string) =>
    acc === other ? `${formatAccelerator(acc)} already ${what}.` : null
  return (
    <div className="gallery__stack">
      <HotkeyRecorder
        label="Summon Hoot"
        description="Opens the owl from anywhere."
        value={summon}
        defaultValue={SUMMON}
        onChange={setSummon}
        validate={taken(capture, 'starts Circle anything')}
      />
      <HotkeyRecorder
        label="Circle anything"
        description="Starts a screen capture."
        value={capture}
        defaultValue={CAPTURE}
        onChange={setCapture}
        validate={taken(summon, 'summons Hoot')}
        error={
          capture === 'CommandOrControl+Alt+C'
            ? 'Another app already uses Ctrl+Alt+C. Pick a different shortcut.'
            : undefined
        }
      />
    </div>
  )
}
