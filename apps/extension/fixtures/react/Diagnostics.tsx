import { useEffect, useState } from 'react'

const SENTENCES = {
  original:
    'When the residuals fan out as fitted values grow, the model shows heteroscedasticity and the usual standard errors are no longer trustworthy.',
  edited:
    'When the residuals stay level as fitted values grow, the errors are homoscedastic and the usual standard errors are fine.'
}

export function Diagnostics(): React.JSX.Element {
  const [seconds, setSeconds] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [version, setVersion] = useState<keyof typeof SENTENCES>('original')
  const ticking = new URLSearchParams(location.search).get('tick') !== 'off'

  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [ticking])

  return (
    <main id="article" data-fixture="react">
      <h1>Live diagnostics</h1>
      <p className="meta" id="ticker">
        Updated {seconds} seconds ago
      </p>
      <p id="p-react" key={generation}>
        {SENTENCES[version]}
      </p>
      <p id="p-stable">
        The variance inflation factor (VIF) stays in this paragraph across every render.
      </p>
      <p>
        <button type="button" id="rerender" onClick={() => setGeneration((value) => value + 1)}>
          Re-render paragraph
        </button>{' '}
        <button
          type="button"
          id="edit"
          onClick={() => setVersion((value) => (value === 'original' ? 'edited' : 'original'))}
        >
          Change text
        </button>
      </p>
    </main>
  )
}
