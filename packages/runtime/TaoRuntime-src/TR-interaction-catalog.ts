import React from 'react'
import { Arrays } from './core/RuntimeCore'
import { focusAccessibilityHost, type TaoAccessibilityHost } from './TR-accessibility'
import type { TaoDesign, TaoDesignSpec } from './TR-design'
import { CommandControls, type RuntimeCommand } from './TR-interaction'
import { InteractionAttention, type TaoAttentionKey } from './TR-interaction-attention'
import { interactionKeyboardPresence, normalizeInteractionKey } from './TR-interaction-keys'
import {
  describeOutlineTable,
  interactionOutline,
  rowRootOf,
  type TaoInteractionOccurrence,
  type TaoOutlineDescribedTable,
  type TaoOutlineLiveNode,
  type TaoOutlineRowRoot,
  type TaoOutlineTable,
  useOutlineOccurrence,
  useOutlineParentIdentity,
} from './TR-interaction-outline'
import { runtimeRevisionStore } from './TR-listeners'
import type { Evaluable } from './TR-navigation-presentables'
import { requireReactNativeRuntime } from './TR-react-native'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'
import { type TaoProps, TaoPropsControls, type TaoVisualLayout } from './TR-TaoProps'

export type TaoCommandSlotDescription = Readonly<{
  entity: boolean
  name: string
  required: boolean
  type: string
}>

type TaoCommandStaticDescription = Readonly<{
  description?: string
  icon?: string
  key?: string
  label?: string
  summary?: string
  title?: string
}>

export type TaoCommandTableEntry = Readonly<{
  command: () => RuntimeCommand
  identity: string
  name: string
  scope: Readonly<{ declaration?: string; kind: 'module' | 'view' }>
  slots: readonly TaoCommandSlotDescription[]
  static: TaoCommandStaticDescription
}>

export type TaoCommandTable = Readonly<{
  commands: readonly TaoCommandTableEntry[]
  module: string
}>

export type TaoCommandSurface = Readonly<{
  commands: readonly RuntimeCommand[]
  hidden: readonly string[]
  identity: string
}>

type MountedCommandSurface = TaoCommandSurface & Readonly<{ parent?: string; sequence: number }>
type MountedCommandTable = TaoCommandTable & Readonly<{ parent?: string; sequence: number }>

export type TaoInteractionVerb = Readonly<{
  command?: RuntimeCommand
  enabled: boolean
  identity: string
  key?: string
  label: string
  invoke(): unknown
  slots?: readonly TaoCommandSlotDescription[]
  source: 'catalog' | 'control' | 'entity' | 'view'
}>

/** CommandCatalog owns generated declarations and occurrence-local command surfaces. */
export class CommandCatalog {
  readonly #changes = runtimeRevisionStore()
  #sequence = 0
  #surfaces = new Map<number, MountedCommandSurface>()
  #tables = new Map<string, MountedCommandTable>()

  register(table: TaoCommandTable, parent?: string): () => void {
    const sequence = ++this.#sequence
    const key = `${table.module}#${sequence}`
    this.#tables.set(key, { ...table, ...(parent === undefined ? {} : { parent }), sequence })
    this.changed()
    return () => {
      this.#tables.delete(key)
      this.changed()
    }
  }

