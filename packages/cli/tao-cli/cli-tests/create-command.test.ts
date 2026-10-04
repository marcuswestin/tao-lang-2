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
    fields: [{ name: 'Title', type: 'text', title: true }, { name: 'Days', type: 'number', title: false }, {
      name: 'Booked',
      type: 'yesno',
      title: false,
    }],
  }],
  palette: { canvas: '#ffffff', ink: '#111111', accent: '#ff6600' },
}
const sampleRows: JsonObject = {
  rows: [{ Title: 'Lisbon', Days: 4, Booked: true }, { Title: 'Kyoto', Days: 10, Booked: false }],
}

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
  Test('creates a Firebase app with local journeys and no connection setup', async () => {
    await withRoot(async (root, output, captured) => {
      const result = await runCreate('A notebook for short notes', {
        ai: 'none',
        cwd: root,
        id: 'private-notes',
        interactive: false,
        output,
        provider: 'firebase',
        runTests: false,
        yes: true,
      })
      Expect(result.created).toBe(true)
      Expect(await relativeTaoFiles(result.directory)).toContain('Auth.tao')
      Expect(await FS.readText(FS.resolvePath('App.tao', result.directory)))
        .toContain('Auth FirebaseAuth')
      Expect(await FS.readText(FS.resolvePath('ANotebookFor.test.tao', result.directory)))
        .toContain('Datasource Memory')
      Expect(await FS.readText(FS.resolvePath('Auth.tao', result.directory)))
        .not.toContain('Fill validation credentials')
      Expect(captured()).toContain('Created')
      Expect(await FS.exists(FS.resolvePath('.tao/local/connections.json', result.directory))).toBe(false)
    })
  })

  Test('adds the synthetic validation fill only when requested for Firebase', async () => {
    await withRoot(async (root, output) => {
      await Expect(runCreate('A notebook for short notes', {
        ai: 'none',
        cwd: root,
        id: 'invalid-validation',
        interactive: false,
        output,
        runTests: false,
        validationTools: true,
        yes: true,
      })).rejects.toThrow('--validation-tools requires --provider firebase')
      Expect(await FS.exists(FS.resolvePath('invalid-validation', root))).toBe(false)
      const result = await runCreate('A notebook for short notes', {
        ai: 'none',
        cwd: root,
        id: 'validation-notes',
        interactive: false,
        output,
        provider: 'firebase',
        runTests: false,
        validationTools: true,
        yes: true,
      })
      Expect(await FS.readText(FS.resolvePath('Auth.tao', result.directory)))
        .toContain('FormButton("Fill validation credentials")')
      Expect(await FS.readText(FS.resolvePath('ANotebookFor.test.tao', result.directory)))
        .toContain('fills validation credentials without signing in')
    })
  })

  Test('rejects Firebase account name collisions before writing', async () => {
    await withRoot(async (root, output) => {
      await Expect(runCreate('Account', {
        ai: 'none',
        cwd: root,
        id: 'account-name',
        interactive: false,
        output,
        provider: 'firebase',
        runTests: false,
        yes: true,
      })).rejects.toThrow('reserves Account')
      Expect(await FS.exists(FS.resolvePath('account-name', root))).toBe(false)

      const accountPlan: JsonObject = {
        ...wholePlan,
        id: 'account-entity',
        entities: [{
          plural: 'Accounts',
          singular: 'Account',
          purpose: 'One account.',
          fields: [{ name: 'Title', type: 'text', title: true }],
        }],
      }
      const provider = new ScriptedGenerationProvider([
        { kind: 'answer', value: accountPlan },
        { kind: 'answer', value: { rows: [{ Title: 'One' }] } },
      ])
      await Expect(runCreate('A list of accounts', {
        cwd: root,
        interactive: false,
        lanes: [fakeLane(provider)],
        output,
        provider: 'firebase',
        runTests: false,
        yes: true,
      })).rejects.toThrow('reserves Accounts')
      Expect(await FS.exists(FS.resolvePath('account-entity', root))).toBe(false)

      for (const name of ['TripPlannerAuthNavigator', 'TripPlannerAccountGate', 'TripPlannerSignIn']) {
        const authPlan: JsonObject = {
          ...wholePlan,
          id: `collision-${name.toLowerCase()}`,
          entities: [{
            plural: name,
            singular: 'Entry',
            purpose: 'One entry.',
            fields: [{ name: 'Title', type: 'text', title: true }],
          }],
        }
        const authProvider = new ScriptedGenerationProvider([
          { kind: 'answer', value: authPlan },
          { kind: 'answer', value: { rows: [{ Title: 'One' }] } },
        ])
        await Expect(runCreate('A list of entries', {
          cwd: root,
          interactive: false,
          lanes: [fakeLane(authProvider)],
          output,
          provider: 'firebase',
          runTests: false,
          yes: true,
        })).rejects.toThrow(`reserves ${name}`)
        Expect(await FS.exists(FS.resolvePath(`collision-${name.toLowerCase()}`, root))).toBe(false)
      }
    })
  })

  Test('fresh one-feature and two-feature projects use native navigation and UI', async () => {
    await withRoot(async (root, output) => {
      const one = await runCreate('A notebook for short notes', {
        ai: 'none',
        cwd: root,
        interactive: false,
        output,
        runTests: false,
        yes: true,
      })
      Expect(one.created).toBe(true)
      Expect(await FS.readText(FS.resolvePath('Chrome.tao', one.directory)))
        .toContain('use StackNav from @tao/nav')
      Expect(await FS.readText(FS.resolvePath('Items/Items.tao', one.directory)))
        .toContain('from @tao/ui')

      const twoPlan: JsonObject = {
        ...wholePlan,
        name: 'Trip Notes',
        id: 'trip-notes',
        entities: [
          ...(wholePlan['entities'] as JsonObject[]),
          {
            plural: 'Notes',
            singular: 'Note',
            purpose: 'One note.',
            fields: [{ name: 'Title', type: 'text', title: true }],
          },
        ],
      }
      const provider = new ScriptedGenerationProvider([
        { kind: 'answer', value: twoPlan },
        { kind: 'answer', value: sampleRows },
        { kind: 'answer', value: { rows: [{ Title: 'Packing list' }] } },
      ])
      const two = await runCreate('Trip notes', {
        cwd: root,
        interactive: false,
        lanes: [fakeLane(provider)],
        output,
        runTests: false,
        yes: true,
      })
      Expect(two.created).toBe(true)
      const chrome = await FS.readText(FS.resolvePath('Chrome.tao', two.directory))
      Expect(chrome).toContain('use SelectionNav, StackNav from @tao/nav')
      Expect(chrome).toContain('Display "automatic"')
      Expect(await FS.readText(FS.resolvePath('Trips/Trips.tao', two.directory)))
        .toContain('from @tao/ui')
      Expect(await FS.readText(FS.resolvePath('Notes/Notes.tao', two.directory)))
        .toContain('from @tao/ui')
    })
  })

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
      Expect(captured()).toContain('tao run a-notebook-for')
      Expect(await FS.readText(FS.resolvePath('App.tao', result.directory))).toContain('id "a-notebook-for"')
      Expect(await FS.readText(FS.resolvePath('tsconfig.json', result.directory)))
        .toBe('{ "extends": "./.tao/cache/typescript/tsconfig.json" }\n')
      Expect(
        (await FS.readJson<{ skillsVersion: string }>(FS.resolvePath('.tao/store/lock.jsonc', result.directory)))
          .skillsVersion,
      )
        .toBe('1.0.0')
      Expect(await FS.exists(FS.resolvePath('.tao-project/skills.version', result.directory))).toBe(false)
      const identity = await FS.readJson<{ id: string }>(FS.resolvePath('.tao/store/project.json', result.directory))
      Expect(identity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      Expect((await FS.listDir(FS.resolvePath('.tao', result.directory))).toSorted())
        .toEqual(['.gitignore', 'cache', 'local', 'store'])
      const gitignore = await FS.readText(FS.resolvePath('.gitignore', result.directory))
      Expect(gitignore).toContain('/.tao/local/')
      Expect(gitignore).toContain('/.tao/cache/')
      Expect(gitignore).not.toContain('/.tao/*')
      Expect(await FS.readText(FS.resolvePath('CLAUDE.md', result.directory))).toBe('@AGENTS.md\n')
      Expect(await FS.readText(FS.resolvePath('.agents/skills/tao-project/SKILL.md', result.directory)))
        .toBe(await FS.readText(FS.resolvePath('.claude/skills/tao-project/SKILL.md', result.directory)))
      Expect(captured()).toContain('.agents/skills/tao-project/SKILL.md')
      Expect(await FS.realPath(FS.resolvePath('node_modules/@tao/runtime', result.directory))).toBe(
        Repo.resolvePath('packages/apps/runtime'),
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
      // Everything this test names is settled before the confirmation, so it declines: lowering,
      // formatting, and validating a shaped project are proved by the end-to-end test above and by
      // the starter tests, and running them again here costs seconds per test.
      const result = await runCreate('Plan trips with friends', {
        cwd: root,
        id: 'our-trips',
        interactive: true,
        lanes: [fakeLane(provider, stopped)],
        output,
        prompts: scriptedPrompts({ confirm: [true, false] }, []),
        runTests: false,
      })
      Expect(result.plan.id).toBe('our-trips')
      Expect(result.directory).toBe(FS.resolvePath('our-trips', root))
      Expect(result.plan.entities.map(entity => entity.plural)).toEqual(['Trips'])
      Expect(stopped).toEqual(['stopped'])
      // Lowering is proved against what reached disk in the interactive-create test below, not
      // against this call's own return value.
      Expect(result.created).toBe(false)
      Expect(captured()).toContain('Shaping the project with Fake lane.')
      Expect(captured()).toContain('Shaped by Fake lane.')
      Expect(captured()).toContain('Trips / Trip: Title (text, title), Days (number), Booked (yes/no); 2 sample rows')
    })
  })

  // Every other interactive test declines at the confirmation, which left the path a person
  // actually takes — say yes, and get a project — covered only by the non-interactive `--yes` run.
  Test('writes the shaped project when the confirmation is accepted', async () => {
    await withRoot(async (root, output, captured) => {
      const provider = new ScriptedGenerationProvider([{ kind: 'answer', value: wholePlan }, {
        kind: 'answer',
        value: sampleRows,
      }])
      const result = await runCreate('Plan trips with friends', {
        cwd: root,
        interactive: true,
        lanes: [fakeLane(provider)],
        output,
        // Use the lane, then accept the id it suggested, then create.
        prompts: scriptedPrompts({ confirm: [true, true], text: ['plan-trips-with'] }, []),
        runTests: false,
      })

      Expect(result.created).toBe(true)
      // The entity the lane shaped is what reached disk, lowered into its own directory — which is
      // the claim the plan's own lowering used to be asked to make about itself.
      Expect(await relativeTaoFiles(result.directory)).toContain('Trips/Trips.tao')
      Expect(await FS.readText(FS.resolvePath('Trips/Trips.tao', result.directory))).toContain('Trip')
      Expect(captured()).toContain('tao run plan-trips-with')
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
        prompts: scriptedPrompts({ confirm: [false, false], text: ['my-notes'] }, asked),
        runTests: false,
      })
      Expect(asked).toEqual([
        'Fake lane is listening. Use it?',
        'Project id (also the directory name)',
        `Create ${FS.displayPath(FS.resolvePath('my-notes', root))}?`,
      ])
      Expect(provider.calls).toEqual([])
      Expect(result.created).toBe(false)
      Expect(result.plan.id).toBe('my-notes')
      Expect(result.directory).toBe(FS.resolvePath('my-notes', root))
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
      // A run that cannot ask has already chosen its lane, and said so, by the time it looks at the
      // directory. A directory already standing at the id this description derives ends the run
      // there, so the lane decision is read without generating a project again.
      await FS.mkdir(FS.resolvePath('a-notebook', root))
      await Expect(runCreate('A notebook', options)).rejects.toThrow(
        `Cannot create project 'a-notebook': ${FS.displayPath(FS.resolvePath('a-notebook', root))} already exists.`,
      )
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
        interactive: true,
        output,
        prompts: scriptedPrompts({ confirm: [false] }, []),
        runTests: false,
      })
      Expect(result.plan.palette).toEqual(palette)
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
        interactive: true,
        lanes: [broken],
        output,
        prompts: scriptedPrompts({ confirm: [true, false] }, []),
        runTests: false,
      })
      Expect(result.plan.entities.map(entity => entity.plural)).toEqual(['Items'])
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
      // The id prompt has done its work by the time the confirmation is asked, so this one declines.
      const prompts: CreationPrompts = {
        confirm: async () => false,
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
      Expect(result.plan.id).toBe('a-notebook')
    })
  })

  Test('refuses a malformed --id and empty description', async () => {
    await withRoot(async (root, output) => {
      const options: CreateCommandOptions = {
        ai: 'none',
        cwd: root,
        interactive: false,
        output,
        runTests: false,
        yes: true,
      }
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
