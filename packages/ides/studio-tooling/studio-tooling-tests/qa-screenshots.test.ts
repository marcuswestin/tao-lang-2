import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { QaScreenshotsTesting } from '../studio-tooling-src/QaScreenshots'

const {
  appsWithOwnScenarios,
  changeSince,
  latestCaptures,
  parseSelector,
  selectorMatches,
  shotName,
  studioShotName,
  studioStates,
  timelineEntries,
  uniqueName,
} = QaScreenshotsTesting

type Scenario = Parameters<typeof shotName>[1]
type Run = Parameters<typeof latestCaptures>[0][number]
type Shot = Run['shots'][number]

const toast: Scenario = {
  entry: 'held',
  group: 'interaction',
  source: 'WordFlower.tao',
  subject: 'SavedToast',
  subjectKind: 'view',
}
const appDevices: Scenario = {
  entry: 'phone',
  group: 'devices',
  source: 'WordFlower.tao',
  subject: 'WordFlower',
  subjectKind: 'app',
}
const darkLibrary: Scenario = {
  entry: 'library',
  group: 'dark theme',
  source: 'screens/Library.tao',
  subject: 'WordFlowerDark',
  subjectKind: 'app',
}

function shot(name: string, overrides: Partial<Shot> = {}): Shot {
  return {
    app: 'WordFlower',
    appearance: 'light',
    device: 'phone',
    name,
    scenario: toast,
    sha256: 'a',
    status: 'captured',
    ...overrides,
  }
}

function run(runId: string, shots: readonly Shot[], renderer = 'Chrome/142'): Run {
  return {
    appearances: ['light'],
    apps: ['WordFlower'],
    createdAt: `${runId}.000Z`,
    devices: ['phone'],
    project: 'Apps/WordFlower/1 - Current',
    renderer: { product: renderer } as Run['renderer'],
    runId,
    shots,
    source: { branch: 'feat/x', commit: `${runId}-commit`, dirty: false, subject: `Change at ${runId}` },
    version: 2,
  }
}

Describe('QA screenshot names', () => {
  Test('name the app, the subject, the scenario, and the configuration, one field each', () => {
    Expect(shotName('WordFlower', toast, 'tablet', 'dark')).toBe(
      'WordFlower_SavedToast_interaction-held_tablet-dark.png',
    )
  })

  Test('leave the subject out when it is the app itself, which the app field already names', () => {
    Expect(shotName('WordFlower', appDevices, 'phone', 'light')).toBe('WordFlower_devices-phone_phone-light.png')
    Expect(shotName('WordFlowerDark', darkLibrary, 'laptop', 'dark'))
      .toBe('WordFlowerDark_dark-theme-library_laptop-dark.png')
  })

  Test('spell every field in ASCII letters and digits, keeping the base letter of an accent', () => {
    const named = { ...toast, entry: 'Résumé: draft #2', subject: 'Über View' }
    Expect(shotName('Wörd', named, 'phone', 'light')).toBe('Word_Uber-View_interaction-Resume-draft-2_phone-light.png')
  })

  Test('add the source file only when another file already took the same group and entry', () => {
    const taken = [shot('WordFlower_SavedToast_interaction-held_phone-light.png')]
    const other = { ...toast, source: 'more/Other Views.tao' }
    Expect(uniqueName('WordFlower_SavedToast_interaction-held_phone-light.png', other, []))
      .toBe('WordFlower_SavedToast_interaction-held_phone-light.png')
    Expect(uniqueName('WordFlower_SavedToast_interaction-held_phone-light.png', other, taken))
      .toBe('WordFlower_SavedToast_interaction-held_phone-light_Other-Views.png')
  })

  Test("name Studio's own shots by the app it opened and the state, one shot per state and appearance", () => {
    Expect(studioShotName('WordFlower', 'design', 'dark')).toBe('Studio_WordFlower_design_laptop-dark.png')
    const names = studioStates.flatMap(state =>
      (['light', 'dark'] as const).map(appearance => studioShotName('Pantry', state.key, appearance))
    )
    Expect(new Set(names).size).toBe(studioStates.length * 2)
  })
})

