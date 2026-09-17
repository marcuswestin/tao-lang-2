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

Describe('Tao dev app discovery and selection', () => {
  Test('discovers every runnable app recursively and groups it by project', async () => {
    const root = await mkTestDir('tao-dev-discovery-')
    try {
      await FS.writeText(
        FS.resolvePath('WordFlower/Current/WordFlower.tao', root),
        `project { name "WordFlower" remote none license MIT }
         app WordFlower { view MainView }
         app WordFlowerDemo { view MainView }
         ${viewSource}`,
      )
      await FS.writeText(
        FS.resolvePath('Test Apps/Data MVP/Data MVP.tao', root),
        `app DataMVP { view MainView }
         ${viewSource}`,
      )
      await FS.writeText(
        FS.resolvePath('Test Apps/Data MVP/Data MVP.test.tao', root),
        `app TestOnly { view MainView }
         test "ignored" { }
         ${viewSource}`,
      )

      const projects = await discoverTaoDevProjects(root)

      Expect(projects.map(project => project.name)).toEqual(['Data MVP', 'WordFlower'])
      Expect(projects[0]?.apps.map(app => app.appName)).toEqual(['DataMVP'])
      Expect(projects[1]?.apps.map(app => app.appName)).toEqual(['WordFlower', 'WordFlowerDemo'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('groups nested and package app declarations under ancestor project metadata', async () => {
    const root = await mkTestDir('tao-dev-split-project-')
    try {
      await FS.writeText(
        FS.resolvePath('Project.tao', root),
        'project { id "split" name "Split project" }',
      )
      await FS.writeText(
        FS.resolvePath('features/Reader.tao', root),
        `workspace app Reader { view MainView } ${viewSource}`,
      )
      await FS.writeText(
        FS.resolvePath('packages/@preview/App.tao', root),
        `public app Preview { view MainView } ${viewSource}`,
      )

      const projects = await discoverTaoDevProjects(root)

      Expect(projects).toHaveLength(1)
      Expect(projects[0]?.name).toBe('Split project')
      Expect(projects[0]?.root).toBe(root)
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

    Expect(Array.from({ length: 15 }, (_, index) => keyForChoiceIndex(index))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ])
    Expect(choiceIndexForKey('a')).toBe(9)
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
    const root = await mkTestDir('tao-dev-switch-')
    try {
      await FS.writeText(
        FS.resolvePath('Project/Apps.tao', root),
        `project { name "Switch Project" remote none license MIT }
         app First { view MainView }
         app Second { view MainView }
         ${viewSource}`,
      )
      const input = terminalStream()
      const output = terminalStream()
      let written = ''
      output.on('data', chunk => {
        written += chunk.toString()
      })
      input.end('2')
      const runs: string[] = []

      const exitCode = await runTaoDev(root, {
        appName: 'First',
        input,
        output,
        runLoop: async selection => {
          runs.push(selection.appName)
          return runs.length === 1 ? { kind: 'select-app' } : { kind: 'exit', exitCode: 0 }
        },
      })

      Expect(exitCode).toBe(0)
      Expect(runs).toEqual(['First', 'Second'])
      // Quitting closes the dashboard's alternate screen, which restores the stale selector;
      // the exit line is what tells the user the CLI actually finished.
      Expect(stripAnsi(written)).toContain('Exited Tao dev.')
    } finally {
      await FS.remove(root)
    }
  })
})

function projectFixture(appCount: number): TaoDevProject[] {
  const apps = Array.from({ length: appCount }, (_, index) => ({
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
