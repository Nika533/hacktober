import type { QuickActionId } from '../../../shared/types'
import { QUICK_ACTIONS } from '../../../shared/prompts'

const ORDER: QuickActionId[] = ['explain', 'extract', 'translate', 'summarize', 'fix']

/** Quick-action chips shown while captures are pending. */
export function QuickChips(): React.JSX.Element {
  return (
    <div className="chip-row" data-hit>
      {ORDER.map((id) => (
        <button
          key={id}
          type="button"
          data-hit
          className="chip t-small"
          onClick={() => window.hoot.ai.send({ quickAction: id })}
        >
          {QUICK_ACTIONS[id].label}
        </button>
      ))}
    </div>
  )
}
