import React from 'react'
import { RuntimeCommand } from './TR-interaction'
import type { TaoCommandSnapshot } from './TR-interaction'
import type { Evaluable } from './TR-navigation-presentables'
import type { Subscription } from './TR-navigation-state'

/** TaoNavigationCommand is one command as the chrome around a presented scene reads it. */
export type TaoNavigationCommand = TaoCommandSnapshot

/** TaoHostSlotSnapshot is the normalized chrome state read by a navigation host. */
export type TaoHostSlotSnapshot = Readonly<{
  /** header is false when a scene fills `Header false` to own its whole surface. */
  header: boolean
  title?: string
  toolbar: readonly TaoNavigationCommand[]
}>

export type TaoHostSlotValue = Evaluable | undefined | readonly RuntimeCommand[]
export type TaoHostSlotValues = Readonly<Record<string, (() => TaoHostSlotValue) | undefined>>
export type TaoNavHostSlotConfiguration = Readonly<
  Record<string, Evaluable | readonly RuntimeCommand[]>
>

/** RuntimeHostReadChannel belongs to one presented occurrence, never to its render descendants. */
export class RuntimeHostReadChannel implements Subscription {
  private invocations = new Map<string, { current(): unknown; invoke(): unknown }>()
  private listeners = new Set<() => void>()
  private revision = 0
  private current: TaoHostSlotSnapshot = emptyHostSlotSnapshot

  readonly snapshot = (): number => this.revision

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  read(): TaoHostSlotSnapshot {
    return this.current
  }

  publish(next: TaoHostSlotSnapshot): void {
    const activeKeys = new Set<string>()
    const toolbar = next.toolbar.map(command => {
      activeKeys.add(command.identity)
      let invocation = this.invocations.get(command.identity)
      if (!invocation) {
        invocation = {
          current: command.invoke,
          invoke() {
            return this.current()
          },
        }
        this.invocations.set(command.identity, invocation)
      } else {
        invocation.current = command.invoke
      }
      return Object.freeze({ ...command, invoke: invocation.invoke.bind(invocation) })
    })
    for (const key of this.invocations.keys()) {
      if (!activeKeys.has(key)) {
        this.invocations.delete(key)
      }
    }
    const normalized = Object.freeze({
      header: next.header,
      ...(next.title === undefined ? {} : { title: next.title }),
      toolbar: Object.freeze(toolbar),
    })
    const changed = !sameSnapshot(this.current, normalized)
    // Stable invocation cells refresh occurrence closures without rerendering visually equal chrome.
    if (changed) {
      this.current = normalized
    }
    if (!changed) {
      return
    }
    this.revision += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const emptyHostSlotSnapshot: TaoHostSlotSnapshot = Object.freeze({
  header: true,
  toolbar: Object.freeze([]),
})

/** useHostSlotSnapshot subscribes one host surface to one direct occurrence channel. */
export function useHostSlotSnapshot(channel: RuntimeHostReadChannel): TaoHostSlotSnapshot {
  React.useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot)
  return channel.read()
}

/** useHostSlots publishes direct view fills after the presented view commits. */
export function useHostSlots(channel: RuntimeHostReadChannel | undefined, values: TaoHostSlotValues): void {
  const titleValue = values['Title']?.()
  const toolbarValue = values['Toolbar']?.()
  const headerValue = values['Header']?.()
  const title = textValue(isEvaluable(titleValue) ? titleValue : undefined)
  const toolbar = Array.isArray(toolbarValue) ? toolbarValue.map(command => command.read()) : []
  const header = booleanValue(isEvaluable(headerValue) ? headerValue : undefined, true)
  React.useLayoutEffect(() => {
    if (!channel) {
      return
    }
    channel.publish(Object.freeze({
      header,
      ...(title === undefined ? {} : { title }),
      toolbar: Object.freeze(toolbar),
    }))
  })
}

function isEvaluable(value: TaoHostSlotValue): value is Evaluable {
  return value !== undefined
    && !Array.isArray(value)
    && typeof (value as Evaluable).evaluate === 'function'
}

function textValue(value: Evaluable | undefined): string | undefined {
  const jsValue = value?.evaluate().jsValue
  return typeof jsValue === 'string' && jsValue.length > 0 ? jsValue : undefined
}

function booleanValue(value: Evaluable | undefined, fallback: boolean): boolean {
  const jsValue = value?.evaluate().jsValue
  return typeof jsValue === 'boolean' ? jsValue : fallback
}

function snapshotFingerprint(
  header: boolean,
  title: string | undefined,
  toolbar: readonly TaoNavigationCommand[],
): string {
  return JSON.stringify([
    header,
    title ?? null,
    toolbar.map(command => [
      command.identity,
      command.key,
      command.label,
      command.icon ?? null,
      command.enabled,
    ]),
  ])
}

function sameSnapshot(left: TaoHostSlotSnapshot, right: TaoHostSlotSnapshot): boolean {
  return snapshotFingerprint(left.header, left.title, left.toolbar)
    === snapshotFingerprint(right.header, right.title, right.toolbar)
}
