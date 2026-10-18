import articleHtml from './fixtures/article.html?raw'

export function loadArticle(doc: Document = document): HTMLElement {
  const parsed = new DOMParser().parseFromString(articleHtml, 'text/html')
  doc.title = parsed.title
  doc.documentElement.lang = parsed.documentElement.lang
  doc.body.innerHTML = parsed.body.innerHTML
  const article = doc.getElementById('article')
  if (!article) throw new Error('fixture missing #article')
  return article
}

export function textNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 4)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

export function rangeOf(node: Node, start: number, end: number): Range {
  const range = (node.ownerDocument ?? document).createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  return range
}

export function rangeAcross(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range {
  const range = (startNode.ownerDocument ?? document).createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

export function rangeForText(root: HTMLElement, needle: string): Range {
  for (const node of textNodes(root)) {
    const index = node.data.indexOf(needle)
    if (index >= 0) return rangeOf(node, index, index + needle.length)
  }
  throw new Error(`text not found: ${needle}`)
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shadowOf(host: Element): ShadowRoot {
  const root = host.shadowRoot
  if (!root) throw new Error('expected an open shadow root')
  return root
}
