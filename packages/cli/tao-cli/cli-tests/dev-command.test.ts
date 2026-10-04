import { FS, HCI, Text } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { PassThrough } from 'node:stream'
import { discoverTaoDevProjects, type TaoDevProject } from '../cli-src/dev-app-discovery'
import {
  choiceIndexForKey,
  choiceKeySummary,
  keyForChoiceIndex,
  selectTaoDevApp,
} from '../cli-src/dev-app-selection'
import { runTaoDev } from '../cli-src/dev-command'

const viewSource = 'view MainView() { render inject ```ts return null ``` }'

Describe('Tao run app discovery and selection', () => {
  Test('discovers every runnable app recursively and groups it by project', async () => {
    const root = await mkTestDir('tao-dev-discovery-', { location: 'host' })
    try {
      await FS.writeText(FS.resolvePath('WordFlower/Current/.tao/.gitkeep', root), '')
      await FS.writeText(FS.resolvePath('Test Apps/Data MVP/.tao/.gitkeep', root), '')
      await FS.writeText(
        FS.resolvePath('WordFlower/Current/WordFlower.tao', root),
        `app WordFlower { id "wordflower" version "1.0.0" name "WordFlower" view MainView }
         app WordFlowerDemo { id "wordflower-demo" version "1.0.0" name "WordFlower Demo" view MainView }
         ${viewSource}`,
      )
      await FS.writeText(
        FS.resolvePath('Test Apps/Data MVP/Data MVP.tao', root),
        `app DataMVP { id "data-mvp" version "1.0.0" name "Data MVP" view MainView }
         ${viewSource}`,
      )
      await FS.writeText(
        FS.resolvePath('Test Apps/Data MVP/Data MVP.test.tao', root),
        `app TestOnly { id "test-only" version "1.0.0" name "Test Only" view MainView }
         test "ignored" { }
         ${viewSource}`,
      )

      const projects = await discoverTaoDevProjects(root)

      Expect(projects.map(project => project.name)).toEqual(['Current', 'Data MVP'])
      Expect(projects[0]?.apps.map(app => app.appName)).toEqual(['WordFlower', 'WordFlowerDemo'])
      Expect(projects[1]?.apps.map(app => app.appName)).toEqual(['DataMVP'])
      Expect(projects[0]?.root).toBe(await FS.realPath(FS.resolvePath('WordFlower/Current', root)))
    } finally {
      await FS.remove(root)
    }
  })

  Test('groups nested and module app declarations under the nearest marker', async () => {
    const root = await mkTestDir('tao-dev-split-project-', { location: 'host' })
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      await FS.writeText(
        FS.resolvePath('features/Reader.tao', root),
        `app Reader { id "reader" version "1.0.0" name "Reader" view MainView } ${viewSource}`,
      )
      await FS.writeText(
        FS.resolvePath('packages/@preview/App.tao', root),
        `public app Preview { id "preview" version "1.0.0" name "Preview" view MainView } ${viewSource}`,
      )

      const projects = await discoverTaoDevProjects(root)

      Expect(projects).toHaveLength(1)
      Expect(projects[0]?.name).toBe(FS.basename(root))
      // Discovery canonicalizes the project root so a symlinked path cannot become a second app
      // authority, and the host temporary directory is itself reached through one.
      Expect(projects[0]?.root).toBe(await FS.realPath(root))
      Expect(projects[0]?.apps.map(app => app.appName).toSorted()).toEqual(['Preview', 'Reader'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('labels choices 1-9 then letters and accepts lowercase without Enter', async () => {
    const projects = projectFixture(15)
    const input = terminalStream()
    const output = terminalStream()
    let prompt = ''
    output.on('data', chunk => {
      prompt += chunk.toString()
    })
    input.end('a')

    const selection = await selectTaoDevApp(projects, { input, output })
    const plainPrompt = stripAnsi(prompt)

    Expect(choiceKeySummary(15)).toBe('1-9 or A-F')
    Expect(selection).toEqual({ kind: 'selected', app: projects[1]?.apps[4] })
    Expect(plainPrompt).toContain('Choose the Tao app to run')
    Expect(plainPrompt).toContain('Project 1:')
    Expect(plainPrompt).toContain('Project 2:')
    Expect(plainPrompt).toContain('9) App 9')
    Expect(plainPrompt).toContain('A) App 10')
    Expect(plainPrompt).toContain('Q) Quit')
  })

  Test('keeps listening after an invalid key and accepts the next valid key', async () => {
    const projects = projectFixture(15)
    const input = terminalStream()
    const output = terminalStream()
    let prompt = ''
    output.on('data', chunk => {
      prompt += chunk.toString()
    })

    const selectionPromise = selectTaoDevApp(projects, { input, output })
    input.write('w')
    await new Promise(resolve => setTimeout(resolve, 0))
    input.end('a')

    Expect(await selectionPromise).toEqual({ kind: 'selected', app: projects[1]?.apps[4] })
    Expect(stripAnsi(prompt)).toContain('Choose an app with 1-9 or A-F, or Q to quit.')
    Expect(stripAnsi(prompt).match(/Choose:/g)?.length).toBe(2)
  })

  Test('reserves q for quitting the selector', async () => {
    const projects = projectFixture(34)
    const input = terminalStream()
    const output = terminalStream()
    input.end('q')

    Expect(keyForChoiceIndex(24)).toBe('P')
    Expect(keyForChoiceIndex(25)).toBe('R')
    Expect(keyForChoiceIndex(33)).toBe('Z')
    Expect(choiceIndexForKey('q')).toBeUndefined()
    Expect(await selectTaoDevApp(projects, { input, output })).toEqual({ kind: 'exit', exitCode: 0 })
  })

  Test('cancels on Escape and reports Ctrl-C as exit code 130', async () => {
    const projects = projectFixture(3)
    const escaped = terminalStream()
    const interrupted = terminalStream()
    // Typed rather than ended, so each result comes from the keypress itself and not from a closed stream.
    escaped.write(HCI.RawKey.escape)
    interrupted.write(HCI.RawKey.interrupt)

    Expect(await selectTaoDevApp(projects, { input: escaped, output: terminalStream() }))
      .toEqual({ kind: 'cancel' })
    Expect(await selectTaoDevApp(projects, { input: interrupted, output: terminalStream() }))
      .toEqual({ kind: 'exit', exitCode: 130 })
  })

  // The selector resumes stdin to read one key. Leaving it flowing keeps the event loop alive, so
  // the CLI hangs after quitting — with the terminal already back in echoing cooked mode.
  Test('releases its input stream so the process can exit after quitting', async () => {
    const projects = projectFixture(2)
    const input = terminalStream()
    const output = terminalStream()
    input.write('q')

    Expect(await selectTaoDevApp(projects, { input, output })).toEqual({ kind: 'exit', exitCode: 0 })
    Expect(input.isPaused()).toBe(true)
  })

  Test('returns to the same Tao CLI selector when the running loop requests an app switch', async () => {
    const root = await mkTestDir('tao-dev-switch-', { location: 'host' })
    try {
      await FS.writeText(
        FS.resolvePath('Project/Apps.tao', root),
        `app First { id "first" version "1.0.0" name "First" view MainView }
         app Second { id "second" version "1.0.0" name "Second" view MainView }
         ${viewSource}`,
      )
      await FS.writeText(FS.resolvePath('Project/.tao/.gitkeep', root), '')
      const input = terminalStream()
      const output = terminalStream()
      let written = ''
      output.on('data', chunk => {
        written += chunk.toString()
      })
      input.end('2')
      const runs: string[] = []
      const devices: (string | undefined)[] = []

      const exitCode = await runTaoDev(root, {
        appName: 'First',
        device: 'roPhone',
        input,
        output,
        runLoop: async (selection, device) => {
          runs.push(selection.appName)
          devices.push(device)
          return runs.length === 1 ? { kind: 'select-app' } : { kind: 'exit', exitCode: 0 }
        },
      })

      Expect(exitCode).toBe(0)
      Expect(runs).toEqual(['First', 'Second'])
      Expect(devices).toEqual(['roPhone', 'roPhone'])
      // Quitting closes the dashboard's alternate screen, which restores the stale selector;
      // the exit line is what tells the user the CLI actually finished.
      Expect(stripAnsi(written)).toContain('Exited Tao run.')
    } finally {
      await FS.remove(root)
    }
  })
})

function projectFixture(appCount: number): TaoDevProject[] {
  const apps = Array.from({ length: appCount }, (_, index) => ({
    appId: `app-${index + 1}`,
    appName: `App ${index + 1}`,
    appPath: `/repo/Project ${index < 5 ? 1 : 2}/Apps.tao`,
    projectName: `Project ${index < 5 ? 1 : 2}`,
    projectRoot: `/repo/Project ${index < 5 ? 1 : 2}`,
  }))
  return [
    { apps: apps.slice(0, 5), name: 'Project 1', root: '/repo/Project 1' },
    { apps: apps.slice(5), name: 'Project 2', root: '/repo/Project 2' },
  ]
}

function terminalStream(): PassThrough & { isTTY: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY: boolean }
  stream.isTTY = true
  return stream
}

const stripAnsi = Text.stripAnsi
