export const ELEMENT_NODE = 1
export const TEXT_NODE = 3

export function isText(node: Node | null | undefined): node is Text {
  return node?.nodeType === TEXT_NODE
}

export function isElement(node: Node | null | undefined): node is Element {
  return node?.nodeType === ELEMENT_NODE
}

export function ownerDocument(node: Node): Document {
  return node.ownerDocument ?? (node as Document)
}

export function childIndex(node: Node): number {
  let index = 0
  for (let n = node.previousSibling; n; n = n.previousSibling) index++
  return index
}

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: { className?: string; text?: string; attrs?: Record<string, string> } = {}
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  if (props.className) node.className = props.className
  if (props.text !== undefined) node.textContent = props.text
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value)
  return node
}

export function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
