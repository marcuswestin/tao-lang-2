import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'

/** Compiler-authored scenario structure whose change invalidates retained preview interaction state. */
export function previewCompatibilitySignature(manifest: StudioPreviewManifestV2): string {
  return JSON.stringify({
    cells: manifest.cells.map(cell => ({
      args: cell.args,
      cellId: cell.cellId,
      scenarioId: cell.scenarioId,
      stateLayers: cell.stateLayers,
    })).toSorted((left, right) => left.cellId.localeCompare(right.cellId)),
    fixtures: manifest.fixtures.map(fixture => ({
      fixtureId: fixture.fixtureId,
      plan: fixture.plan,
    })).toSorted((left, right) => left.fixtureId.localeCompare(right.fixtureId)),
    parametersBySubject: manifest.parametersBySubject,
    scenarios: manifest.scenarios.map(scenario => ({
      args: scenario.args,
      fixtureId: scenario.fixtureId,
      prepare: scenario.prepare,
      scenarioId: scenario.scenarioId,
      stateLayers: scenario.stateLayers,
      steps: scenario.steps,
      subjectId: scenario.subjectId,
    })).toSorted((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
    states: manifest.states,
    subjects: manifest.subjects.map(subject => ({
      name: subject.kind === 'app' ? subject.appName : subject.viewName,
      kind: subject.kind,
      subjectId: subject.subjectId,
    })).toSorted((left, right) => left.subjectId.localeCompare(right.subjectId)),
  })
}
