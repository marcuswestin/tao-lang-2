import React from 'react'
import { createElement } from './TR-create-element'
import { InteractionControls } from './TR-interaction-catalog'
import { type TaoOutlineLiveEntry, useOutlineNode } from './TR-interaction-outline'
import { directToolbarCapacity } from './TR-navigation-basic-stack'
import type { TaoNavigationCommand } from './TR-navigation-host-slots'

type CommandBinding = {
  command: TaoNavigationCommand
  invoke(): unknown
}

type NativeCommandDescriptor = {
  disabled: boolean
  icon?: { type: 'sfSymbol'; name: string }
  onPress(): void
  title: string
}

type NativeMenuAction = NativeCommandDescriptor & { discoverabilityLabel: string; type: 'action' }
type NativeHeaderItem =
  | (NativeCommandDescriptor & { accessibilityLabel: string; identifier: string; type: 'button' })
  | {
    accessibilityLabel: string
    icon: { type: 'sfSymbol'; name: string }
    identifier: string
    menu: { items: NativeMenuAction[] }
    title: string
    type: 'menu'
  }

/** Native descriptors and outline actions share one live binding per command occurrence. */
export function useNativeHeaderToolbar(commands: readonly TaoNavigationCommand[]): {
  items: NativeHeaderItem[]
  outline: React.ReactNode
} {
  const bindings = React.useRef(new Map<string, CommandBinding>()).current
  for (const [identity, binding] of bindings) {
    if (!commands.some(command => command.identity === identity)) {
      binding.invoke = () => undefined
      bindings.delete(identity)
    }
  }
  const active = commands.map(command => {
    let binding = bindings.get(command.identity)
    if (!binding) {
      binding = { command, invoke: () => undefined }
      bindings.set(command.identity, binding)
    }
    binding.command = command
    return binding
  })
  const descriptor = (binding: CommandBinding) => ({
    disabled: !binding.command.enabled,
    icon: binding.command.icon ? { type: 'sfSymbol' as const, name: binding.command.icon } : undefined,
    onPress: () => binding.command.enabled ? binding.invoke() : undefined,
    title: binding.command.label,
  })
  const items: NativeHeaderItem[] = active.slice(0, directToolbarCapacity).map(binding => ({
    ...descriptor(binding),
    accessibilityLabel: binding.command.label,
    identifier: binding.command.identity,
    type: 'button',
  }))
  const overflow: NativeMenuAction[] = active.slice(directToolbarCapacity).map(binding => ({
    ...descriptor(binding),
    discoverabilityLabel: binding.command.label,
    type: 'action',
  }))
  if (overflow.length > 0) {
    items.push({
      accessibilityLabel: 'More',
      icon: { name: 'ellipsis', type: 'sfSymbol' },
      identifier: 'navigation:toolbar:more',
      menu: { items: overflow },
      title: 'More',
      type: 'menu',
    })
  }
  return {
    items,
    outline: active.map(binding => createElement(NativeCommandOutline, { binding, key: binding.command.identity })),
  }
}

function NativeCommandOutline({ binding }: { binding: CommandBinding }): null {
  const capabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const identity = useOutlineNode({
    identity: `navigation-command:${binding.command.identity}`,
    kind: 'action',
    label: () => binding.command.label,
    live: capabilities,
    provenance: { command: binding.command.identity },
  })
  capabilities.enabled = () => binding.command.enabled
  const invoke = InteractionControls.Activate(
    identity === undefined ? undefined : { capabilities, control: identity, scope: identity },
    () => binding.command.enabled ? binding.command.invoke() : undefined,
  )
  binding.invoke = invoke
  React.useEffect(() => {
    binding.invoke = invoke
    return () => {
      binding.invoke = () => undefined
    }
  }, [binding, invoke])
  return null
}
