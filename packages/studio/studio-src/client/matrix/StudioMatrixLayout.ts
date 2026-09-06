import type { StudioPreviewCell, StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import { StudioScenarioControls } from '../StudioScenarioControls'

type StudioMatrixCell<Item> = {
  id: string
  item: Item
}

export type StudioMatrixGroup<Item> = {
  cells: readonly StudioMatrixCell<Item>[]
  id: string
  label: string
  sketchSourceVersion?: string
  sketchView?: string
  /** The one view every scenario in the group focuses, when the group is a focused-view group. */
  subjectView?: string
}

export type StudioMatrixGroupLayout = {
  cellIds: readonly string[]
  id: string
  label: string
}

/** Pure grouping of manifest cells into scenario-group rows; the DOM host lives in StudioMatrixGrid. */
export const StudioMatrixLayout = {
  groups(manifest: Pick<StudioPreviewManifestV2, 'cells' | 'scenarios'>): readonly StudioMatrixGroupLayout[] {
    const cellsByScenario = new Map<string, StudioPreviewCell[]>()
    for (const cell of manifest.cells) {
      const cells = cellsByScenario.get(cell.scenarioId) ?? []
      cells.push(cell)
      cellsByScenario.set(cell.scenarioId, cells)
    }
    const groups = new Map<string, { cellIds: string[]; id: string; label: string }>()
    for (const scenario of manifest.scenarios) {
      const id = StudioScenarioControls.groupId(scenario.source.path, scenario.group)
      const group = groups.get(id) ?? { cellIds: [], id, label: scenario.group }
      group.cellIds.push(...(cellsByScenario.get(scenario.scenarioId) ?? []).map(cell => cell.cellId))
      groups.set(id, group)
    }
    return [...groups.values()]
  },
  /** subjectView names the view a scenario group focuses when every entry renders that same view. */
  subjectView(
    manifest: Pick<StudioPreviewManifestV2, 'scenarios' | 'subjects'>,
    groupId: string,
  ): string | undefined {
    const subjects = new Map(manifest.subjects.map(subject => [subject.subjectId, subject]))
    const viewNames = new Set(
      manifest.scenarios
        .filter(scenario => StudioScenarioControls.groupId(scenario.source.path, scenario.group) === groupId)
        .map(scenario => {
          const subject = subjects.get(scenario.subjectId)
          return subject?.kind === 'view' ? subject.viewName : undefined
        }),
    )
    return viewNames.size === 1 ? [...viewNames][0] : undefined
  },
  /** focusable says whether canvas mode can focus a view: some group renders that view alone. */
  focusable(groups: readonly Pick<StudioMatrixGroup<unknown>, 'subjectView'>[], viewName: string): boolean {
    return groups.some(group => group.subjectView === viewName)
  },
  reconcile(previous: readonly string[], next: readonly string[]): {
    added: readonly string[]
    removed: readonly string[]
    retained: readonly string[]
  } {
    const before = new Set(previous)
    const after = new Set(next)
    return {
      added: next.filter(id => !before.has(id)),
      removed: previous.filter(id => !after.has(id)),
      retained: next.filter(id => before.has(id)),
    }
  },
} as const

/**
 * previewMatrixPlan decides what the preview area should hold. An app that declares no scenarios has no cells,
 * and must keep showing the whole running app rather than an empty matrix.
 */
export function previewMatrixPlan(
  cellCount: number,
  hasWholeAppPreview: boolean,
): 'cells' | 'create-whole-app' | 'keep-whole-app' {
  if (cellCount > 0) {
    return 'cells'
  }
  return hasWholeAppPreview ? 'keep-whole-app' : 'create-whole-app'
}