Describe('QA scenario selectors', () => {
  const scenarios = [toast, appDevices, darkLibrary]
  const picked = (text: string): string[] =>
    scenarios.filter(scenario => selectorMatches(parseSelector(text), scenario)).map(scenario =>
      `${scenario.subject}/${scenario.group}/${scenario.entry}`
    )

  Test('pick every scenario of a subject, or every entry of a group, by one name', () => {
    Expect(picked('SavedToast')).toEqual(['SavedToast/interaction/held'])
    Expect(picked('dark theme')).toEqual(['WordFlowerDark/dark theme/library'])
  })

  Test('pick one entry by group and entry, or a subject’s group by subject and group', () => {
    Expect(picked('interaction/held')).toEqual(['SavedToast/interaction/held'])
    Expect(picked('WordFlower/devices')).toEqual(['WordFlower/devices/phone'])
    Expect(picked('WordFlowerDark/dark theme/library')).toEqual(['WordFlowerDark/dark theme/library'])
  })

  Test('narrow by source file, named alone or by its project-relative path', () => {
    Expect(picked('Library.tao:dark theme')).toEqual(['WordFlowerDark/dark theme/library'])
    Expect(picked('screens/Library.tao:dark theme/library')).toEqual(['WordFlowerDark/dark theme/library'])
    Expect(picked('WordFlower.tao:dark theme')).toEqual([])
  })

  Test('match names exactly, so a group is never mistaken for a prefix of another', () => {
    Expect(picked('dark')).toEqual([])
    Expect(picked('interaction/hel')).toEqual([])
  })

  Test('refuse a selector with an empty or a fourth name, naming the accepted shape', () => {
    for (const text of ['', 'states//novel', 'a/b/c/d', 'WordFlower.tao:']) {
      Expect(() => parseSelector(text)).toThrow('[<file>.tao:]')
    }
  })
})

Describe('QA app launches', () => {
  const project = Repo.resolvePath('Apps/WordFlower/1 - Current')
  const apps = [
    { appName: 'WordFlowerDark', entryPath: 'WordFlower.tao' },
    { appName: 'WordFlowerNavHarness', entryPath: 'Harness.test.tao' },
  ]

  Test('launch another app only when a selected scenario runs it', async () => {
    Expect(await appsWithOwnScenarios(project, apps, [])).toEqual(['WordFlowerDark'])
    Expect(await appsWithOwnScenarios(project, apps, [parseSelector('interaction/held')])).toEqual([])
  })
})

Describe('QA change detection', () => {
  Test('compare each name with its latest successful capture, ignoring failures after it', () => {
    const latest = latestCaptures([
      run('2026-09-01T00-00-00Z', [shot('a.png', { sha256: 'one' }), shot('b.png', { sha256: 'b1' })]),
      run('2026-09-02T00-00-00Z', [shot('a.png', { sha256: 'two' })]),
      run('2026-09-03T00-00-00Z', [shot('a.png', { error: 'broke', sha256: 'three', status: 'failed' })]),
    ])
    Expect(changeSince(latest, 'a.png', 'two')).toBe('unchanged')
    Expect(changeSince(latest, 'a.png', 'three')).toBe('changed')
    Expect(changeSince(latest, 'b.png', 'b1')).toBe('unchanged')
    Expect(changeSince(latest, 'c.png', 'c1')).toBe('new')
  })
})

Describe('QA timeline', () => {
  Test('keep only the runs where a screen changed or failed, and flag a new renderer', () => {
    const [entry] = timelineEntries([
      run('2026-09-01T00-00-00Z', [shot('a.png', { sha256: 'one' })]),
      run('2026-09-02T00-00-00Z', [shot('a.png', { sha256: 'one' })]),
      run('2026-09-03T00-00-00Z', [shot('a.png', { error: 'Kept changing.', status: 'failed' })]),
      run('2026-09-04T00-00-00Z', [shot('a.png', { sha256: 'two' })], 'Chrome/143'),
    ])
    Expect(entry?.history.map(item => [item.runId, item.screenshot ?? item.error, item.rendererChanged])).toEqual([
      ['2026-09-01T00-00-00Z', 'runs/2026-09-01T00-00-00Z/screenshots/a.png', false],
      ['2026-09-03T00-00-00Z', 'Kept changing.', false],
      ['2026-09-04T00-00-00Z', 'runs/2026-09-04T00-00-00Z/screenshots/a.png', true],
    ])
  })

  Test('group each screen under the app that rendered it', () => {
    const entries = timelineEntries([
      run('2026-09-01T00-00-00Z', [shot('a.png'), shot('b.png', { app: 'WordFlowerDark' })]),
    ])
    Expect(entries.map(entry => [entry.name, entry.appName])).toEqual([
      ['a.png', 'WordFlower'],
      ['b.png', 'WordFlowerDark'],
    ])
  })
})
