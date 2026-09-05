import type { TaoStudioIdentity } from './TR-TaoProps'

/**
 * The browser canvas gets hit-testing for free: a preview is a DOM tree, and `elementFromPoint`
 * turns a click into the element that produced it. A device has no such tree — the render occurrence
 * is lowered onto native props as `dataSet.taoStudio`, but nothing on the phone can answer "what is
 * under this finger".
 *
 * This is that answer. Every Studio-compiled native root registers itself here with a measurable
 * handle; a tap measures the registered nodes and picks the most specific rectangle containing the
 * point. Registration is Studio-only — `TaoProps` lowers studio identity only when the compiler ran
 * with `studio: true` — so nothing here reaches a shipped app.
 */

/** StudioInspectRect is one measured node in window coordinates, the frame a tap is tested against. */
export type StudioInspectRect = {
  height: number
  width: number
  x: number
  y: number
}

/** StudioInspectHit pairs a measured frame with the source occurrence that rendered it. */
export type StudioInspectHit = {
  identity: TaoStudioIdentity
  rect: StudioInspectRect
}

/** MeasurableNode is the part of a native component reference this module depends on. */
type MeasurableNode = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void
}

type Registration = {
  identity: TaoStudioIdentity
  node: MeasurableNode
}

const registrations = new Map<number, Registration>()
const refsByKey = new Map<string, (node: unknown) => (() => void) | void>()
let nextHandle = 1

/** Identifies one render occurrence in Tao source; two occurrences differ iff their spans differ. */
function inspectIdentityKey(identity: TaoStudioIdentity): string {
  return `${identity.sourcePath}:${identity.start}:${identity.end}`
}

/**
 * Returns a ref callback that is stable for one source occurrence.
 *
 * Stability is the point: a fresh closure each render would make React detach and reattach every
 * node on every render, which is both churn and a lie — the node did not change. Because the
 * callback is shared by every simultaneous instance of the occurrence (a row rendered ten times in
 * a list is one occurrence), it cannot key the registry by occurrence; it allocates a handle per
 * attached node and releases exactly that handle through React 19's ref cleanup.
 */
export function studioInspectRef(identity: TaoStudioIdentity): (node: unknown) => (() => void) | void {
  const key = inspectIdentityKey(identity)
  const existing = refsByKey.get(key)
  if (existing !== undefined) {
    return existing
  }
  const ref = (node: unknown): (() => void) | void => {
    const measurable = asMeasurable(node)
    if (measurable === undefined) {
      return
    }
    const handle = nextHandle++
    registrations.set(handle, { identity, node: measurable })
    return () => {
      registrations.delete(handle)
    }
  }
  refsByKey.set(key, ref)
  return ref
}

/**
 * Narrows an attached ref to something measurable.
 *
 * React Native host components expose `measureInWindow`; react-native-web hands back a DOM element,
 * which does not. Returning undefined there is what keeps the browser canvas free of this — it
 * registers nothing and pays one property check per mounted node.
 */
function asMeasurable(node: unknown): MeasurableNode | undefined {
  if (node === null || typeof node !== 'object') {
    return undefined
  }
  const measure = (node as { measureInWindow?: unknown }).measureInWindow
  return typeof measure === 'function' ? node as MeasurableNode : undefined
}

/** Measures every registered node, dropping the ones that report no area or fail to measure. */
export async function measureStudioInspectNodes(): Promise<readonly StudioInspectHit[]> {
  const entries = [...registrations.values()]
  const measured = await Promise.all(entries.map(async entry => await measureNode(entry)))
  return measured.filter((hit): hit is StudioInspectHit => hit !== undefined)
}

function measureNode(entry: Registration): Promise<StudioInspectHit | undefined> {
  return new Promise(resolve => {
    let settled = false
    const settle = (hit: StudioInspectHit | undefined): void => {
      if (!settled) {
        settled = true
        resolve(hit)
      }
    }
    try {
      entry.node.measureInWindow((x, y, width, height) => {
        const usable = [x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))
        settle(
          usable && width > 0 && height > 0 ? { identity: entry.identity, rect: { height, width, x, y } } : undefined,
        )
      })
    } catch {
      settle(undefined)
    }
    // A node detached between registration and measurement never calls back; resolving undefined on
    // the next tick keeps one dead node from hanging the whole hit test.
    setTimeout(() => settle(undefined), 0)
  })
}

/** How many nodes a hit test would measure. A test seam; nothing in the running host reads it yet. */
export function studioInspectNodeCount(): number {
  return registrations.size
}

/**
 * Picks the render occurrence a tap means: the most specific frame containing the point.
 *
 * Specificity is area first — a tapped button is inside its card, its screen and its app, and the
 * button is what was meant. Equal areas fall back to the shorter source span, which is the inner of
 * two occurrences that happen to render to the same box.
 */
export function bestInspectHit(
  hits: readonly StudioInspectHit[],
  point: { x: number; y: number },
): StudioInspectHit | undefined {
  let best: StudioInspectHit | undefined
  for (const hit of hits) {
    if (!containsPoint(hit.rect, point)) {
      continue
    }
    if (best === undefined || isMoreSpecific(hit, best)) {
      best = hit
    }
  }
  return best
}

function containsPoint(rect: StudioInspectRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height
}