  registerSurface(surface: TaoCommandSurface, parent?: string): () => void {
    const sequence = ++this.#sequence
    this.#surfaces.set(sequence, {
      get commands() {
        return surface.commands
      },
      get hidden() {
        return surface.hidden
      },
      identity: surface.identity,
      ...(parent === undefined ? {} : { parent }),
      sequence,
    })
    this.changed()
    return () => {
      this.#surfaces.delete(sequence)
      this.changed()
    }
  }

  readonly snapshot = this.#changes.snapshot
  readonly subscribe = this.#changes.subscribe

  entries(): readonly TaoCommandTableEntry[] {
    return [...this.#tables.values()].flatMap(table => table.commands)
  }

  applicable(entityType: string): readonly TaoCommandTableEntry[] {
    return this.entries().filter(entry =>
      entry.scope.kind === 'module' && entry.slots.some(slot => slot.entity && slot.type === entityType)
    )
  }

  global(): readonly TaoCommandTableEntry[] {
    return this.entries().filter(entry => entry.scope.kind === 'module' && !entry.slots.some(slot => slot.entity))
  }

  explicitKeys(): readonly string[] {
    return this.entries().flatMap(entry => entry.static.key === undefined ? [] : [entry.static.key])
  }

  /** palette returns every titled catalog entry without requiring a mounted target. */
  palette(): readonly TaoInteractionVerb[] {
    return this.entries()
      .filter(entry => entry.static.title !== undefined || entry.static.label !== undefined)
      .map(entry => {
        const command = entry.command()
        const snapshot = directlyReadable(command, entry.slots) ? command.read() : undefined
        return {
          enabled: snapshot?.enabled ?? true,
          command,
          identity: entry.identity,
          ...(snapshot?.key === undefined && entry.static.key === undefined
            ? {}
            : { key: snapshot?.key ?? entry.static.key }),
          label: entry.static.title ?? entry.name,
          invoke: () => {
            const current = command.read()
            return current.enabled ? current.invoke() : undefined
          },
          slots: entry.slots,
          source: 'catalog' as const,
        }
      })
  }

  /** shortcut resolves nearest mounted scopes before entity-free module commands. */
  shortcut(
    key: string,
    target: TaoOutlineLiveNode | undefined,
    focusRegion: string | undefined,
    nodes: readonly TaoOutlineLiveNode[],
  ): TaoInteractionVerb | undefined {
    const normalized = normalizedShortcutKey(key)
    for (const surface of target ? this.surfacesForTarget(target, nodes) : []) {
      if (surface.parent !== target?.identity) {
        continue
      }
      for (const command of surface.commands) {
        const verb = this.verbForCommand(command, 'view')
        if (normalizedShortcutKey(verb.key) === normalized) {
          return verb
        }
      }
    }
    const targetVerb = this.verbsFor(target, interactionOutline, nodes)
      .find(verb => verb.source !== 'view' && normalizedShortcutKey(verb.key) === normalized)
    if (targetVerb) {
      return targetVerb
    }
    const modal = nodes.findLast(node =>
      node.kind === 'region'
      && node.live?.modal === true
      && isActive(node, nodes)
      && (node.identity === focusRegion || isAncestor(node.identity, focusRegion ?? '', nodes))
    )
    const inFocusedRegion = Arrays.sorted(
      [...this.#surfaces.values()].filter(surface => {
        const parent = nodes.find(node => node.identity === surface.parent)
        const regionScoped = parent?.kind === 'region' || isWithinNavigationSiblingRegion(surface.parent, nodes)
        return regionScoped && (!parent || isActive(parent, nodes)) && (focusRegion === undefined || (modal
          ? surface.parent === modal.identity || isAncestor(modal.identity, surface.parent ?? '', nodes)
          : surface.parent === focusRegion
            || isAncestor(focusRegion, surface.parent ?? '', nodes)
            || isAncestor(surface.parent, focusRegion, nodes)
            || isWithinNavigationSiblingRegion(surface.parent, nodes)))
      }),
      (left, right) => right.sequence - left.sequence,
    )
    for (const surface of inFocusedRegion) {
      for (const command of surface.commands) {
        const verb = this.verbForCommand(command, 'view')
        if (normalizedShortcutKey(verb.key) === normalized) {
          return verb
        }
      }
    }
    for (const table of this.scopedTables(target, focusRegion, nodes)) {
      for (const entry of table.commands) {
        if (entry.scope.kind !== 'view') {
          continue
        }
        const verb = this.verbForEntry(entry, target, 'catalog')
        if (verb && normalizedShortcutKey(verb.key) === normalized) {
          return verb
        }
      }
    }
    for (const entry of this.global()) {
      const verb = this.verbForEntry(entry, target, 'catalog')
      if (verb && normalizedShortcutKey(verb.key) === normalized) {
        return verb
      }
    }
    return undefined
  }

  /** verbsFor applies decided tier ordering, then folds identity and visible-label duplicates. */
  verbsFor(
    target: TaoOutlineLiveNode | undefined,
    outline = interactionOutline,
    nodes: readonly TaoOutlineLiveNode[] = outline.liveNodes(),
  ): readonly TaoInteractionVerb[] {
    if (!target) {
      return []
    }
    const hidden = new Set(target.live?.commandPolicy?.hidden ?? [])
    const surfaces = this.surfacesForTarget(target, nodes)
    for (const surface of surfaces) {
      for (const identity of surface.hidden) {
        hidden.add(identity)
      }
    }
    const verbs: TaoInteractionVerb[] = []
    const seen = new Set<string>()
    const seenLabels = new Set<string>()
    const add = (verb: TaoInteractionVerb | undefined, explicitlyPromoted = false) => {
      if (!verb) {
        return
      }
      const label = verb.label.normalize('NFC')
      if (seen.has(verb.identity) || seenLabels.has(label) || (!explicitlyPromoted && hidden.has(verb.identity))) {
        return
      }
      seen.add(verb.identity)
      seenLabels.add(label)
      verbs.push(verb)
    }

    for (const surface of surfaces) {
      for (const command of surface.commands) {
        add(this.verbForCommand(command, 'view'), true)
      }
    }
    for (const child of directTargetableChildren(target.identity, nodes)) {
      if (child.kind === 'action' || child.kind === 'input') {
        add(controlVerb(child))
      }
    }
    const entityType = target.live?.entityType
    const surfaced = target.live?.commandPolicy?.surfaced ?? []
    if (entityType) {
      for (const identity of surfaced) {
        add(this.verbForEntry(this.entries().find(entry => entry.identity === identity), target, 'entity'))
      }
      const remainder = Arrays.sorted(
        this.applicable(entityType).filter(entry => !seen.has(entry.identity)),
        (left, right) => staticLabel(left).localeCompare(staticLabel(right), undefined, { sensitivity: 'base' }),
      )
      for (const entry of remainder) {
        add(this.verbForEntry(entry, target, 'catalog'))
      }
    }
    return verbs
  }

  /** entryForCommand recovers canonical identity across bindings of one RuntimeCommand declaration. */
  entryForCommand(command: RuntimeCommand): TaoCommandTableEntry | undefined {
    return this.entries().find(entry => entry.command().declaration() === command.declaration())
  }

  clear(): void {
    this.#tables.clear()
    this.#surfaces.clear()
    this.changed()
  }

  private changed(): void {
    this.#changes.changed()
  }

  private scopedTables(
    target: TaoOutlineLiveNode | undefined,
    focusRegion: string | undefined,
    nodes: readonly TaoOutlineLiveNode[],
  ): readonly MountedCommandTable[] {
    return Arrays.sorted(
      [...this.#tables.values()].filter(table => {
        if (table.parent === undefined || !table.commands.some(entry => entry.scope.kind === 'view')) {
          return false
        }
        const parent = nodes.find(node => node.identity === table.parent)
        if (parent && !isActive(parent, nodes)) {
          return false
        }
        return target
          ? table.parent === target.identity || isAncestor(table.parent, target.identity, nodes)
          : table.parent === focusRegion
      }),
      (left, right) => {
        const leftDistance = ancestorDistance(left.parent, target?.identity, nodes)
        const rightDistance = ancestorDistance(right.parent, target?.identity, nodes)
        return leftDistance - rightDistance || right.sequence - left.sequence
      },
    )
  }

  private surfacesForTarget(
    target: TaoOutlineLiveNode,
    nodes: readonly TaoOutlineLiveNode[],
  ): readonly MountedCommandSurface[] {
    return Arrays.sorted(
      [...this.#surfaces.values()].filter(surface =>
        surface.parent === target.identity || isAncestor(surface.parent, target.identity, nodes)
      ),
      (left, right) => {
        const leftDistance = ancestorDistance(left.parent, target.identity, nodes)
        const rightDistance = ancestorDistance(right.parent, target.identity, nodes)
        return leftDistance - rightDistance || right.sequence - left.sequence
      },
    )
  }

  private verbForCommand(command: RuntimeCommand, source: TaoInteractionVerb['source']): TaoInteractionVerb {
    const entry = this.entryForCommand(command)
    const snapshot = command.read()
    return {
      enabled: snapshot.enabled,
      command,
      identity: entry?.identity ?? command.name,
      ...(snapshot.key === undefined ? {} : { key: snapshot.key }),
      label: snapshot.label,
      invoke: snapshot.invoke,
      ...(entry === undefined ? {} : { slots: entry.slots }),
      source,
    }
  }

  private verbForEntry(
    entry: TaoCommandTableEntry | undefined,
    target: TaoOutlineLiveNode | undefined,
    source: TaoInteractionVerb['source'],
  ): TaoInteractionVerb | undefined {
    if (!entry) {
      return undefined
    }
    let command = entry.command()
    const entitySlot = entry.slots.find(slot => slot.entity && slot.type === target?.live?.entityType)
    if (entitySlot && target?.live?.runtimeValue) {
      command = command.with({ [entitySlot.name]: target.live.runtimeValue })
    }
    const snapshot = command.read()
    const key = snapshot.key ?? entry.static.key
    return {
      enabled: snapshot.enabled,
      command,
      identity: entry.identity,
      ...(key === undefined ? {} : { key }),
      label: snapshot.label || staticLabel(entry),
      invoke: snapshot.invoke,
      slots: entry.slots,
      source,
    }
  }
}

