import { childIndex, isText, ownerDocument } from '../dom'

export interface SplitPair {
  head: Text
  tail: Text
}

export interface NormalizedRange {
  range: Range
  splits: SplitPair[]
}

export function normalizeRange(source: Range): NormalizedRange {
  const doc = ownerDocument(source.startContainer)
  const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = source
  const splits: SplitPair[] = []
  const startRef = isText(sc) ? null : (sc.childNodes[so] ?? null)
  const endRef = isText(ec) ? null : (ec.childNodes[eo] ?? null)

  let endNode: Node | null = null
  let endAfter = true
  if (isText(ec)) {
    endNode = ec
    if (eo === 0) endAfter = false
    else if (eo < ec.length) splits.push({ head: ec, tail: ec.splitText(eo) })
  }

  let startNode: Node | null = null
  let startBefore = true
  if (isText(sc)) {
    startNode = sc
    if (so >= sc.length && so > 0) startBefore = false
    else if (so > 0) {
      const tail = sc.splitText(so)
      splits.push({ head: sc, tail })
      startNode = tail
      if (endNode === sc && endAfter) endNode = tail
    }
  }

  const range = doc.createRange()
  if (startNode) {
    if (startBefore) range.setStartBefore(startNode)
    else range.setStartAfter(startNode)
  } else if (startRef) range.setStartBefore(startRef)
  else range.setStart(sc, sc.childNodes.length)

  if (endNode) {
    if (endAfter) range.setEndAfter(endNode)
    else range.setEndBefore(endNode)
  } else if (endRef) range.setEndBefore(endRef)
  else range.setEnd(ec, ec.childNodes.length)

  return { range, splits }
}

export function isContained(range: Range, node: Node): boolean {
  const parent = node.parentNode
  if (!parent) return false
  const index = childIndex(node)
  return range.comparePoint(parent, index) === 0 && range.comparePoint(parent, index + 1) === 0
}

export function containedRoots(range: Range): Node[] {
  const roots: Node[] = []
  if (range.collapsed) return roots
  const visit = (parent: Node): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (isContained(range, child)) roots.push(child)
      else if (range.intersectsNode(child)) visit(child)
    }
  }
  visit(range.commonAncestorContainer)
  return roots
}

export function siblingRuns(roots: Node[]): Node[][] {
  const runs: Node[][] = []
  let current: Node[] = []
  for (const node of roots) {
    const last = current[current.length - 1]
    if (last && last.nextSibling === node) current.push(node)
    else {
      if (current.length) runs.push(current)
      current = [node]
    }
  }
  if (current.length) runs.push(current)
  return runs
}

export function mergeSplits(splits: SplitPair[]): void {
  for (let i = splits.length - 1; i >= 0; i--) {
    const pair = splits[i]
    if (!pair) continue
    const { head, tail } = pair
    if (head.parentNode && head.nextSibling === tail) {
      head.appendData(tail.data)
      tail.remove()
    }
  }
}
