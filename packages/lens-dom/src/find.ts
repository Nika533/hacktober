import { isElement, ownerDocument } from './dom'
import { MARK_TAG, UI_TAG } from './guard'

function lensTextNodes(root: Node): Text[] {
  const doc = ownerDocument(root)
  const walker = doc.createTreeWalker(root, 1 | 4, {
    acceptNode: (node) =>
      isElement(node) && (node.localName === MARK_TAG || node.localName === UI_TAG)
        ? 2
        : isElement(node)
          ? 3
          : 1
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isElement(node)) nodes.push(node as Text)
  }
  return nodes
}

function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer
  if (!isElement(root) && root.nodeType === 3) return [root as Text]
  const walker = ownerDocument(root).createTreeWalker(root, 4)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node)) nodes.push(node as Text)
  }
  return nodes
}

export function trimRange(range: Range): Range {
  const trimmed = range.cloneRange()
  const nodes = textNodesIn(range)
  const bounds = (node: Text): [number, number] => [
    node === range.startContainer ? range.startOffset : 0,
    node === range.endContainer ? range.endOffset : node.length
  ]
  const first = nodes.find((node) => {
    const [from, to] = bounds(node)
    const index = node.data.slice(from, to).search(/\S/)
    if (index >= 0) trimmed.setStart(node, from + index)
    return index >= 0
  })
  if (!first) {
    trimmed.collapse(true)
    return trimmed
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i] as Text
    const [from, to] = bounds(node)
    const slice = node.data.slice(from, to)
    const trailing = slice.length - slice.trimEnd().length
    if (trailing < slice.length) {
      trimmed.setEnd(node, to - trailing)
      break
    }
  }
  return trimmed
}

export function findTextRange(root: Node, needle: string): Range | null {
  if (!needle) return null
  const nodes = lensTextNodes(root)
  const haystack = nodes.map((node) => node.data).join('')
  const index = haystack.indexOf(needle)
  if (index < 0) return null
  const end = index + needle.length
  const range = ownerDocument(root).createRange()
  let offset = 0
  let started = false
  for (const node of nodes) {
    const next = offset + node.length
    if (!started && index < next) {
      range.setStart(node, index - offset)
      started = true
    }
    if (started && end <= next) {
      range.setEnd(node, end - offset)
      return range
    }
    offset = next
  }
  return null
}
