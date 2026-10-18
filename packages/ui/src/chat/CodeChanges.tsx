import { formatLocation, parseCodeAnswer } from '@hoot/core/code'
import { Check, Eye } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../components/Button'
import { useCodeActions, type CodeActionsApi } from './useCodeActions'

export interface CodeChangesProps {
  api: CodeActionsApi | undefined
  messageId: string
  /** The answer as the model wrote it (with its `[[line]]` / `[[edit]]` tags). */
  text: string
  /** The answer finished, so its tags are in VS Code. */
  ready: boolean
}

/**
 * Under an answer that read the user's code in VS Code: each change Hoot
 * proposes with **Apply** (and **Show**), each spot it points at with
 * **Show**. Nothing shows for answers that didn't read code. Mount with
 * `key={messageId}`.
 */
export function CodeChanges({
  api,
  messageId,
  text,
  ready
}: CodeChangesProps): React.JSX.Element | null {
  const tags = useMemo(() => parseCodeAnswer(text).tags, [text])
  const { states, busy, notes, run } = useCodeActions(api, messageId, ready && tags.length > 0)
  if (tags.length === 0 || !states) return null
  return (
    <section className="hoot-code-changes" aria-label="In VS Code">
      <p className="hoot-code-changes__title">In VS Code</p>
      <ul className="hoot-code-changes__list">
        {tags.map((tag, i) => {
          const where = formatLocation(tag.path, tag.range)
          const state = states[i]
          const usable = state !== undefined && state !== 'unavailable'
          const applied = state === 'applied'
          const note = notes[i]
          return (
            <li
              key={`${i}:${where}`}
              className="hoot-code-changes__item"
              data-kind={tag.kind}
              data-state={state ?? 'pending'}
            >
              <div className="hoot-code-changes__row">
                <span className="hoot-code-changes__kind">
                  {tag.kind === 'edit' ? 'Change' : 'Look'}
                </span>
                <code className="hoot-code-changes__where">{where}</code>
                {tag.label && <span className="hoot-code-changes__label">{tag.label}</span>}
              </div>
              <div className="hoot-code-changes__buttons">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Eye />}
                  disabled={!usable || busy !== null}
                  aria-label={`Show ${where} in VS Code`}
                  onClick={() => void run(i, 'reveal')}
                >
                  Show
                </Button>
                {tag.kind === 'edit' && (
                  <Button
                    size="sm"
                    variant={applied ? 'secondary' : 'primary'}
                    icon={applied ? <Check /> : undefined}
                    busy={busy === i}
                    disabled={!usable || applied || (busy !== null && busy !== i)}
                    aria-label={applied ? `Applied to ${where}` : `Apply this change to ${where}`}
                    onClick={() => void run(i, 'apply')}
                  >
                    {applied ? 'Applied' : 'Apply'}
                  </Button>
                )}
              </div>
              {state === 'unavailable' && (
                <p className="hoot-code-changes__note">
                  Hoot didn’t read these lines in VS Code, so it can’t act on them. Ask again with
                  the file open.
                </p>
              )}
              {note && (
                <p className="hoot-code-changes__note" data-ok={note.ok} role="status">
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
