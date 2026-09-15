import { type JsonObject, ScriptedGenerationProvider } from '@generation'
import { Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { PassThrough } from 'node:stream'
import { type CreateCommandOptions, type CreationPrompts, runCreate } from '../cli-src/create/create-command'
import type { CreationLane } from '../cli-src/create/creation-lanes'
import { runTaoCliForTest } from './test-cli-files'

const wholePlan: JsonObject = {
  name: 'Trip Planner',
  id: 'trip-planner',
  summary: 'Plans trips with friends.',
  entities: [{
    plural: 'Trips',
    singular: 'Trip',
    purpose: 'One trip.',
    fields: [{ name: 'Title', type: 'text', title: true }, { name: 'Days', type: 'number' }, {
      name: 'Booked',
      type: 'yesno',
    }],
  }],
  palette: { canvas: '#ffffff', ink: '#111111', accent: '#ff6600' },
}
const sampleRows: JsonObject = { rows: [{ Title: 'Lisbon', Days: 4, Booked: true }, { Title: 'Kyoto', Days: 10 }] }

function fakeLane(provider: ScriptedGenerationProvider, stopped: string[] = []): CreationLane {
  return {
    kind: 'ollama',
    label: 'Fake lane',
    window: 'wide',
    consent: 'Fake lane is listening. Use it?',
    open: async () => ({
      provider,
      stop: async () => {
        stopped.push('stopped')
      },
    }),
  }
}

function scriptedPrompts(answers: { confirm?: boolean[]; text?: string[] }, asked: string[]): CreationPrompts {
  const confirms = [...(answers.confirm ?? [])]
  const texts = [...(answers.text ?? [])]
  return {
    confirm: async (message, defaultValue) => {
      asked.push(message)
      return confirms.length > 0 ? confirms.shift()! : defaultValue
    },
    text: async (message, defaultValue, validate) => {
      asked.push(message)
      const value = texts.length > 0 ? texts.shift()! : defaultValue
      Expect(validate(value)).toBeUndefined()
      return value
    },
  }
}

async function withRoot(
  run: (root: string, output: PassThrough, captured: () => string) => Promise<void>,
): Promise<void> {
  const root = await mkTestDir('tao-create-command-')
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', chunk => chunks.push(Buffer.from(chunk)))
  try {
    await run(root, output, () => Buffer.concat(chunks).toString('utf8'))
  } finally {
    await FS.remove(root)
  }
}

async function relativeTaoFiles(directory: string): Promise<string[]> {
  const paths: string[] = []
  for await (const path of FS.walk(directory, { extensions: ['.tao'] })) {
    paths.push(FS.relativePath(directory, path))
  }
  return paths.sort()
}

Describe('tao create command', () => {
  Test('creates the plain starter without a model and lists what it wrote', async () => {
    await withRoot(async (root, output, captured) => {
      const tested: string[] = []
      const result = await runCreate('A notebook for short notes', {
        ai: 'none',
        cwd: root,
        interactive: false,
        output,
        runTests: async directory => {
          tested.push(directory)
        },
        yes: true,
      })
      Expect(result.created).toBe(true)
      Expect(result.directory).toBe(FS.resolvePath('a-notebook-for', root))
      Expect(await relativeTaoFiles(result.directory)).toEqual([
        'ANotebookFor.test.tao',
        'App.tao',
        'Chrome.tao',
        'Data.tao',
        'Design.tao',
        'Items/Items.tao',
        'Scenarios.tao',
      ])
      Expect(tested).toEqual([result.directory])
      Expect(captured()).toContain('Plain starter, no model involved.')
      Expect(captured()).toContain(
        'Items / Item: Title (text, title), Notes (text), Done (yes/no), CreatedAt (time); 3 sample rows',
      )
      Expect(captured()).toContain('tao dev a-notebook-for')
      Expect(await FS.readText(FS.resolvePath('App.tao', result.directory))).toContain('id "a-notebook-for"')
      Expect(await FS.readText(FS.resolvePath('tsconfig.json', result.directory))).toContain('"@tao/runtime"')
      Expect(await FS.realPath(FS.resolvePath('node_modules/@tao/runtime', result.directory))).toBe(
        Repo.resolvePath('packages/runtime'),
      )
    })
  })

  Test('shapes the plan through an injected lane, honors --id, and stops the lane afterwards', async () => {
    await withRoot(async (root, output, captured) => {
      const provider = new ScriptedGenerationProvider([{ kind: 'answer', value: wholePlan }, {
        kind: 'answer',
        value: sampleRows,
      }])
      const stopped: string[] = []
      const result = await runCreate('Plan trips with friends', {
        cwd: root,
        id: 'our-trips',
        interactive: false,
        lanes: [fakeLane(provider, stopped)],
        output,
        runTests: false,
        yes: true,
      })
      Expect(result.plan.id).toBe('our-trips')
      Expect(result.plan.entities.map(entity => entity.plural)).toEqual(['Trips'])
      Expect(stopped).toEqual(['stopped'])
      Expect(await FS.exists(FS.resolvePath('our-trips/Trips/Trips.tao', root))).toBe(true)
      Expect(captured()).toContain('Shaping the project with Fake lane.')
      Expect(captured()).toContain('Shaped by Fake lane.')
      Expect(captured()).toContain('Trips / Trip: Title (text, title), Days (number), Booked (yes/no); 2 sample rows')
    })
  })

  Test('asks before using a lane, suggests the id, and confirms before writing', async () => {
    await withRoot(async (root, output) => {
      const asked: string[] = []
      const provider = new ScriptedGenerationProvider([])
      const result = await runCreate('A notebook for short notes', {
        cwd: root,
        interactive: true,
        lanes: [fakeLane(provider)],
        output,
        prompts: scriptedPrompts({ confirm: [false, true], text: ['my-notes'] }, asked),
        runTests: false,
      })
      Expect(asked).toEqual([
        'Fake lane is listening. Use it?',
        'Project id (also the directory name)',
        `Create ${FS.displayPath(FS.resolvePath('my-notes', root))}?`,
      ])
      Expect(provider.calls).toEqual([])
      Expect(result.created).toBe(true)
      Expect(result.plan.id).toBe('my-notes')
      Expect(await FS.exists(FS.resolvePath('my-notes/App.tao', root))).toBe(true)
    })
  })

  Test('writes nothing when the confirmation is declined', async () => {
    await withRoot(async (root, output, captured) => {
      const result = await runCreate('A notebook', {
        ai: 'none',
        cwd: root,
        interactive: true,
        output,
        prompts: scriptedPrompts({ confirm: [false] }, []),
        runTests: false,
      })
      Expect(result.created).toBe(false)
      Expect(await FS.exists(result.directory)).toBe(false)
      Expect(captured()).toContain('Nothing created.')
    })
  })

  Test('leaves the model out when no terminal can ask, unless --yes or --ai chooses it', async () => {
    await withRoot(async (root, output, captured) => {
      const provider = new ScriptedGenerationProvider([])
      const options: CreateCommandOptions = {
        cwd: root,
        interactive: false,
        lanes: [fakeLane(provider)],
        output,
        runTests: false,
      }
      const result = await runCreate('A notebook', options)
      Expect(result.created).toBe(true)
      Expect(provider.calls).toEqual([])
      Expect(captured()).toContain('Fake lane is available; pass --yes or --ai ollama to use it.')

      await Expect(runCreate('Another', { ...options, ai: 'codex' })).rejects.toThrow(
        "The 'codex' AI lane is not available on this machine. Available: ollama.",
      )
    })
  })

  Test('keeps an image palette when the plain starter is used', async () => {
    await withRoot(async (root, output, captured) => {
      const image = FS.resolvePath('brand.png', root)
      await FS.writeText(image, 'png bytes')
      const palette = { canvas: '#fdf6e3', ink: '#073642', accent: '#d33682' }
      const result = await runCreate(`A notebook styled like ${image}`, {
        ai: 'none',
        brief: { paletteFromImage: async () => palette },
        cwd: root,
        interactive: false,
        output,
        runTests: false,
        yes: true,
      })
      Expect(result.plan.palette).toEqual(palette)
      Expect(await FS.readText(FS.resolvePath('Design.tao', result.directory))).toContain('canvas #fdf6e3')
      Expect(captured()).toContain(`Read colors from ${FS.displayPath(image)}.`)
    })
  })

  Test('falls back to the plain starter when a lane cannot start, and says so', async () => {
    await withRoot(async (root, output, captured) => {
      const broken: CreationLane = {
        kind: 'apple',
        label: 'Broken lane',
        window: 'narrow',
        consent: 'Use the broken lane?',
        open: async () => Errors.throwHostEnvironment('the helper did not compile'),
      }
      const result = await runCreate('A notebook', {
        cwd: root,
        interactive: false,
        lanes: [broken],
        output,
        runTests: false,
        yes: true,
      })
      Expect(result.created).toBe(true)
      Expect(captured()).toContain(
        'Broken lane could not be used (the helper did not compile). The plain starter is used instead.',
      )
      Expect(captured()).toContain('Plain starter, no model involved.')
    })
  })

  Test('rejects an id whose directory exists before any model runs, and in the id prompt', async () => {
    await withRoot(async (root, output) => {
      await FS.mkdir(FS.resolvePath('taken', root))
      const provider = new ScriptedGenerationProvider([])
      await Expect(runCreate('Taken', {
        cwd: root,
        id: 'taken',
        interactive: false,
        lanes: [fakeLane(provider)],
        output,
        runTests: false,
        yes: true,
      })).rejects.toThrow('already exists')
      Expect(provider.calls).toEqual([])

      let rejection: string | undefined
      const prompts: CreationPrompts = {
        confirm: async () => true,
        text: async (_message, defaultValue, validate) => {
          rejection = validate('taken')
          return defaultValue
        },
      }
      const result = await runCreate('A notebook', {
        ai: 'none',
        cwd: root,
        interactive: true,
        output,
        prompts,
        runTests: false,
      })
      Expect(rejection).toContain('already exists')
      Expect(result.created).toBe(true)
    })
  })

  Test('refuses an existing directory and a malformed --id', async () => {
    await withRoot(async (root, output) => {
      await FS.mkdir(FS.resolvePath('taken', root))
      const options: CreateCommandOptions = {
        ai: 'none',
        cwd: root,
        interactive: false,
        output,
        runTests: false,
        yes: true,
      }
      await Expect(runCreate('Taken', { ...options, id: 'taken' })).rejects.toThrow('already exists')
      await Expect(runCreate('Bad', { ...options, id: 'Bad Id' })).rejects.toThrow(
        'lowercase letters, digits, and hyphens',
      )
      await Expect(runCreate('   ', options)).rejects.toThrow('Describe the app in a sentence')
    })
  })

  Test('runs from the CLI entry with --ai none --yes --skip-tests', async () => {
    const root = await mkTestDir('tao-create-cli-')
    const previous = Platform.runtimeProcess.cwd()
    try {
      Platform.runtimeProcess.chdir(root)
      const run = await runTaoCliForTest([
        'create',
        'A tiny list',
        '--ai',
        'none',
        '--yes',
        '--skip-tests',
        '--id',
        'tiny',
      ])
      Expect(run.stderr).toBe('')
      Expect(run.exitCode).toBe(0)
      Expect(await FS.exists(FS.resolvePath('tiny/App.tao', root))).toBe(true)

      const rejected = await runTaoCliForTest(['create', 'Another', '--ai', 'sometimes'])
      Expect(rejected.exitCode).toBe(1)
      Expect(rejected.stderr).toContain('--ai must be one of auto, claude, codex, ollama, apple, none')
    } finally {
      Platform.runtimeProcess.chdir(previous)
      await FS.remove(root)
    }
  })
})