function isMoreSpecific(candidate: StudioInspectHit, incumbent: StudioInspectHit): boolean {
  const candidateArea = candidate.rect.width * candidate.rect.height
  const incumbentArea = incumbent.rect.width * incumbent.rect.height
  if (candidateArea !== incumbentArea) {
    return candidateArea < incumbentArea
  }
  return sourceSpan(candidate.identity) < sourceSpan(incumbent.identity)
}

function sourceSpan(identity: TaoStudioIdentity): number {
  return Math.max(0, identity.end - identity.start)
}

/** Returns every measured frame for one occurrence, which is how Studio highlights a repeated row. */
export async function measureStudioInspectIdentity(
  identity: TaoStudioIdentity,
): Promise<readonly StudioInspectRect[]> {
  const key = inspectIdentityKey(identity)
  const measured = await measureStudioInspectNodes()
  return measured.filter(hit => inspectIdentityKey(hit.identity) === key).map(hit => hit.rect)
}

/**
 * Empties the registry. Nothing in the running host calls this — mounted nodes release themselves
 * through their ref cleanup — so it exists for tests, which need a known-empty registry per case.
 */
export function resetStudioInspectRegistry(): void {
  registrations.clear()
  refsByKey.clear()
  nextHandle = 1
}

/**
 * The render id a source action names. It is `inspectIdentityKey` by construction — the browser
 * canvas builds the same `sourcePath:start:end` string for the anchors it sends — and the two must
 * stay identical, because Studio resolves both against the same source text.
 */
function studioRenderId(identity: TaoStudioIdentity): string {
  return inspectIdentityKey(identity)
}

/**
 * The smallest measured frame that strictly contains the target, which is the closest thing a
 * device has to a parent node. "Strictly" excludes the target itself and anything sharing its exact
 * frame: a wrapper that measures identically is not a level of nesting a person can act on.
 */
function parentOf(
  hits: readonly StudioInspectHit[],
  target: StudioInspectHit,
): StudioInspectHit | undefined {
  let parent: StudioInspectHit | undefined
  for (const hit of hits) {
    if (!strictlyContains(hit.rect, target.rect)) {
      continue
    }
    if (parent === undefined || area(hit.rect) < area(parent.rect)) {
      parent = hit
    }
  }
  return parent
}

function strictlyContains(outer: StudioInspectRect, inner: StudioInspectRect): boolean {
  return area(outer) > area(inner)
    && outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height
}

function area(rect: StudioInspectRect): number {
  return rect.width * rect.height
}

/**
 * The target's siblings, in source order: everything sharing its nearest containing frame.
 *
 * Source order rather than screen order is deliberate. The edit this feeds rewrites the order of
 * renders in the file, so "the one before this" has to mean the one before it in the text; a row
 * layout would otherwise make "up" mean "left" and reorder the wrong pair.
 */
export function siblingRenders(
  hits: readonly StudioInspectHit[],
  target: StudioInspectHit,
): readonly StudioInspectHit[] {
  const parent = parentOf(hits, target)
  if (parent === undefined) {
    return []
  }
  const parentKey = inspectIdentityKey(parent.identity)
  const targetKey = inspectIdentityKey(target.identity)
  const siblings = new Map<string, StudioInspectHit>()
  for (const hit of hits) {
    const key = inspectIdentityKey(hit.identity)
    if (key === parentKey) {
      continue
    }
    const hitParent = parentOf(hits, hit)
    if (hitParent === undefined || inspectIdentityKey(hitParent.identity) !== parentKey) {
      continue
    }
    if (hit.identity.sourcePath !== target.identity.sourcePath) {
      continue
    }
    // One occurrence rendered several times (a list row) is still one thing to reorder.
    if (!siblings.has(key)) {
      siblings.set(key, hit)
    }
  }
  if (!siblings.has(targetKey)) {
    return []
  }
  return [...siblings.values()].sort((left, right) => left.identity.start - right.identity.start)
}

/**
 * Builds the move a person means by "up" or "down" on a selected render, or undefined when there is
 * nowhere to go — the render is already first or last among its siblings, or it has no siblings.
 *
 * Anchors mirror the browser canvas exactly: moving up lands the render before its predecessor,
 * moving down lands it after its successor.
 */
export function moveRenderFor(
  hits: readonly StudioInspectHit[],
  target: StudioInspectHit,
  direction: 'down' | 'up',
): { afterId?: string; beforeId?: string; draggedId: string; kind: 'move-render' } | undefined {
  const siblings = siblingRenders(hits, target)
  const index = siblings.findIndex(hit => inspectIdentityKey(hit.identity) === inspectIdentityKey(target.identity))
  if (index < 0) {
    return undefined
  }
  const neighbour = direction === 'up' ? siblings[index - 1] : siblings[index + 1]
  if (neighbour === undefined) {
    return undefined
  }
  // A move names the gap it lands in, by both of the renders that bound it — the same thing the
  // browser canvas sends when a render is dropped between two others. Naming only one side means
  // something stricter than intended: a before-only anchor asks to become the block's first render,
  // which Studio refuses outright unless that anchor really is first.
  const beyond = direction === 'up' ? siblings[index - 2] : siblings[index + 2]
  const [after, before] = direction === 'up' ? [beyond, neighbour] : [neighbour, beyond]
  return {
    ...(after === undefined ? {} : { afterId: studioRenderId(after.identity) }),
    ...(before === undefined ? {} : { beforeId: studioRenderId(before.identity) }),
    draggedId: studioRenderId(target.identity),
    kind: 'move-render',
  }
}
