import type {
  TaoNavKind,
  TaoNavKindProfile,
  TaoNavMount,
  TaoPresentable,
  TaoSelectionNavConfiguration,
  TaoSlotNavConfiguration,
  TaoStackNavConfiguration,
} from './TR-navigation'
import { createNavDeclaration } from './TR-navigation-configuration'
import { assertNavKind } from './TR-navigation-kinds'
import { RuntimePresentable } from './TR-navigation-presentables'
import RuntimeSwitch from './TR-switch'

/** testNavKind runs the published navigation protocol suite without depending on a test runner. */
export function testNavKind(
  kind: TaoNavKind<any, any>,
  profile: TaoNavKindProfile,
): void {
  assertNavKind(kind.profile === profile, `Expected the '${profile}' profile, received '${kind.profile}'.`)
  assertNavKind(kind.protocolVersion === 2, 'A navigation kind must implement protocol version 2.')
  assertNavKind(Object.isFrozen(kind.hostSlots), 'Host-slot metadata must be immutable.')
  assertNavKind(Object.isFrozen(kind.hostSlots.reads), 'Host-slot read metadata must be immutable.')
  assertNavKind(Object.isFrozen(kind.hostSlots.requires), 'Host-slot requirement metadata must be immutable.')
  const expectedReads = profile === 'stack' ? ['Title', 'Toolbar'] : []
  const expectedRequires = profile === 'stack' ? ['Title'] : []
  assertNavKind(
    JSON.stringify(kind.hostSlots.reads) === JSON.stringify(expectedReads),
    `${profile} must publish its exact host read-set.`,
  )
  assertNavKind(
    JSON.stringify(kind.hostSlots.requires) === JSON.stringify(expectedRequires),
    `${profile} must publish its exact required host slots.`,
  )

  const declaration = createNavDeclaration(`Conformance ${profile}`)
  const home = new RuntimePresentable({ name: 'Home', render: () => null })
  const detail = new RuntimePresentable({ name: 'Detail', render: () => null })
  const notice = new RuntimePresentable({ name: 'Notice', render: () => null })
  const descriptor = kind.configure(declaration, conformanceConfiguration(profile, home, detail))

  assertNavKind(Object.isFrozen(declaration), 'Declarations must be immutable.')
  assertNavKind(Object.isFrozen(descriptor), 'Configured descriptors must be immutable.')
  assertNavKind(Object.isFrozen(descriptor.config), 'Normalized descriptor configuration must be immutable.')
  assertNavKind(descriptor.declaration === declaration, 'A descriptor must retain declaration identity.')
  assertNavKind(descriptor.kind === kind, 'A descriptor must retain its implementation identity.')
  assertNavKind(descriptor.profile === profile, 'A descriptor must retain its navigation profile.')

  const first = kind.mount(descriptor)
  const second = kind.mount(descriptor)
  assertNavKind(first !== second, 'Each descriptor mount must create an independent occurrence.')
  assertNavKind(first.descriptor === descriptor, 'A mount must retain its immutable descriptor.')
  assertNavKind(second.descriptor === descriptor, 'Every mount must retain its immutable descriptor.')
  assertNavKind(!kind.canGoBack(first) && !kind.canGoBack(second), 'Fresh mounts must begin at their root.')

  const secondVersion = second.snapshot()
  kind.present(first, detail, {})
  assertNavKind(kind.canGoBack(first), 'Present must make the changed mount dismissible.')
  assertNavKind(!kind.canGoBack(second), 'Present must not mutate another mount of the descriptor.')
  assertNavKind(second.snapshot() === secondVersion, 'Mount notifications must remain occurrence-local.')
  assertNavKind(kind.back(first), 'Back must consume a presented occurrence.')
  assertNavKind(!kind.back(first), 'Back must be root-safe.')

  first.presentOverlay(notice, {})
  assertNavKind(kind.canGoBack(first), 'A nav-owned overlay must participate in back state.')
  assertNavKind(kind.dismiss(first), 'Dismiss must consume the top nav-owned overlay first.')
  assertNavKind(!kind.canGoBack(first), 'Dismissing the only overlay must restore root state.')

  testNavKindProfile(kind, profile, first, detail)
  kind.reset(first)
  assertNavKind(!kind.canGoBack(first), 'Reset must restore the configured root.')
  assertNavKind(!kind.canGoBack(second), 'Resetting one mount must not mutate another mount.')
}

function conformanceConfiguration(
  profile: TaoNavKindProfile,
  home: TaoPresentable,
  detail: TaoPresentable,
): TaoStackNavConfiguration | TaoSlotNavConfiguration | TaoSelectionNavConfiguration {
  if (profile === 'selection') {
    return {
      display: { evaluate: () => ({ jsValue: 'automatic' }) },
      initial: 'home',
      items: {
        home: { content: home, label: { evaluate: () => ({ jsValue: 'Home' }) } },
        settings: { content: detail, label: { evaluate: () => ({ jsValue: 'Settings' }) } },
      },
    }
  }
  return {
    initial: home,
  }
}

function testNavKindProfile(
  kind: TaoNavKind<any, any>,
  profile: TaoNavKindProfile,
  mount: TaoNavMount<any, any>,
  detail: TaoPresentable,
): void {
  RuntimeSwitch(profile, {
    stack: () => {
      kind.present(mount, detail, {})
      kind.present(mount, detail, {})
      assertNavKind(kind.dismiss(mount), 'Stack dismiss must pop the newest occurrence.')
      assertNavKind(kind.canGoBack(mount), 'Stack dismiss must preserve the covered occurrence.')
      assertNavKind(kind.back(mount), 'Stack back must pop the remaining presented occurrence.')
      assertNavKind(!kind.dismiss(mount), 'Stack dismiss must be root-safe.')
    },
    slot: () => {
      kind.present(mount, detail, {})
      kind.present(mount, detail, {})
      assertNavKind(kind.dismiss(mount), 'Slot dismiss must restore Initial after replacement.')
      assertNavKind(!kind.canGoBack(mount), 'Slot replacement must not accumulate history.')
      assertNavKind(!kind.dismiss(mount), 'Slot dismiss must be root-safe.')
    },
    selection: () => {
      assertNavKind(kind.activate(mount, 'settings'), 'Selection must activate a declared keyed child.')
      assertNavKind(!kind.canGoBack(mount), 'Selection activation must not create content history.')
      assertNavKind(!kind.activate(mount, 'missing'), 'Selection must reject an unknown keyed child.')
      kind.present(mount, detail, {})
      assertNavKind(kind.back(mount), 'Selection back must pop content from the active keyed child.')
      assertNavKind(!kind.canGoBack(mount), 'Selection back must restore the keyed child root.')
    },
  })
}