/**
 * normalizedShortcutKey canonicalizes a declared key exactly as key allocation's exclusion list
 * does, so the one spelling a command reserves is the one spelling that dispatches it.
 */
function normalizedShortcutKey(value: string | undefined): string | undefined {
  return value === undefined ? undefined : normalizeInteractionKey(value).toLocaleLowerCase()
}

function staticLabel(entry: TaoCommandTableEntry): string {
  return entry.static.label ?? entry.static.title ?? entry.name
}

function directlyReadable(command: RuntimeCommand, slots: readonly TaoCommandSlotDescription[]): boolean {
  const unfilled = new Set(command.unfilledSlots())
  return !slots.some(slot => slot.required && unfilled.has(slot.name))
}

function controlVerb(node: TaoOutlineLiveNode): TaoInteractionVerb | undefined {
  const activate = node.live?.activate
  const label = node.label()
  if (!activate || !label) {
    return undefined
  }
  return {
    enabled: node.live?.enabled?.() !== false,
    identity: node.identity,
    label,
    invoke: activate,
    source: 'control',
  }
}

function directTargetableChildren(parent: string, nodes: readonly TaoOutlineLiveNode[]): TaoOutlineLiveNode[] {
  return nodes.filter(node => node.parent === parent && (node.kind === 'action' || node.kind === 'input'))
}

