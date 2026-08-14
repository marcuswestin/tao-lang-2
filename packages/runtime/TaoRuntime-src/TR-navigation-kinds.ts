import type React from 'react'
import type {
  TaoNavDeclaration,
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavKind,
  TaoNavKindProfile,
  TaoNavMount,
  TaoPresentable,
  TaoSelectionNavConfiguration,
  TaoSlotNavConfiguration,
  TaoStackNavConfiguration,
} from './TR-navigation'
import { createNavDeclaration, freezeNavConfiguration } from './TR-navigation-configuration'
import { RuntimeSelectionNav, RuntimeSlotNav, RuntimeStackNav } from './TR-navigation-mounts'
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
    private readonly createMount: NavMountFactory<ProfileT, ConfigurationT>,
  ) {}

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

const stackNavKind = Object.freeze(
  new RuntimeNavKind<'stack', TaoStackNavConfiguration>(
    'stack',
    descriptor => new RuntimeStackNav(descriptor),
  ),
)
const slotNavKind = Object.freeze(
  new RuntimeNavKind<'slot', TaoSlotNavConfiguration>(
    'slot',
    descriptor => new RuntimeSlotNav(descriptor),
  ),
)
const selectionNavKind = Object.freeze(
  new RuntimeNavKind<'selection', TaoSelectionNavConfiguration>(
    'selection',
    descriptor => new RuntimeSelectionNav(descriptor),
  ),
)

/** NavKindControls publishes the built-in implementations used by Tao `implement inject`. */
export const NavKindControls = {
  Declaration: createNavDeclaration,
  Selection: (): TaoNavKind<'selection', TaoSelectionNavConfiguration> => selectionNavKind,
  Slot: (): TaoNavKind<'slot', TaoSlotNavConfiguration> => slotNavKind,
  Stack: (): TaoNavKind<'stack', TaoStackNavConfiguration> => stackNavKind,
} as const

export function assertNavKind(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`NavKind conformance failed: ${message}`)
  }
}
