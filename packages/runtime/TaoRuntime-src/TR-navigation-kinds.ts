import type React from 'react'
import { RuntimeAssert } from './TR-assert'
import type {
  TaoNavDeclaration,
  TaoNavDescriptor,
  TaoNavHostSlotContract,
  TaoNavigationArguments,
  TaoNavKind,
  TaoNavKindProfile,
  TaoNavMount,
  TaoPresentable,
  TaoSelectionNavConfiguration,
  TaoSlotNavConfiguration,
  TaoSplitNavConfiguration,
  TaoStackNavConfiguration,
} from './TR-navigation'
import { createNavDeclaration, freezeNavConfiguration } from './TR-navigation-configuration'
import {
  RuntimeSelectionNav,
  RuntimeSlotNav,
  RuntimeSplitNav,
  RuntimeStackNav,
} from './TR-navigation-mounts'
import type { TaoProps } from './TR-TaoProps'

type NavMountFactory<ProfileT extends TaoNavKindProfile, ConfigurationT extends object> = (
  descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>,
) => TaoNavMount<ProfileT, ConfigurationT>

/** RuntimeNavKind implements the public protocol while profile mounts own all mutable state. */
class RuntimeNavKind<ProfileT extends TaoNavKindProfile, ConfigurationT extends object>
  implements TaoNavKind<ProfileT, ConfigurationT>
{
  constructor(
    readonly profile: ProfileT,
    readonly hostSlots: TaoNavHostSlotContract,
    private readonly createMount: NavMountFactory<ProfileT, ConfigurationT>,
  ) {}

  readonly protocolVersion = 2 as const

  configure(
    declaration: TaoNavDeclaration,
    config: ConfigurationT,
  ): TaoNavDescriptor<ProfileT, ConfigurationT> {
    const descriptor: TaoNavDescriptor<ProfileT, ConfigurationT> = {
      config: freezeNavConfiguration(config),
      declaration,
      kind: this,
      profile: this.profile,
    }
    return Object.freeze(descriptor)
  }

  mount(descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>): TaoNavMount<ProfileT, ConfigurationT> {
    this.assertDescriptor(descriptor)
    return this.createMount(descriptor)
  }

  render(
    mount: TaoNavMount<ProfileT, ConfigurationT>,
    taoProps?: TaoProps,
  ): React.ReactNode {
    this.assertMount(mount)
    return mount.render(taoProps)
  }

  present(
    mount: TaoNavMount<ProfileT, ConfigurationT>,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    this.assertMount(mount)
    mount.present(presentable, arguments_)
  }

  dismiss(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean {
    this.assertMount(mount)
    return mount.dismiss()
  }

  back(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean {
    this.assertMount(mount)
    return mount.back()
  }

  reset(mount: TaoNavMount<ProfileT, ConfigurationT>): void {
    this.assertMount(mount)
    mount.reset()
  }

  canGoBack(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean {
    this.assertMount(mount)
    return mount.canGoBack
  }

  activate(mount: TaoNavMount<ProfileT, ConfigurationT>, key: string): boolean {
    this.assertMount(mount)
    return mount.activate(key)
  }

  private assertDescriptor(descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>): void {
    assertNavKind(
      descriptor.kind === this && descriptor.profile === this.profile,
      `Cannot mount a ${descriptor.profile} descriptor with the ${this.profile} implementation.`,
    )
  }

  private assertMount(mount: TaoNavMount<ProfileT, ConfigurationT>): void {
    this.assertDescriptor(mount.descriptor)
  }
}

const stackHostSlots = Object.freeze({
  reads: Object.freeze(['Header', 'Title', 'Toolbar'] as const),
  requires: Object.freeze(['Title'] as const),
})
const noHostSlots = Object.freeze({
  reads: Object.freeze([]),
  requires: Object.freeze([]),
})

const nativeStackNavKind = Object.freeze(
  new RuntimeNavKind<'stack', TaoStackNavConfiguration>(
    'stack',
    stackHostSlots,
    descriptor => new RuntimeStackNav(descriptor, 'native'),
  ),
)
const basicStackNavKind = Object.freeze(
  new RuntimeNavKind<'stack', TaoStackNavConfiguration>(
    'stack',
    stackHostSlots,
    descriptor => new RuntimeStackNav(descriptor, 'basic'),
  ),
)
const nativeSlotNavKind = Object.freeze(
  new RuntimeNavKind<'slot', TaoSlotNavConfiguration>(
    'slot',
    noHostSlots,
    descriptor => new RuntimeSlotNav(descriptor),
  ),
)
const basicSlotNavKind = Object.freeze(
  new RuntimeNavKind<'slot', TaoSlotNavConfiguration>(
    'slot',
    noHostSlots,
    descriptor => new RuntimeSlotNav(descriptor),
  ),
)
const nativeSelectionNavKind = Object.freeze(
  new RuntimeNavKind<'selection', TaoSelectionNavConfiguration>(
    'selection',
    noHostSlots,
    descriptor => new RuntimeSelectionNav(descriptor, true),
  ),
)
const basicSelectionNavKind = Object.freeze(
  new RuntimeNavKind<'selection', TaoSelectionNavConfiguration>(
    'selection',
    noHostSlots,
    descriptor => new RuntimeSelectionNav(descriptor, false),
  ),
)
const splitNavKind = Object.freeze(
  new RuntimeNavKind<'split', TaoSplitNavConfiguration>(
    'split',
    noHostSlots,
    descriptor => new RuntimeSplitNav(descriptor),
  ),
)
/** NavKindControls publishes the built-in implementations used by Tao `implement inject`. */
export const NavKindControls = {
  Declaration: createNavDeclaration,
  Selection: (): TaoNavKind<'selection', TaoSelectionNavConfiguration> => nativeSelectionNavKind,
  Slot: (): TaoNavKind<'slot', TaoSlotNavConfiguration> => nativeSlotNavKind,
  Split: (): TaoNavKind<'split', TaoSplitNavConfiguration> => splitNavKind,
  Stack: (): TaoNavKind<'stack', TaoStackNavConfiguration> => nativeStackNavKind,
  Basic: Object.freeze({
    Selection: (): TaoNavKind<'selection', TaoSelectionNavConfiguration> => basicSelectionNavKind,
    Slot: (): TaoNavKind<'slot', TaoSlotNavConfiguration> => basicSlotNavKind,
    Split: (): TaoNavKind<'split', TaoSplitNavConfiguration> => splitNavKind,
    Stack: (): TaoNavKind<'stack', TaoStackNavConfiguration> => basicStackNavKind,
  }),
} as const

/** assertNavKind names the nav-kind-contract category on top of the shared guard API. */
export function assertNavKind(condition: unknown, message: string): asserts condition {
  RuntimeAssert.input(condition, `NavKind conformance failed: ${message}`)
}
