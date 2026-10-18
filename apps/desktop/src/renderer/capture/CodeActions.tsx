import { formatLocation, type CodeTag } from '@hoot/core/code'
import { useCodeActions, type CodeActionsApi } from '@hoot/ui'
import './code.css'

/**
 * The answer's `[[line]]` and `[[edit]]` tags as a list under it: where each
 * is, Show (scrolls VS Code to it) and, for a change, Apply. Apply is the
 * user's call every time; VS Code checks the code is still what Hoot read and
 * Ctrl+Z there undoes it. Mount with `key={messageId}` so each answer starts fresh.
 */
export function CodeActions({
  api,
  messageId,
  tags,
  ready
}: {
  api: CodeActionsApi | undefined
  messageId: string
  tags: readonly CodeTag[]
  /** The answer finished, so its tags are in VS Code. */
  ready: boolean
}): React.JSX.Element | null {
  const { states, busy, notes, run } = useCodeActions(api, messageId, ready)
  if (tags.length === 0) return null
  const linked = states !== null
  return (
    <section className="capture-code" aria-label="In VS Code">
      <p className="capture-code__title">In VS Code</p>
      <ul className="capture-code__list">
        {tags.map((tag, i) => {
          const where = formatLocation(tag.path, tag.range)
          const state = states?.[i]
          const usable = ready && state !== undefined && state !== 'unavailable'
          const applied = state === 'applied'
          const note = notes[i]
          return (
            <li
              key={`${i}:${where}`}
              className="capture-code__item"
              data-kind={tag.kind}
              data-state={state ?? 'pending'}
            >
              <div className="capture-code__row">
                <span className="capture-code__kind">
                  {tag.kind === 'edit' ? 'Change' : 'Look'}
                </span>
                <code className="capture-code__where">{where}</code>
                {tag.label && <span className="capture-code__label">{tag.label}</span>}
              </div>
              {linked && (
                <div className="capture-code__buttons">
                  <button
                    type="button"
                    className="capture__pill capture__pill--quiet"
                    disabled={!usable || busy !== null}
                    aria-label={`Show ${where} in VS Code`}
                    onClick={() => void run(i, 'reveal')}
                  >
                    Show
                  </button>
                  {tag.kind === 'edit' && (
                    <button
                      type="button"
                      className="capture__pill capture__pill--primary"
                      disabled={!usable || applied || busy !== null}
                      aria-label={applied ? `Applied to ${where}` : `Apply this change to ${where}`}
                      onClick={() => void run(i, 'apply')}
                    >
                      {applied ? 'Applied' : busy === i ? 'Applying…' : 'Apply'}
                    </button>
                  )}
                </div>
              )}
              {state === 'unavailable' && (
                <p className="capture-code__note">
                  Hoot didn’t read these lines in VS Code, so it can’t act on them. Ask again with
                  the file open.
                </p>
              )}
              {note && (
                <p className="capture-code__note" data-ok={note.ok} role="status">
                  {note.text}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
