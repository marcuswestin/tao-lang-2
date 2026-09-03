import { DataControls } from './TR-data'
import type { RuntimeCommand } from './TR-interaction'
import { allocateInteractionKeys, type TaoInteractionKeyAssignments } from './TR-interaction-allocation'
import type {
  CommandCatalog,
  TaoCommandSlotDescription,
  TaoInteractionVerb,
} from './TR-interaction-catalog'
import { normalizeInteractionKey, type TaoAttentionKey } from './TR-interaction-keys'
import { matchesNarrowing } from './TR-interaction-labels'
import type {
  InteractionOutline,
  TaoInteractionOccurrence,
  TaoOutlineLiveNode,
} from './TR-interaction-outline'

export type { TaoAttentionKey } from './TR-interaction-keys'

export type TaoAttentionMode =
  | 'engaged'
  | 'hints'
  | 'narrowing'
  | 'navigating'
  | 'overview'
  | 'palette'
  | 'verb-pending'
  | 'verbs'

export type TaoAttentionSnapshot = Readonly<{
  candidates: readonly string[]
  engaged?: string
  focusRegion?: string
  focusRegionLabel?: string
  mode: TaoAttentionMode
  narrowing: string
  palette: readonly Readonly<{ enabled: boolean; identity: string; key?: string; label: string }>[]
  target?: string
  targetLabel?: string
  verbPending?: Readonly<{
    identity: string
    label: string
    request: 'input' | 'search' | 'targets'
    slot: string
    type: string
  }>
  verbs: readonly Readonly<{ enabled: boolean; identity: string; key?: string; label: string }>[]
}>

type RegionMemory = {
  narrowing: string
  scope?: string
  target?: string
}

type PendingVerb = {
  command: RuntimeCommand
  slot: TaoCommandSlotDescription
  slots: readonly TaoCommandSlotDescription[]
  verb: TaoInteractionVerb
}

type PendingAllocatedKey = Readonly<{ prefix: string; surface: string }>

/** InteractionAttention is the sole mutable owner of modality-neutral attention state. */
export class InteractionAttention {
  #candidates: string[] = []
  #allocations = new Map<string, TaoInteractionKeyAssignments>()
  #allocatedPrefix: PendingAllocatedKey | undefined
  #engaged: string | undefined
  #focusRegion: string | undefined
  #focusStack: string[] = []
  #hints = false
  #listeners = new Set<() => void>()
  #memory = new Map<string, RegionMemory>()
  #outlineRevalidationScheduled = false
  #overview = false
  #palette = false
  #paletteTarget: string | undefined
  #pressed = new Set<string>()
  #hovered = new Set<string>()
  #revision = 0
  #verbRefreshScheduled = false
  #verbPending: PendingVerb | undefined
  #verbs: readonly TaoInteractionVerb[] = []
  #verbsOpen = false

  constructor(
    private readonly outline: InteractionOutline,
    private readonly catalog: CommandCatalog,
  ) {
    outline.subscribeLive(() => this.scheduleOutlineRevalidation())
  }

  readonly snapshot = (): number => this.#revision
  readonly subscribe = (listener: () => void): () => void => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  readonly condition = (
    subject: string,
    value: string | undefined,
    occurrence: TaoInteractionOccurrence | undefined,
  ): boolean => {
    const control = occurrence?.control
    if (value === undefined) {
      if (subject === 'focused') {
        return control !== undefined && control === this.targetIdentity()
      }
      if (subject === 'pressed') {
        return control !== undefined && this.#pressed.has(control)
      }
      if (subject === 'hovered') {
        return control !== undefined && this.#hovered.has(control)
      }
      return false
    }
    return value === 'active'
      && occurrence?.region !== undefined
      && occurrence.regionSubjects?.includes(subject) === true
      && occurrence.region === this.#focusRegion
  }

