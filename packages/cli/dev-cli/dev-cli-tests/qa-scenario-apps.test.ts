import { CLI, FS } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'
import { QaScenarioApps } from '../dev-cli-src/qa/QaScenarioApps'

const mainSource = `
use Main from ./Views
app Alpha { id "alpha" version "1.0.0" name "Alpha" view Main }
scenarios Alpha "devices" {
   device phone
   scenario "phone" {}
   scenario "dark" { appearance dark }
}
scenarios Main "view" {
   device phone
   scenario "view" { render Main() }
}
`

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkGitTestDir('qa-scenario-apps-')
  await initGitTestRepository(root, {
    commit: {
      files: {
        '.gitignore': 'Apps/Ignored/\n',
        ...files,
      },
    },
  })
  return root
}

Describe('QA scenario app discovery', () => {
  Test('includes unimported view scenarios for every app while keeping app scenarios scoped', async () => {
    for (const source of ['@/studio/View5.tao', 'Scenes/Card.tao']) {
      const root = await fixture({
        'Apps/Sketch/.tao/.gitignore': 'local/\n',
        'Apps/Sketch/First.tao':
          'app First { id "first" }\nscenarios First "devices" { device phone scenario "first" {} }',
        'Apps/Sketch/Second.tao':
          'app Second { id "second" }\nscenarios Second "devices" { device phone scenario "second" {} }',
        [`Apps/Sketch/${source}`]:
          'public view Card() { render inject ```ts return null ``` }\nscenarios Card "sketch" { device phone scenario "draft" { render Card() } }',
      })
      const result = await new QaScenarioApps(root).discover()
      Expect(result.failures).toEqual([])
      Expect(result.apps.map(app => app.app)).toEqual(['First', 'Second'])
      Expect(result.apps[0]?.cells).toHaveLength(2)
      Expect(result.apps[0]?.cells).toContainEqual({ source, group: 'sketch', label: 'draft' })
      Expect(result.apps[0]?.cells).toContainEqual({ source: 'First.tao', group: 'devices', label: 'first' })
      Expect(result.apps[1]?.cells).toHaveLength(2)
      Expect(result.apps[1]?.cells).toContainEqual({ source, group: 'sketch', label: 'draft' })
      Expect(result.apps[1]?.cells).toContainEqual({ source: 'Second.tao', group: 'devices', label: 'second' })
    }
  })

  Test('reports view-only scenario projects whose alias candidates do not declare apps', async () => {
    const root = await fixture({
      'Apps/Views/.tao/.gitignore': 'local/\n',
      'Apps/Views/Main.tao': `view Main() { render inject \`\`\`ts return null \`\`\` }
let Label = "views"
scenarios Main "views" { device phone scenario "phone" { render Main() } }`,
    })
    const result = await new QaScenarioApps(root).discover()
    Expect(result.apps).toEqual([])
    Expect(result.failures).toEqual([{
      source: 'Apps/Views/Main.tao',
      error: 'Scenario project contains no app declarations.',
    }])
  })

  Test('discovers a scenario sidecar that imports its app, without an app-to-sidecar import', async () => {
    const root = await fixture({
      'Apps/Sidecar/.tao/.gitignore': 'local/\n',
      'Apps/Sidecar/App.tao': 'app Sidecar { id "sidecar" }',
      'Apps/Sidecar/Scenarios.tao':
        'use Sidecar from ./\nscenarios Sidecar "devices" { device phone scenario "phone" {} }',
    })
    const result = await new QaScenarioApps(root).discover()
    Expect(result.failures).toEqual([])
    Expect(result.apps).toEqual([{
      id: 'visual:Apps/Sidecar/Sidecar',
      project: 'Apps/Sidecar',
      app: 'Sidecar',
      entry: 'App.tao',
      cells: [{ source: 'Scenarios.tao', group: 'devices', label: 'phone' }],
    }])
  })

  Test('discovers app and view scenarios across project files with stable cell ordering', async () => {
    const root = await fixture({
      'Apps/One/.tao/project.jsonc': '{}\n',
      'Apps/One/Main.tao': mainSource,
      'Apps/One/Views.tao': 'public view Main() { render inject ```ts return null ``` }\n',
    })

    const result = await new QaScenarioApps(root).discover()

    Expect(result.failures).toEqual([])
    Expect(result.apps).toEqual([{
      id: 'visual:Apps/One/Alpha',
      project: 'Apps/One',
      entry: 'Main.tao',
      app: 'Alpha',
      cells: [
        { source: 'Main.tao', group: 'devices', label: 'dark' },
        { source: 'Main.tao', group: 'devices', label: 'phone' },
        { source: 'Main.tao', group: 'view', label: 'view' },
      ],
    }])
  })

  Test('automatically includes new apps and scenarios and keeps same-name apps project-qualified', async () => {
    const root = await fixture({
      'Apps/One/.tao/project.jsonc': '{}\n',
      'Apps/One/Main.tao': mainSource,
      'Apps/One/Views.tao': 'public view Main() { render inject ```ts return null ``` }\n',
      'Apps/Two/.tao/project.jsonc': '{}\n',
      'Apps/Two/Main.tao': mainSource,
      'Apps/Two/Views.tao': 'public view Main() { render inject ```ts return null ``` }\n',
    })
    await FS.writeText(
      FS.resolvePath('Apps/One/More.tao', root),
      `
use Alpha from ./Main
app Beta = Alpha with { id "beta", name "Beta" }
scenarios Beta "devices" {
   device phone
   scenario "beta" {}
}
`,
    )
    await CLI.mustRun('git', { args: ['add', 'Apps/One/More.tao'], cwd: root })

    const result = await new QaScenarioApps(root).discover()

    Expect(result.failures).toEqual([])
    Expect(result.apps.map(app => app.id)).toEqual([
      'visual:Apps/One/Alpha',
      'visual:Apps/One/Beta',
      'visual:Apps/Two/Alpha',
    ])
    Expect(result.apps.find(app => app.id === 'visual:Apps/One/Beta')?.cells).toEqual([
      { source: 'Main.tao', group: 'view', label: 'view' },
      { source: 'More.tao', group: 'devices', label: 'beta' },
    ])
  })

  Test('ignores test, future-syntax, ignored, generated, vendor, platform, and secret paths', async () => {
    const root = await fixture({
      'Apps/One/.tao/project.jsonc': '{}\n',
      'Apps/One/Main.tao': mainSource,
      'Apps/One/Views.tao': 'public view Main() { render inject ```ts return null ``` }\n',
      'Apps/One/Main.test.tao': mainSource,
      'Apps/One/Future.tao-revolution': mainSource,
      'Apps/One/_gen_preview/Generated.tao': mainSource,
      'Apps/One/vendor/Vendor.tao': mainSource,
      'Apps/One/ios/Platform.tao': mainSource,
      'Apps/One/secrets.tao': mainSource,
      'Apps/Tao Future/Future.tao': mainSource,
    })
    await FS.writeText(FS.resolvePath('Apps/Ignored/Main.tao', root), mainSource)
    await FS.symlink('Main.tao', FS.resolvePath('Apps/One/Alias.tao', root))
    await CLI.mustRun('git', { args: ['add', 'Apps/One/Alias.tao'], cwd: root })

    const result = await new QaScenarioApps(root).discover()

    Expect(result.apps.map(app => app.id)).toEqual(['visual:Apps/One/Alpha'])
    Expect(result.failures).toEqual([])
  })

  Test('reports symbolic links that do not lead to another authored source instead of dropping them', async () => {
    const root = await fixture({
      'Apps/One/.tao/project.jsonc': '{}\n',
      'Apps/One/Main.tao': mainSource,
      'Apps/One/Views.tao': 'public view Main() { render inject ```ts return null ``` }\n',
      'Docs/Plain.tao': mainSource,
      'Elsewhere/Main.tao': mainSource,
    })
    await FS.symlink('Main.tao', FS.resolvePath('Apps/One/Alias.tao', root))
    await FS.symlink('../../Docs/Plain.tao', FS.resolvePath('Apps/One/Unauthored.tao', root))
    await FS.symlink('Missing.tao', FS.resolvePath('Apps/One/Dangling.tao', root))
    await FS.symlink('../../Elsewhere/Main.tao', FS.resolvePath('Apps/One/Outside.tao', root))
    await CLI.mustRun('git', {
      args: ['add', 'Apps/One/Alias.tao', 'Apps/One/Unauthored.tao', 'Apps/One/Dangling.tao', 'Apps/One/Outside.tao'],
      cwd: root,
    })

    const result = await new QaScenarioApps(root).discover()

    // Dangling links also stop the project's own parse, so only the link reports are asserted here.
    const links = result.failures.filter(failure => failure.error.includes('symbolic link'))
    Expect(links.map(failure => failure.source)).toEqual([
      'Apps/One/Dangling.tao',
      'Apps/One/Outside.tao',
      'Apps/One/Unauthored.tao',
    ])
  })

  Test(
    'lists an app that its scenario-bearing project gives no cells as uncovered instead of dropping it',
    async () => {
      const root = await fixture({
        'Apps/Two/.tao/project.jsonc': '{}\n',
        'Apps/Two/Main.tao': 'app Alpha { id "alpha" }\nscenarios Alpha "devices" { device phone scenario "phone" {} }',
        'Apps/Two/Other.tao': 'app Beta { id "beta" }',
      })

      const result = await new QaScenarioApps(root).discover()

      Expect(result.apps.map(app => app.id)).toEqual(['visual:Apps/Two/Alpha'])
      Expect(result.failures).toEqual([])
      Expect(result.uncovered).toEqual([{ source: 'Apps/Two/Other.tao', app: 'Beta' }])
    },
  )

  Test('reports malformed scenario syntax and missing tracked Tao sources', async () => {
    const root = await fixture({
      'Apps/One/.tao/project.jsonc': '{}\n',
      'Apps/One/Main.tao': `${mainSource}\nscenarios Alpha "broken" { scenario "unfinished" {`,
      'Apps/One/Views.tao': 'public view Main() { render inject ```ts return null ``` }\n',
      'Apps/One/Removed.tao': 'app Removed { id "removed" }',
    })
    await FS.remove(FS.resolvePath('Apps/One/Removed.tao', root))

    const result = await new QaScenarioApps(root).discover()

    Expect(result.apps).toEqual([])
    Expect(result.failures.map(failure => failure.source)).toContain('Apps/One/Main.tao')
    Expect(result.failures).toContainEqual({
      source: 'Apps/One/Removed.tao',
      error: 'Authored Tao source is missing.',
    })
  })

  Test('reports scenario sources that have no Tao project marker', async () => {
    const root = await fixture({
      'Apps/Unmarked/Main.tao': mainSource,
    })

    const result = await new QaScenarioApps(root).discover()

    Expect(result.apps).toEqual([])
    Expect(result.failures).toContainEqual({
      source: 'Apps/Unmarked/Main.tao',
      error: 'Scenario source has no containing Tao project marker.',
    })
  })
})
