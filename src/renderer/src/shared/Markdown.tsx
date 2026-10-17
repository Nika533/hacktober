import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({
  className,
  children
}: {
  className?: string
  children: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const lang = /language-(\w+)/.exec(className ?? '')?.[1]
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang ?? 'code'}</span>
        <button
          type="button"
          data-hit
          onClick={() => {
            window.hoot.clipboard.writeText(children)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="md t-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" />,
          pre: (p) => <>{p.children}</>,
          code: ({ className, children }) => {
            const text = String(children)
            const isBlock = /\n/.test(text) || /language-\w+/.test(className ?? '')
            if (!isBlock) return <code className="md-inline">{text}</code>
            return <CodeBlock className={className}>{text}</CodeBlock>
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