function isAncestor(candidate: string | undefined, target: string, nodes: readonly TaoOutlineLiveNode[]): boolean {
  if (!candidate) {
    return false
  }
  let current = nodes.find(node => node.identity === target)?.parent
  while (current) {
    if (current === candidate) {
      return true
    }
    current = nodes.find(node => node.identity === current)?.parent
  }
  return false
}

function ancestorDistance(
  candidate: string | undefined,
  target: string | undefined,
  nodes: readonly TaoOutlineLiveNode[],
): number {
  if (candidate === undefined || target === undefined) {
    return Number.MAX_SAFE_INTEGER
  }
  let current: string | undefined = target
  let distance = 0
  while (current) {
    if (current === candidate) {
      return distance
    }
    current = nodes.find(node => node.identity === current)?.parent
    distance += 1
  }
  return Number.MAX_SAFE_INTEGER
}

function isActive(node: TaoOutlineLiveNode, nodes: readonly TaoOutlineLiveNode[]): boolean {
  let current: TaoOutlineLiveNode | undefined = node
  while (current) {
    if (current.live?.active?.() === false) {
      return false
    }
    current = nodes.find(candidate => candidate.identity === current?.parent)
  }
  return true
}

/** A wrapper-free sibling region stays in scope while focus is inside the nav beside it. */
function isWithinNavigationSiblingRegion(
  identity: string | undefined,
  nodes: readonly TaoOutlineLiveNode[],
): boolean {
  let current = nodes.find(node => node.identity === identity)
  while (current) {
    if (current.kind === 'region') {
      return current.provenance['role'] === 'nav-siblings'
    }
    current = nodes.find(node => node.identity === current?.parent)
  }
  return false
}

export const commandCatalog = new CommandCatalog()
export const interactionAttention = new InteractionAttention(interactionOutline, commandCatalog)

