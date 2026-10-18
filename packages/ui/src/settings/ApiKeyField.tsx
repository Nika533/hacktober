import type { ApiKeyResult } from '@hoot/core'
import { Check, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'

export const API_KEY_URL = 'https://console.anthropic.com/settings/keys'

/** Every Claude API key starts with this. */
const KEY_PREFIX = 'sk-ant-'

export interface ApiKeyFieldProps {
  hasKey: boolean
  /** 'memory' when Windows encryption isn't available: the key lasts this session only. */
  keyStorage: 'os-encrypted' | 'memory'
  /** Checks the key with Anthropic and stores it. */
  onSave: (key: string) => Promise<ApiKeyResult>
  onOpenLink: (url: string) => void
  /** Called after a key is saved, e.g. to move onboarding on. */
  onSaved?: () => void
  autoFocus?: boolean
}

const REASON: Record<NonNullable<ApiKeyResult['reason']>, string> = {
  rejected: 'Anthropic rejected this key. Check it was copied in full, or create a new one.',
  unreachable:
    'Hoot couldn’t reach Anthropic to check the key. Check your connection, then try again.'
}

/** Why a key didn't save; a rejected key that isn't shaped like a Claude key says so. */
function reasonText(reason: NonNullable<ApiKeyResult['reason']>, key: string): string {
  return reason === 'rejected' && !key.startsWith(KEY_PREFIX)
    ? `Anthropic rejected this key. Claude API keys start with ${KEY_PREFIX}, so check you copied the right one, in full.`
    : REASON[reason]
}

/** Paste, check and save the Claude API key, with where to get one. Shared by Settings and onboarding. */
export function ApiKeyField({
  hasKey,
  keyStorage,
  onSave,
  onOpenLink,
  onSaved,
  autoFocus
}: ApiKeyFieldProps): React.JSX.Element {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    const k = key.trim()
    if (!k || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onSave(k)
      if (result.ok) {
        setKey('')
        setSaved(true)
        onSaved?.()
      } else setError(reasonText(result.reason ?? 'rejected', k))
    } catch {
      setError(REASON.unreachable)
    } finally {
      setBusy(false)
    }
  }

  const status = hasKey
    ? keyStorage === 'memory'
      ? 'A key is set for this session only: Windows encryption isn’t available, so it won’t be saved.'
      : 'A key is saved, encrypted on this PC. Paste a new one to replace it.'
    : `Hoot uses your own Claude API key (it starts with ${KEY_PREFIX}). It stays on this PC, encrypted.`

  return (
    <form
      className="hoot-apikey"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <TextField
        label="Claude API key"
        type={show ? 'text' : 'password'}
        value={key}
        placeholder={hasKey ? '••••••••••••••••' : `${KEY_PREFIX}…`}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        description={status}
        error={error ?? undefined}
        onChange={(e) => {
          setKey(e.currentTarget.value)
          setSaved(false)
          setError(null)
        }}
        trailing={
          <Button size="sm" variant="ghost" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </Button>
        }
      />
      <div className="hoot-apikey__actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!key.trim()}>
          {busy ? 'Checking key' : 'Check and save'}
        </Button>
        <Button variant="ghost" icon={<ExternalLink />} onClick={() => onOpenLink(API_KEY_URL)}>
          Get a key
        </Button>
        <span className="hoot-apikey__saved" role="status">
          {saved && (
            <>
              <Check aria-hidden /> Key saved
            </>
          )}
        </span>
      </div>
    </form>
  )
}
