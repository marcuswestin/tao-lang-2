import type { TaoNavigationArguments, TaoPresentable } from './TR-navigation'
import type { PresentableEntry } from './TR-navigation-state'

export type TaoPersistedValue = ReadonlyArray<unknown>

export type TaoPresentableSnapshot = Readonly<{
  arguments: Readonly<Record<string, TaoPersistedValue>>
  sheet?: true
  view: string
}>

export type TaoNavigationContentSnapshot =
  | Readonly<{ entries: readonly TaoPresentableSnapshot[]; kind: 'stack' }>
  | Readonly<{
    initialNavigation?: TaoNavigationSnapshot
    kind: 'slot'
    presented?: TaoPresentableSnapshot
  }>
  | Readonly<{
    activeKey: string
    items: Readonly<
      Record<
        string,
        Readonly<{
          entries: readonly TaoPresentableSnapshot[]
          navigation?: TaoNavigationSnapshot
        }>
      >
    >
    kind: 'selection'
  }>
  | Readonly<{
    items: Readonly<Record<string, Readonly<{ navigation?: TaoNavigationSnapshot }>>>
    kind: 'split'
  }>

export type TaoNavigationSnapshot = Readonly<{
  content: TaoNavigationContentSnapshot
  descriptor: string
  /**
   * hosted is the state of every navigator a view rendered inside this occurrence's content, keyed
   * by that navigator's own canonical descriptor. A rendered nav restores by its own identity, not
   * by a position in its host's content, because the host's content is a view rather than a slot.
   */
  hosted?: Readonly<Record<string, TaoNavigationSnapshot>>
  kind: string
  overlays: readonly TaoPresentableSnapshot[]
}>

export type TaoNavigationRestorationCodec = {
  exclusions: ReadonlySet<string>
  restorePresentable(snapshot: TaoPresentableSnapshot): {
    arguments: TaoNavigationArguments
    presentable: TaoPresentable
  }
  snapshotPresentable(entry: PresentableEntry): TaoPresentableSnapshot | undefined
}