registerRuntimeCaptureDomain({
  capture: () =>
    ({
      attention: interactionAttention.read(),
      outline: interactionOutline.read(),
    }) as unknown as TaoRuntimeJson,
  domain: 'interaction',
  version: 2,
})

function registerCommands(table: TaoCommandTable): () => void {
  return commandCatalog.register(table)
}

function useRegisteredCommands(table: TaoCommandTable): void {
  const parent = useOutlineParentIdentity()
  const commands = table.commands
  const identities = commands.map(entry => entry.identity).join('\u0000')
  const current = React.useRef(table)
  current.current = table
  React.useEffect(
    () =>
      commandCatalog.register({
        get commands() {
          return current.current.commands
        },
        module: table.module,
      }, parent),
    [parent, table.module, identities],
  )
}

function useCommandSurface(surface: TaoCommandSurface): void {
  const parent = useOutlineParentIdentity()
  const current = React.useRef(surface)
  current.current = surface
  const signature = `${surface.identity}\u0000${surface.hidden.join('\u0000')}\u0000${surface.commands.length}`
  React.useEffect(
    () =>
      commandCatalog.registerSurface({
        get commands() {
          return current.current.commands
        },
        get hidden() {
          return current.current.hidden
        },
        identity: surface.identity,
      }, parent),
    [parent, signature],
  )
}

function useOccurrence(props: TaoProps | undefined): void {
  const owner = TaoPropsControls.interactionOwner(props)
  const occurrence = useOutlineOccurrence(props, owner)
  const reactive = usesInteractionDesign(props)
  const snapshot = () => reactive ? occurrenceAttentionSnapshot(occurrence) : ''
  React.useSyncExternalStore(
    reactive ? interactionAttention.subscribe : quietSubscribe,
    snapshot,
    snapshot,
  )
  React.useEffect(() => interactionAttention.refreshVerbs())
  TaoPropsControls.setInteractionOccurrence(props, occurrence, interactionAttention.condition)
}

const quietSubscribe = (): () => void => () => undefined

function occurrenceAttentionSnapshot(occurrence: TaoInteractionOccurrence): string {
  return [
    interactionAttention.condition('focused', undefined, occurrence),
    interactionAttention.condition('pressed', undefined, occurrence),
    interactionAttention.condition('hovered', undefined, occurrence),
    ...(occurrence.regionSubjects ?? []).map(subject =>
      `${subject}:${interactionAttention.condition(subject, 'active', occurrence)}`
    ),
  ].join('|')
}

function usesInteractionDesign(props: TaoProps | undefined): boolean {
  const design = TaoPropsControls.ambientContext(props).app?.design
  const visitedBundles = new Set<string>()
  let current = props
  while (current) {
    if (
      designSpecUsesInteraction(current.designSpec, design, visitedBundles)
      || designSpecUsesInteraction(
        current.designDefault === undefined ? undefined : design?.bundles[current.designDefault],
        design,
        visitedBundles,
      )
    ) {
      return true
    }
    current = current.callerProps
  }
  return false
}

function designSpecUsesInteraction(
  spec: TaoDesignSpec | undefined,
  design: TaoDesign | undefined,
  visitedBundles: Set<string>,
): boolean {
  if (!spec) {
    return false
  }
  for (const entry of spec.entries) {
    const condition = entry.indexOf('when')
    if (condition >= 0) {
      const suffix = entry.slice(condition)
      if (suffix[0] !== 'when' || suffix[1] !== 'Scheme') {
        return true
      }
    }
    const effective = condition < 0 ? entry : entry.slice(0, condition)
    const bundle = effective.length === 1 && typeof effective[0] === 'string' ? effective[0] : undefined
    if (bundle && !visitedBundles.has(bundle)) {
      visitedBundles.add(bundle)
      if (designSpecUsesInteraction(design?.bundles[bundle], design, visitedBundles)) {
        return true
      }
    }
  }
  return false
}

/** resetInteractionRuntime clears ephemeral mounted/attention state but preserves module command tables. */
export function resetInteractionRuntime(): void {
  interactionOutline.clear()
  interactionAttention.reset()
  interactionKeyboardPresence.reset()
}

