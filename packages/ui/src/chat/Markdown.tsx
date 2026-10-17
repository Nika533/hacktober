import { Check, Copy } from 'lucide-react'
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode
} from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cx } from '../cx'
import { copyText, type CopyFn } from './copyText'

export interface MarkdownProps {
  /** Markdown source (the model's answer). Raw HTML is never rendered. */
  text: string
  /** Copy for code blocks; defaults to the Clipboard API. */
  onCopy?: CopyFn
  /**
   * Open a link (e.g. main's allowlisted openExternal). Without it links are
   * plain target=_blank anchors for the window-open handler to catch.
   */
  onOpenLink?: (href: string) => void
  className?: string
}

interface MarkdownCallbacks {
  onCopy: CopyFn
  onOpenLink?: (href: string) => void
}

const Callbacks = createContext<MarkdownCallbacks>({ onCopy: copyText })

const SAFE_URL = /^(?:https?:|mailto:)/i

/** Only web and mail links survive; javascript:, file:, data: and the rest are dropped. */
function urlTransform(url: string): string | null {
  return SAFE_URL.test(url.trim()) ? url : null
}

const COPIED_MS = 1400

function CodeBlock({ code, lang }: { code: string; lang?: string }): React.JSX.Element {
  const { onCopy } = useContext(Callbacks)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const label = lang ?? 'code'
  return (
    <figure className="hoot-md-code">
      <figcaption className="hoot-md-code__bar hoot-chrome">
        <span>{label}</span>
        <button
          type="button"
          className="hoot-md-code__copy"
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
          onClick={() => {
            void Promise.resolve(onCopy(code)).then(() => {
              setCopied(true)
              clearTimeout(timer.current)
              timer.current = setTimeout(() => setCopied(false), COPIED_MS)
            })
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          <span aria-hidden>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      {/* Focusable so keyboard users can scroll long lines. */}
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      <span className="hoot-visually-hidden" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </figure>
  )
}

function Pre({ children }: ComponentProps<'pre'> & ExtraProps): React.JSX.Element {
  const child = Children.toArray(children)[0]
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <pre tabIndex={0}>{children}</pre>
  }
  const lang = /language-([\w+-]+)/.exec(child.props.className ?? '')?.[1]
  const code = String(child.props.children ?? '').replace(/\n$/, '')
  return <CodeBlock code={code} lang={lang} />
}

function Code({ className, children }: ComponentProps<'code'> & ExtraProps): React.JSX.Element {
  // Block code is unwrapped by <Pre>; this only renders inline spans.
  return <code className={cx('hoot-md-inline', className)}>{children}</code>
}

function Link({ href, children }: ComponentProps<'a'> & ExtraProps): React.JSX.Element {
  const { onOpenLink } = useContext(Callbacks)
  const onClick = onOpenLink
    ? (e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault()
        if (href) onOpenLink(href)
      }
    : undefined
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" onClick={onClick}>
      {children}
    </a>
  )
}

/** Images from the model are shown as links, never fetched. */
function Img({ src, alt }: ComponentProps<'img'> & ExtraProps): React.JSX.Element {
  const label = alt || 'image'
  return typeof src === 'string' && src ? <Link href={src}>{label}</Link> : <span>{label}</span>
}

function Table({ children }: ComponentProps<'table'> & ExtraProps): React.JSX.Element {
  return (
    <div className="hoot-md-table" tabIndex={0}>
      <table>{children}</table>
    </div>
  )
}

const COMPONENTS: Components = { pre: Pre, code: Code, a: Link, img: Img, table: Table }
const PLUGINS = [remarkGfm]

/** Safe, selectable Markdown for answers: GFM, code blocks with Copy, no raw HTML. */
export const Markdown = memo(function Markdown({
  text,
  onCopy = copyText,
  onOpenLink,
  className
}: MarkdownProps): React.JSX.Element {
  return (
    <Callbacks.Provider value={{ onCopy, onOpenLink }}>
      <div className={cx('hoot-md', className)}>
        <ReactMarkdown
          remarkPlugins={PLUGINS}
          components={COMPONENTS}
          urlTransform={urlTransform}
          skipHtml
        >
          {text}
        </ReactMarkdown>
      </div>
    </Callbacks.Provider>
  )
})
