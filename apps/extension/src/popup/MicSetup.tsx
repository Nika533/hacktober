import { Button, Owl } from '@hoot/ui'
import { useState } from 'react'

type State = 'ask' | 'asking' | 'granted' | 'denied'

/**
 * mic.html: the extension's popup can't show the browser's microphone prompt,
 * so this tab asks once. The permission then holds for the popup too.
 */
export function MicSetup({
  getUserMedia = (c) => navigator.mediaDevices.getUserMedia(c)
}: {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
}): React.JSX.Element {
  const [state, setState] = useState<State>('ask')

  const allow = async (): Promise<void> => {
    setState('asking')
    try {
      const stream = await getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      setState('granted')
    } catch {
      setState('denied')
    }
  }

  return (
    <main className="hoot-mic">
      <Owl mood={state === 'granted' ? 'celebrate' : 'listening'} size={64} />
      {state === 'granted' ? (
        <>
          <h1>You’re set</h1>
          <p role="status">
            Click the Hoot icon in the toolbar (or press Alt+Shift+H) and press the mic to ask by
            voice. You can close this tab.
          </p>
          <Button onClick={() => window.close()}>Close this tab</Button>
        </>
      ) : (
        <>
          <h1>Let Hoot use your microphone</h1>
          <p>
            So you can ask about a page by voice. The browser’s speech recognition turns what you
            say into text; only the text goes to Hoot.
          </p>
          {state === 'denied' && (
            <p role="alert">
              The microphone is blocked. Click the icon at the right of the address bar to allow it,
              then try again.
            </p>
          )}
          <Button variant="primary" busy={state === 'asking'} onClick={() => void allow()}>
            Allow the microphone
          </Button>
        </>
      )}
    </main>
  )
}