/** InteractionControls is the handwritten generated-code and semantic-operation facade. */
export const InteractionControls = {
  AccessibilityRef(
    occurrence: TaoInteractionOccurrence | undefined,
    label: string | undefined,
  ): ((host: TaoAccessibilityHost | null) => void) | undefined {
    if (!occurrence?.control) {
      return undefined
    }
    occurrence.capabilities.label = () => label
    return host => {
      if (host === null) {
        delete occurrence.capabilities.focus
      } else {
        occurrence.capabilities.focus = () => focusAccessibilityHost(requireReactNativeRuntime(), host)
      }
    }
  },
  ...CommandControls,
  Attention: interactionAttention,
  Catalog: commandCatalog,
  Outline: interactionOutline,
  Activate(occurrence: TaoInteractionOccurrence | undefined, invoke: () => unknown): () => unknown {
    if (occurrence?.control) {
      occurrence.capabilities.activate = invoke
    }
    return () =>
      occurrence?.control
        ? interactionAttention.targetAndActivate(occurrence.control, invoke)
        : invoke()
  },
  ActivateIdentity(identity: string | undefined, invoke: () => unknown): () => unknown {
    return () => identity === undefined ? invoke() : interactionAttention.targetAndActivate(identity, invoke)
  },
  ChoosePendingSearchResult(value: Evaluable): boolean {
    return interactionAttention.choosePendingSearchResult(value)
  },
  ChoosePendingTarget(identity: string): boolean {
    return interactionAttention.choosePendingTarget(identity)
  },
  Disengage(occurrence: TaoInteractionOccurrence | undefined): void {
    if (occurrence?.control) {
      interactionAttention.disengage(occurrence.control)
    }
  },
  Enabled(occurrence: TaoInteractionOccurrence | undefined, enabled: boolean): void {
    if (occurrence?.control) {
      occurrence.capabilities.enabled = () => enabled
    }
  },
  Engage(occurrence: TaoInteractionOccurrence | undefined): void {
    if (occurrence?.control) {
      interactionAttention.engage(occurrence.control)
    }
  },
  FocusRegion(identity: string): void {
    interactionAttention.focusRegion(identity)
  },
  FromProps(props: TaoProps | undefined): TaoInteractionOccurrence | undefined {
    return TaoPropsControls.interactionOccurrence(props)
  },
  FromVisualLayout(layout: TaoVisualLayout | undefined): TaoInteractionOccurrence | undefined {
    return TaoPropsControls.visualInteractionOccurrence(layout)
  },
  Hover(occurrence: TaoInteractionOccurrence | undefined, hovered: boolean): void {
    if (occurrence?.control) {
      interactionAttention.setHovered(occurrence.control, hovered)
    }
  },
  InvokeVerb(targetIdentity: string, verbIdentity: string): boolean {
    return interactionAttention.invokeVerb(targetIdentity, verbIdentity)
  },
  Narrow(value: string): void {
    interactionAttention.narrow(value)
  },
  OpenVerbs(): void {
    interactionAttention.openVerbs()
  },
  OutlineTable<TableT extends TaoOutlineTable>(table: TableT): TaoOutlineDescribedTable<TableT> {
    return describeOutlineTable(table)
  },
  PressKey(key: TaoAttentionKey | string): boolean {
    interactionKeyboardPresence.mark()
    return interactionAttention.pressKey(key)
  },
  Pressed(occurrence: TaoInteractionOccurrence | undefined, pressed: boolean): void {
    if (occurrence?.control) {
      interactionAttention.setPressed(occurrence.control, pressed)
    }
  },
  ProvidePendingValue(value: Evaluable): boolean {
    return interactionAttention.providePendingValue(value)
  },
  Target(occurrence: TaoInteractionOccurrence | undefined): void {
    if (occurrence?.control) {
      interactionAttention.target(occurrence.control)
    } else if (occurrence?.region) {
      interactionAttention.focusRegion(occurrence.region)
    }
  },
  TargetIdentity(identity: string | undefined): void {
    if (identity !== undefined) {
      interactionAttention.target(identity)
    }
  },
  RegisterCommands: registerCommands,
  RowRoot(value: object): TaoOutlineRowRoot | undefined {
    return rowRootOf(value)
  },
  UseCommands: useRegisteredCommands,
  UseCommandSurface: useCommandSurface,
  UseOccurrence: useOccurrence,
} as const