  read(): TaoAttentionSnapshot {
    const region = this.node(this.#focusRegion)
    const target = this.node(this.targetIdentity())
    const palette = this.paletteVerbs()
    const paletteTarget = palette.find(entry => entry.identity === this.#paletteTarget)
    return Object.freeze({
      candidates: Object.freeze([...this.#candidates]),
      ...(this.#engaged === undefined ? {} : { engaged: this.#engaged }),
      ...(region === undefined
        ? {}
        : {
          focusRegion: region.identity,
          ...(region.label() === undefined ? {} : { focusRegionLabel: region.label() }),
        }),
      mode: this.mode(),
      narrowing: this.memory().narrowing,
      palette: Object.freeze(palette.map(verb =>
        Object.freeze({
          enabled: verb.enabled,
          identity: verb.identity,
          ...(verb.key === undefined ? {} : { key: verb.key }),
          label: verb.label,
        })
      )),
      ...(target === undefined && paletteTarget === undefined
        ? {}
        : paletteTarget !== undefined
        ? { target: paletteTarget!.identity, targetLabel: paletteTarget!.label }
        : { target: target!.identity, ...(target!.label() === undefined ? {} : { targetLabel: target!.label() }) }),
      ...(this.#verbPending === undefined
        ? {}
        : {
          verbPending: {
            identity: this.#verbPending.verb.identity,
            label: this.#verbPending.verb.label,
            request: this.pendingRequest(this.#verbPending.slot),
            slot: this.#verbPending.slot.name,
            type: this.#verbPending.slot.type,
          },
        }),
      verbs: Object.freeze(this.#verbs.map(verb =>
        Object.freeze({
          enabled: verb.enabled,
          identity: verb.identity,
          ...(verb.key === undefined ? {} : { key: verb.key }),
          label: verb.label,
        })
      )),
    })
  }

  targetAndActivate(identity: string, fallback?: () => unknown): unknown {
    const candidate = this.node(identity)
    if (!candidate) {
      return fallback?.()
    }
    if (!this.activatable(candidate)) {
      return
    }
    const activate = candidate.live?.activate
    this.target(identity)
    return activate ? activate() : fallback?.()
  }

  /** invokeVerb reruns applicability at dispatch so an assistive action never invokes stale state. */
  invokeVerb(targetIdentity: string, verbIdentity: string): boolean {
    const target = this.node(targetIdentity)
    if (!target || !this.targetable(target)) {
      return false
    }
    const verb = this.catalog.verbsFor(target, this.outline).find(candidate => candidate.identity === verbIdentity)
    if (!verb) {
      return false
    }
    this.target(targetIdentity)
    this.runVerb(verb)
    return true
  }

  focusRegion(identity: string): void {
    const region = this.node(identity)
    const modal = this.topActiveModal()
    if (
      !region
      || region.kind !== 'region'
      || !this.active(region)
      || (modal && region.identity !== modal.identity && !this.isWithin(region, modal.identity))
    ) {
      return
    }
    this.#focusRegion = identity
    this.#allocatedPrefix = undefined
    this.#overview = false
    this.#palette = false
    this.#paletteTarget = undefined
    this.#hints = false
    this.#verbs = []
    this.#verbsOpen = false
    this.#verbPending = undefined
    this.recomputeCandidates()
    this.emit()
  }

  target(identity: string): void {
    const node = this.node(identity)
    const region = node ? this.regionOf(node) : undefined
    if (!node || !region || !this.active(region) || !this.targetable(node)) {
      return
    }
    if (this.#engaged !== undefined && this.#engaged !== identity) {
      this.disengage()
    }
    this.#focusRegion = region.identity
    this.#allocatedPrefix = undefined
    const memory = this.memory()
    memory.target = identity
    this.#verbs = []
    this.#verbsOpen = false
    this.#verbPending = undefined
    this.#palette = false
    this.#paletteTarget = undefined
    node.live?.focus?.()
    this.recomputeCandidates()
    this.emit()
  }

  engage(identity: string): void {
    const node = this.node(identity)
    if (!node || !this.targetable(node)) {
      return
    }
    this.target(identity)
    if (this.targetIdentity() !== identity) {
      return
    }
    this.#engaged = identity
    node.live?.engage?.()
    this.emit()
  }

  disengage(identity?: string): void {
    if (identity !== undefined && identity !== this.#engaged) {
      return
    }
    const engaged = this.node(this.#engaged)
    this.#engaged = undefined
    // Clear reducer ownership before imperative blur can synchronously report another blur event.
    engaged?.live?.blur?.()
    this.emit()
  }

  narrow(value: string): void {
    if (this.#engaged) {
      this.disengage()
    }
    const memory = this.memory()
    memory.narrowing += value
    this.#allocatedPrefix = undefined
    this.#overview = false
    this.#hints = false
    this.#palette ? this.recomputePaletteCandidates() : this.recomputeCandidates()
    this.emit()
  }

  openVerbs(): void {
    this.#allocatedPrefix = undefined
    this.#verbs = this.catalog.verbsFor(this.node(this.targetIdentity()), this.outline)
    this.#verbsOpen = this.#verbs.length > 0
    this.#verbPending = undefined
    this.emit()
  }

  /** refreshVerbs notices reactive command presentation changes without reopening the surface. */
  refreshVerbs(): void {
    if (!this.#verbsOpen || this.#verbRefreshScheduled) {
      return
    }
    this.#verbRefreshScheduled = true
    queueMicrotask(() => {
      this.#verbRefreshScheduled = false
      if (!this.#verbsOpen) {
        return
      }
      const fingerprint = verbFingerprint(this.#verbs)
      const target = this.node(this.targetIdentity())
      if (!target || !this.targetable(target)) {
        this.#verbs = []
        this.#verbsOpen = false
      } else {
        this.#verbs = this.catalog.verbsFor(target, this.outline)
      }
      if (!this.#verbsOpen || verbFingerprint(this.#verbs) !== fingerprint) {
        this.emit()
      }
    })
  }

  /** choosePendingTarget fills the pending entity slot from one eligible mounted item. */
  choosePendingTarget(identity: string): boolean {
    const pending = this.#verbPending
    const node = this.node(identity)
    if (!pending || !pending.slot.entity || node?.live?.entityType !== pending.slot.type || !node.live.runtimeValue) {
      return false
    }
    this.advancePending(node.live.runtimeValue)
    return true
  }

  /** choosePendingSearchResult fills an entity slot from the store picker's real runtime handle. */
  choosePendingSearchResult(value: { evaluate(): { jsValue: unknown } }): boolean {
    const pending = this.#verbPending
    const entity = DataControls.EntityInteraction(value.evaluate().jsValue)
    if (!pending || !pending.slot.entity || entity?.entity !== pending.slot.type) {
      return false
    }
    this.advancePending(value)
    return true
  }

  /** providePendingValue fills one inline text/duration request through a runtime value. */
  providePendingValue(value: { evaluate(): { jsValue: unknown } }): boolean {
    if (!this.#verbPending || this.#verbPending.slot.entity) {
      return false
    }
    this.advancePending(value)
    return true
  }

  pressKey(input: TaoAttentionKey | string): boolean {
    const key = normalizeInteractionKey(input)
    if (!isBareLetter(key)) {
      this.#allocatedPrefix = undefined
    }
    if (this.#engaged && !['Escape', 'Tab', 'primary+k'].includes(key)) {
      if (!key.includes('+') || platformEditingChords.has(key.toLocaleLowerCase())) {
        return false
      }
    }
    if (this.#verbsOpen && isBareLetter(key)) {
      const verb = this.#verbs.find(candidate => candidate.key?.toLocaleLowerCase() === key.toLocaleLowerCase())
      if (verb) {
        this.runVerb(verb)
        return true
      }
    }
    if (isBareLetter(key) && this.runAllocatedKey(key)) {
      return true
    }
    if (key.includes('+')) {
      const verb = this.catalog.shortcut(
        key,
        this.node(this.targetIdentity()),
        this.#focusRegion,
        this.outline.liveNodes(),
      )
      if (verb) {
        this.runVerb(verb)
        return true
      }
    }
    if (key === 'Escape') {
      this.escape()
      return true
    }
    if (key === 'Enter') {
      if (this.#palette) {
        const verb = this.paletteVerbs().find(entry => entry.identity === this.#paletteTarget)
        if (verb) {
          this.#palette = false
          this.#paletteTarget = undefined
          this.memory().narrowing = ''
          this.recomputeCandidates()
          this.runVerb(verb)
        }
        return true
      }
      if (this.#verbPending) {
        const target = this.#candidates[0]
        return target ? this.choosePendingTarget(target) : true
      }
      const target = this.targetIdentity()
      if (target) {
        const node = this.node(target)
        if (node?.kind === 'input') {
          this.engage(target)
        } else if (
          node?.kind === 'item' && candidateNodes(node.identity, this.outline.liveNodes()).length > 0
          && !node.live?.activate
        ) {
          this.memory().scope = node.identity
          this.memory().target = undefined
          this.recomputeCandidates()
          this.emit()
        } else {
          this.targetAndActivate(target)
        }
      }
      return true
    }
    if (key === '.') {
      this.openVerbs()
      return true
    }
    if (key === '/' || key === '?') {
      this.#hints = !this.#hints
      this.#allocatedPrefix = undefined
      this.#overview = false
      this.#palette = false
      this.#paletteTarget = undefined
      this.emit()
      return true
    }
    if (key === 'primary+k') {
      if (this.#engaged) {
        this.disengage()
      }
      this.#allocatedPrefix = undefined
      this.#verbPending = undefined
      this.#verbs = []
      this.#verbsOpen = false
      this.#hints = false
      this.#overview = false
      this.#palette = true
      this.memory().narrowing = ''
      this.recomputePaletteCandidates()
      this.emit()
      return true
    }
    if (key === 'Backspace') {
      const memory = this.memory()
      memory.narrowing = [...memory.narrowing].slice(0, -1).join('')
      this.#palette ? this.recomputePaletteCandidates() : this.recomputeCandidates()
      this.emit()
      return true
    }
    if (key === 'Space') {
      this.narrow(' ')
      return true
    }
    if (key === 'ArrowLeft') {
      if (this.memory().scope) {
        this.memory().scope = undefined
        this.recomputeCandidates()
        this.emit()
      } else {
        this.moveRegion(-1)
      }
      return true
    }
    if (key === 'ArrowRight') {
      const target = this.node(this.targetIdentity())
      if (target?.kind === 'item' && candidateNodes(target.identity, this.outline.liveNodes()).length > 0) {
        this.memory().scope = target.identity
        this.memory().target = undefined
        this.recomputeCandidates()
        this.emit()
      } else {
        this.moveRegion(1)
      }
      return true
    }
    if (key === 'Tab' || key === 'ArrowDown' || key === 'ArrowUp') {
      if (key === 'Tab' && this.#engaged) {
        this.disengage()
      }
      this.move(key === 'ArrowUp' ? -1 : 1)
      return true
    }
    if (isPrintable(key) && !isReservedPunctuation(key)) {
      this.narrow(key)
      return true
    }
    return false
  }

  setPressed(identity: string, pressed: boolean): void {
    this.setPresence(this.#pressed, identity, pressed)
  }

  setHovered(identity: string, hovered: boolean): void {
    this.setPresence(this.#hovered, identity, hovered)
  }

  reset(): void {
    this.#allocations.clear()
    this.#allocatedPrefix = undefined
    this.#candidates = []
    this.#engaged = undefined
    this.#focusRegion = undefined
    this.#focusStack = []
    this.#hints = false
    this.#hovered.clear()
    this.#memory.clear()
    this.#overview = false
    this.#palette = false
    this.#paletteTarget = undefined
    this.#pressed.clear()
    this.#verbPending = undefined
    this.#verbs = []
    this.#verbsOpen = false
    this.emit()
  }

  revalidateOutline(): void {
    this.#allocatedPrefix = undefined
    const activeRegions = this.outline.liveNodes().filter(node => node.kind === 'region' && this.active(node))
    const modal = activeRegions.filter(node => node.live?.modal).at(-1)
    const focused = this.node(this.#focusRegion)
    if (modal && modal.identity !== this.#focusRegion && (!focused || !this.isWithin(focused, modal.identity))) {
      if (this.#focusRegion) {
        this.#focusStack.push(this.#focusRegion)
      }
      this.#focusRegion = modal.identity
    } else if (!modal && this.#focusRegion && !activeRegions.some(node => node.identity === this.#focusRegion)) {
      this.#focusRegion = this.takeRestorableFocus(activeRegions)
    } else if (!this.#focusRegion) {
      this.#focusRegion = this.primaryRegion(activeRegions)?.identity
    }
    const engaged = this.node(this.#engaged)
    if (this.#engaged && (!engaged || !this.targetable(engaged))) {
      this.#engaged = undefined
      engaged?.live?.blur?.()
    }
    for (const [region, memory] of this.#memory) {
      if (!this.node(memory.target)) {
        memory.target = undefined
      }
      const scope = this.node(memory.scope)
      if (!activeRegions.some(node => node.identity === region) || (memory.scope && (!scope || !this.active(scope)))) {
        memory.scope = undefined
      }
    }
    if (this.#verbsOpen) {
      const target = this.node(this.targetIdentity())
      if (!target || !this.targetable(target)) {
        this.#verbs = []
        this.#verbsOpen = false
      } else {
        this.#verbs = this.catalog.verbsFor(target, this.outline)
      }
    }
    this.recomputeCandidates()
    this.emit()
  }

  private scheduleOutlineRevalidation(): void {
    if (this.#outlineRevalidationScheduled) {
      return
    }
    this.#outlineRevalidationScheduled = true
    queueMicrotask(() => {
      this.#outlineRevalidationScheduled = false
      this.revalidateOutline()
    })
  }

  private move(delta: number): void {
    if (this.#candidates.length === 0) {
      this.node(this.#focusRegion)?.live?.scrollIntoView?.()
      return
    }
    const current = this.targetIdentity()
    const index = current === undefined ? (delta > 0 ? -1 : 0) : this.#candidates.indexOf(current)
    const next = this.#candidates[(index + delta + this.#candidates.length) % this.#candidates.length]
    if (next) {
      this.target(next)
    }
  }

  private escape(): void {
    if (this.#engaged) {
      this.disengage()
      return
    }
    if (this.#verbsOpen || this.#verbPending) {
      this.#verbs = []
      this.#verbsOpen = false
      this.#verbPending = undefined
      this.emit()
      return
    }
    if (this.#palette) {
      this.#palette = false
      this.#paletteTarget = undefined
      this.memory().narrowing = ''
      this.recomputeCandidates()
      this.emit()
      return
    }
    const memory = this.memory()
    if (memory.narrowing.length > 0) {
      memory.narrowing = ''
      this.recomputeCandidates()
      this.emit()
      return
    }
    if (memory.scope) {
      memory.scope = undefined
      this.recomputeCandidates()
      this.emit()
      return
    }
    if (this.#hints) {
      this.#hints = false
      this.#overview = true
      this.emit()
      return
    }
    this.#overview = true
    this.emit()
  }

  private runVerb(verb: TaoInteractionVerb): void {
    if (!verb.enabled) {
      this.recomputeCandidates()
      this.emit()
      return
    }
    this.#verbs = []
    this.#verbsOpen = false
    const command = verb.command
    const required = verb.slots?.filter(slot => slot.required && command?.unfilledSlots().includes(slot.name)) ?? []
    if (command && required.length > 0) {
      this.#verbPending = { command, slot: required[0]!, slots: required, verb }
      this.recomputePendingCandidates()
      this.emit()
      return
    }
    const current = command?.read()
    if (current && !current.enabled) {
      this.recomputeCandidates()
      this.emit()
      return
    }
    current ? current.invoke() : verb.invoke()
    this.emit()
  }

  private advancePending(value: { evaluate(): { jsValue: unknown } }): void {
    const pending = this.#verbPending
    if (!pending) {
      return
    }
    const command = pending.command.with({ [pending.slot.name]: value })
    const slots = pending.slots.slice(1)
    if (slots.length === 0) {
      this.#verbPending = undefined
      const current = command.read()
      if (current.enabled) {
        current.invoke()
      }
      this.recomputeCandidates()
      this.emit()
      return
    }
    this.#verbPending = { ...pending, command, slot: slots[0]!, slots }
    this.recomputePendingCandidates()
    this.emit()
  }

  private recomputePendingCandidates(): void {
    const pending = this.#verbPending
    if (!pending?.slot.entity) {
      this.#candidates = []
      return
    }
    this.#candidates = this.outline.liveNodes()
      .filter(node => this.targetable(node) && node.live?.entityType === pending.slot.type)
      .filter(node =>
        this.memory().narrowing.length === 0
        || matchesNarrowing(node.corpus?.() ?? [node.label() ?? ''], this.memory().narrowing)
      )
      .map(node => node.identity)
  }

  private pendingRequest(slot: TaoCommandSlotDescription): 'input' | 'search' | 'targets' {
    if (!slot.entity) {
      return 'input'
    }
    return this.#candidates.length > 0 ? 'targets' : 'search'
  }

  private recomputeCandidates(): void {
    if (this.#verbPending) {
      this.recomputePendingCandidates()
      return
    }
    const region = this.#focusRegion
    if (!region) {
      this.#candidates = []
      return
    }
    const memory = this.memory()
    const scope = memory.scope ?? region
    const candidates = candidateNodes(scope, this.outline.liveNodes())
      .filter(node =>
        memory.narrowing.length === 0 || matchesNarrowing(node.corpus?.() ?? [node.label() ?? ''], memory.narrowing)
      )
    this.#candidates = candidates.map(node => node.identity)
    if (this.#candidates.length === 1) {
      memory.target = this.#candidates[0]
    } else if (memory.target && !this.#candidates.includes(memory.target)) {
      memory.target = undefined
    }
  }

  private paletteVerbs(): readonly TaoInteractionVerb[] {
    if (!this.#palette) {
      return []
    }
    const narrowing = this.memory().narrowing
    const entries: TaoInteractionVerb[] = []
    const seen = new Set<string>()
    for (const command of this.catalog.palette()) {
      if (seen.has(command.identity)) {
        continue
      }
      seen.add(command.identity)
      entries.push(command)
    }
    for (const node of this.outline.liveNodes()) {
      const label = node.label()
      const identity = paletteEntityIdentity(node)
      if (
        node.kind !== 'item'
        || node.live?.entityType === undefined
        || node.live.activate === undefined
        || label === undefined
        || label.trim().length === 0
        || !this.active(node)
        || seen.has(identity)
      ) {
        continue
      }
      seen.add(identity)
      entries.push({
        enabled: node.live.enabled?.() !== false,
        identity,
        label,
        invoke: () => this.targetAndActivate(node.identity),
        source: 'entity',
      })
    }
    return entries.filter(verb => narrowing.length === 0 || matchesNarrowing([verb.label], narrowing))
  }

  private runAllocatedKey(key: string): boolean {
    if (this.#verbsOpen) {
      const candidates = this.#verbs.filter(verb => verb.key === undefined)
        .map(verb => ({ identity: verb.identity, label: verb.label }))
      return this.dispatchAllocatedKey('verbs', candidates, key, identity => {
        const verb = this.#verbs.find(candidate => candidate.identity === identity)
        if (verb) {
          this.runVerb(verb)
        }
      })
    }
    if (this.#hints) {
      const candidates = this.#candidates.flatMap(identity => {
        const label = this.node(identity)?.label()
        return label === undefined ? [] : [{ identity, label }]
      })
      return this.dispatchAllocatedKey('hints', candidates, key, identity => {
        this.#hints = false
        this.target(identity)
      })
    }
    if (this.#overview) {
      const candidates = this.outline.liveNodes()
        .filter(node => node.kind === 'region' && this.active(node))
        .flatMap(node => {
          const label = node.label()
          return label === undefined ? [] : [{ identity: node.identity, label }]
        })
      return this.dispatchAllocatedKey('overview', candidates, key, identity => {
        this.focusRegion(identity)
      })
    }
    if (this.#palette) {
      const candidates = this.paletteVerbs().filter(verb => verb.key === undefined)
        .map(verb => ({ identity: verb.identity, label: verb.label }))
      return this.dispatchAllocatedKey('palette', candidates, key, identity => {
        this.#paletteTarget = identity
        this.emit()
      })
    }
    this.#allocatedPrefix = undefined
    return false
  }

  private dispatchAllocatedKey(
    surface: string,
    candidates: readonly Readonly<{ identity: string; label: string }>[],
    key: string,
    dispatch: (identity: string) => void,
  ): boolean {
    const assignments = allocateInteractionKeys(candidates, {
      explicitKeys: this.catalog.explicitKeys(),
      previous: this.#allocations.get(surface),
    })
    this.#allocations.set(surface, assignments)
    const normalized = key.toLocaleLowerCase()
    const pending = this.#allocatedPrefix?.surface === surface ? this.#allocatedPrefix.prefix : undefined
    const attempts = pending === undefined ? [normalized] : [`${pending}${normalized}`, normalized]
    for (const attempt of attempts) {
      const exact = candidates.find(candidate => assignments[candidate.identity] === attempt)
      if (exact) {
        this.#allocatedPrefix = undefined
        dispatch(exact.identity)
        return true
      }
      if (Object.values(assignments).some(assignment => assignment.startsWith(attempt))) {
        this.#allocatedPrefix = { prefix: attempt, surface }
        return true
      }
    }
    this.#allocatedPrefix = undefined
    return false
  }

  private recomputePaletteCandidates(): void {
    const entries = this.paletteVerbs()
    this.#candidates = entries.map(entry => entry.identity)
    if (entries.length === 1) {
      this.#paletteTarget = entries[0]!.identity
    } else if (!entries.some(entry => entry.identity === this.#paletteTarget)) {
      this.#paletteTarget = undefined
    }
  }

  private regionOf(node: TaoOutlineLiveNode): TaoOutlineLiveNode | undefined {
    let current: TaoOutlineLiveNode | undefined = node
    while (current) {
      if (current.kind === 'region') {
        return current
      }
      current = this.node(current.parent)
    }
    return undefined
  }

  private primaryRegion(regions: readonly TaoOutlineLiveNode[]): TaoOutlineLiveNode | undefined {
    return regions.findLast(region => region.live?.primary) ?? regions.at(-1)
  }

  private moveRegion(delta: number): void {
    const modal = this.topActiveModal()
    const regions = this.outline.liveNodes().filter(node =>
      node.kind === 'region'
      && this.active(node)
      && (modal ? node.identity === modal.identity || this.isWithin(node, modal.identity) : !node.live?.modal)
    )
    if (regions.length === 0) {
      return
    }
    const index = this.#focusRegion === undefined
      ? (delta > 0 ? -1 : 0)
      : regions.findIndex(node => node.identity === this.#focusRegion)
    const next = regions[(index + delta + regions.length) % regions.length]
    if (next) {
      this.focusRegion(next.identity)
    }
  }

  private takeRestorableFocus(regions: readonly TaoOutlineLiveNode[]): string | undefined {
    while (this.#focusStack.length > 0) {
      const identity = this.#focusStack.pop()!
      if (regions.some(region => region.identity === identity)) {
        return identity
      }
    }
    return this.primaryRegion(regions)?.identity
  }

  private topActiveModal(): TaoOutlineLiveNode | undefined {
    return this.outline.liveNodes().filter(node => node.kind === 'region' && node.live?.modal && this.active(node)).at(
      -1,
    )
  }

  private isWithin(node: TaoOutlineLiveNode, ancestor: string): boolean {
    let parent = node.parent
    while (parent) {
      if (parent === ancestor) {
        return true
      }
      parent = this.node(parent)?.parent
    }
    return false
  }

  private targetIdentity(): string | undefined {
    return this.memory().target
  }

  private memory(): RegionMemory {
    if (!this.#focusRegion) {
      return { narrowing: '' }
    }
    let memory = this.#memory.get(this.#focusRegion)
    if (!memory) {
      memory = { narrowing: '' }
      this.#memory.set(this.#focusRegion, memory)
    }
    return memory
  }

  private node(identity: string | undefined): TaoOutlineLiveNode | undefined {
    return identity === undefined ? undefined : this.outline.liveNodes().find(node => node.identity === identity)
  }

  private targetable(node: TaoOutlineLiveNode): boolean {
    return (node.kind === 'action' || node.kind === 'input' || node.kind === 'item')
      && this.activatable(node)
      && this.active(node)
  }

  /** Native activation may precede attention repair, but never crosses disabled or modal bounds. */
  private activatable(node: TaoOutlineLiveNode): boolean {
    const modal = this.topActiveModal()
    return node.live?.enabled?.() !== false
      && (
        modal === undefined
        || node.identity === modal.identity
        || this.isWithin(node, modal.identity)
        || isNavigationBackControl(node)
      )
  }

  private active(node: TaoOutlineLiveNode): boolean {
    let current: TaoOutlineLiveNode | undefined = node
    while (current) {
      if (current.live?.active?.() === false) {
        return false
      }
      current = this.node(current.parent)
    }
    return true
  }

  private mode(): TaoAttentionMode {
    if (this.#engaged) {
      return 'engaged'
    }
    if (this.#verbPending) {
      return 'verb-pending'
    }
    if (this.#verbsOpen) {
      return 'verbs'
    }
    if (this.#palette) {
      return 'palette'
    }
    if (this.#hints) {
      return 'hints'
    }
    if (this.#overview) {
      return 'overview'
    }
    if (this.memory().narrowing.length > 0) {
      return 'narrowing'
    }
    return 'navigating'
  }

  private setPresence(set: Set<string>, identity: string, present: boolean): void {
    const changed = present ? !set.has(identity) : set.has(identity)
    present ? set.add(identity) : set.delete(identity)
    if (changed) {
      this.emit()
    }
  }

  private emit(): void {
    this.#revision += 1
    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}

function verbFingerprint(verbs: readonly TaoInteractionVerb[]): string {
  return JSON.stringify(verbs.map(verb => [verb.identity, verb.label, verb.enabled, verb.key]))
}

/** The root-safe Back affordance sits outside a native modal portal but dismisses its top entry. */
function isNavigationBackControl(node: TaoOutlineLiveNode): boolean {
  const control = node.provenance['control']
  return typeof control === 'string' && (control === 'navigation:back' || control.endsWith(':back'))
}

function candidateNodes(scope: string, nodes: readonly TaoOutlineLiveNode[]): TaoOutlineLiveNode[] {
  const children = new Map<string, TaoOutlineLiveNode[]>()
  for (const node of nodes) {
    if (node.parent) {
      const siblings = children.get(node.parent) ?? []
      siblings.push(node)
      children.set(node.parent, siblings)
    }
  }
  const candidates: TaoOutlineLiveNode[] = []
  const visit = (identity: string) => {
    for (const child of children.get(identity) ?? []) {
      if (child.live?.active?.() === false || child.kind === 'region') {
        continue
      }
      if (child.kind === 'collection') {
        visit(child.identity)
      } else if (
        (child.kind === 'action' || child.kind === 'input' || child.kind === 'item')
        && child.live?.enabled?.() !== false
      ) {
        candidates.push(child)
      }
    }
  }
  visit(scope)
  return candidates
}

function paletteEntityIdentity(node: TaoOutlineLiveNode): string {
  const entity = node.provenance['entity']
  const handle = node.provenance['handle']
  return typeof entity === 'string' && typeof handle === 'string'
    ? `@entity/${encodeURIComponent(entity)}/${encodeURIComponent(handle)}`
    : node.identity
}

function isBareLetter(value: string): boolean {
  return /^\p{L}$/u.test(value)
}

function isPrintable(value: string): boolean {
  return [...value].length === 1 && value >= ' '
}

function isReservedPunctuation(value: string): boolean {
  return value === '.' || value === '/' || value === '?'
}

const platformEditingChords = new Set(['primary+a', 'primary+c', 'primary+v', 'primary+x', 'primary+z'])
