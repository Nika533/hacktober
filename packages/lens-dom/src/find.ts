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
