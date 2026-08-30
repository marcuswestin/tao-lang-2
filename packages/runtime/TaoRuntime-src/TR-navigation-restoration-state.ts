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

export type TaoNavigationSnapshot = Readonly<{
  content: TaoNavigationContentSnapshot
  descriptor: string
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
