import { Assert, CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import Workspace from '@workspace'
import { runFix } from '../cli-src/source-commands'
import { runTaoCliForTest } from './test-cli-files'

/*
 * `Docs/Tutorials/Your First Tao App.md` is the main learning path, so its snippets are the first
 * Tao a newcomer runs. They are proven the way the starter tests prove the starters: the
 * document is the source, and this suite replays it. Every fenced `tao` block carries a directive in
 * its info string — invisible where the document renders — saying how a reader applies it:
 *
 * - `program` replaces the whole file, and only the first snippet has it.
 * - `edit` replaces each declaration it contains by name, and appends the ones that are new. A `use`
 *   line replaces the line for the same module, or joins the others in module order. `after=<kind>`
 *   places a new declaration under the existing one of that kind instead of at the end.
 * - `edit tail` replaces the run of lines from its first line to the end of that declaration, which
 *   is how a step changes the inside of a declaration without reprinting all of it.
 * - `final` is the finished file the tutorial ends with, and the replay has to reproduce it exactly.
 */
const FIRST_APP_TUTORIAL = 'Docs/Tutorials/Your First Tao App.md'

/** WALKTHROUGH is the dated tour whose commands and paths this suite keeps from going stale. */
const WALKTHROUGH = 'Docs/Tutorials/Tao now - two-week walkthrough.md'

/** TutorialBlock is one fenced Tao snippet: its directives, its source, and the step it sits under. */
type TutorialBlock = {
  directives: readonly string[]
  section: string
  source: string
}

/** TutorialProgram is the Tao file a reader holds: use lines first, then declarations in order. */
type TutorialProgram = {
  declarations: string[]
  uses: string[]
}

/** TutorialStep is the file a reader holds once they have applied every snippet in one step. */
type TutorialStep = {
  section: string
  source: string
}

Describe('Docs tutorials', () => {
  Test('Your First Tao App assembles, step by step, into the finished file it ends with', async () => {
    const blocks = tutorialBlocks(await FS.readText(Repo.resolvePath(FIRST_APP_TUTORIAL)))
    const steps = replayTutorial(blocks)

    Expect(steps.map(step => step.section)).toEqual([
      'Step 1 — the smallest app',
      'Step 2 — layout',
      'Step 3 — design',
      'Step 4 — data',
      'Step 5 — creating rows',
      'Step 6 — a second screen',
      'Step 7 — tabs',
      'Step 8 — one layout for phone and desktop',
      'Step 9 — a test that drives the whole app',
    ])
    Expect(steps.at(-1)?.source).toBe(finishedFile(blocks))
  })

  Test('every step of Your First Tao App is canonically formatted and validates', async () => {
    const blocks = tutorialBlocks(await FS.readText(Repo.resolvePath(FIRST_APP_TUTORIAL)))
    const root = await mkTestDir('tao-tutorial-steps-')
    try {
      // Every step is written into one directory, so the replay opens one workspace instead of one
      // per step. A parse loads only the documents its own entry reaches, so the steps stay
      // invisible to each other and each file is still judged on its own.
      const written = replayTutorial(blocks)
        .map((step, index) => ({ ...step, file: FS.resolvePath(`step-${index + 1}.tao`, root) }))
      for (const step of written) {
        await FS.writeText(step.file, step.source)
      }

      const fixes = await runFix(root, { cwd: root })
      const workspace = await Workspace.open(root)

      // A file the batch never reached, or could not rewrite, is left exactly as written and would
      // read as canonical, so every step has to come back from the run carrying a status of its own.
      const statuses = new Map(fixes.map(fix => [fix.path, fix.status]))
      const unfixed: string[] = []
      const noncanonical: string[] = []
      const problems: string[] = []
      for (const step of written) {
        const status = statuses.get(step.file)
        if (status === undefined || status === 'error') {
          unfixed.push(step.section)
        }
        if (await FS.readText(step.file) !== step.source) {
          noncanonical.push(step.section)
        }
        const validation = await workspace.validate(step.file)
        problems.push(
          ...validation.diagnostics
            .filter(diagnostic => diagnostic.severity === 'error')
            .map(diagnostic => `${step.section}: ${diagnostic.message}`),
        )
      }
      Expect(unfixed).toEqual([])
      Expect(noncanonical).toEqual([])
      Expect(problems).toEqual([])
    } finally {
      await FS.remove(root)
    }
  }, 60_000)

  Test('the finished Your First Tao App app passes the behavior test the tutorial ends with', async () => {
    const blocks = tutorialBlocks(await FS.readText(Repo.resolvePath(FIRST_APP_TUTORIAL)))
    const root = await mkTestDir('tao-tutorial-app-')
    try {
      const directory = FS.resolvePath('reading-list', root)
      await FS.writeText(FS.resolvePath('ReadingList.tao', directory), finishedFile(blocks))

      const run = await runTaoCliForTest(['test', directory])

      const output = `${run.stdout}${run.stderr}`
      Expect(output).toContain('Found 1 Tao test file')
      Expect(output).toContain('Tests:       1 passed, 1 total')
      Expect(run.exitCode).toBe(0)
    } finally {
      await FS.remove(root)
    }
  }, 120_000)

  Test('the Tao now walkthrough names paths, recipes, apps, and tao commands that still exist', async () => {
    const markdown = await FS.readText(Repo.resolvePath(WALKTHROUGH))

    const paths = referencedRepositoryPaths(markdown)
    const recipes = named(markdown, /\bjust ([a-z_][a-z0-9_-]*)/g)
    const apps = named(markdown, /--app ([A-Za-z][A-Za-z0-9]*)/g)
    const commands = named(markdown, /(?:^|[^\w/])\.?\/?tao ([a-z][a-z-]*)/gm)
    const justfile = await FS.readText(Repo.resolvePath('Justfile'))
    const declaredApps = await declaredAppNames()
    const taoCommands = await taoCliCommandNames()

    const missingPaths: string[] = []
    for (const path of paths) {
      if (!await FS.exists(Repo.resolvePath(path))) {
        missingPaths.push(path)
      }
    }
    Expect(missingPaths).toEqual([])
    Expect(recipes.filter(recipe => !new RegExp(`^${recipe}[ :]`, 'm').test(justfile))).toEqual([])
    Expect(apps.filter(app => !declaredApps.includes(app))).toEqual([])
    Expect(commands.filter(command => !taoCommands.includes(command))).toEqual([])
    // A reference this test never found is a reference it never checked, and the empty `missing`
    // lists above would then read as proof of nothing. One known reference of each kind says the
    // four patterns are still matching the document they are pointed at.
    Expect(paths).toContain('Apps/HNReader')
    Expect(recipes).toContain('_parser-gen')
    Expect(apps).toContain('HNReaderStub')
    Expect(commands).toContain('ship')
  }, 30_000)
})

/** tutorialBlocks reads every fenced `tao` snippet in a tutorial, with the `##` heading above it. */
function tutorialBlocks(markdown: string): TutorialBlock[] {
  const lines = markdown.split('\n')
  const blocks: TutorialBlock[] = []
  let section = ''
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.startsWith('## ')) {
      section = line.slice('## '.length).trim()
      continue
    }
    if (!line.startsWith('```tao')) {
      continue
    }
    const directives = line.slice('```tao'.length).trim().split(/\s+/).filter(word => word.length > 0)
    Assert(directives.length > 0, `every \`\`\`tao block in a tutorial to carry a directive`, { section })
    const body: string[] = []
    for (index += 1; index < lines.length && lines[index] !== '```'; index += 1) {
      body.push(lines[index]!)
    }
    blocks.push({ directives, section, source: `${body.join('\n')}\n` })
  }
  return blocks
}

/** replayTutorial applies every snippet in order and returns the file a reader holds after each step. */
function replayTutorial(blocks: readonly TutorialBlock[]): TutorialStep[] {
  const program: TutorialProgram = { declarations: [], uses: [] }
  const afterEachBlock: TutorialStep[] = []
  for (const block of blocks) {
    const [directive, ...rest] = block.directives
    if (directive === 'final') {
      continue
    }
    if (directive === 'program') {
      const parsed = parseProgram(block.source)
      program.declarations = parsed.declarations
      program.uses = parsed.uses
    } else if (directive === 'edit' && rest.includes('tail')) {
      applyTail(program, block.source)
    } else if (directive === 'edit') {
      applyEdit(program, block.source, rest.find(word => word.startsWith('after='))?.slice('after='.length))
    } else {
      Assert(false, 'a tutorial snippet directive this suite knows', { directive, section: block.section })
    }
    afterEachBlock.push({ section: block.section, source: renderProgram(program) })
  }
  // A step's own snippets are applied together — a `use` line lands one snippet before the code that
  // needs it — so only the file at each step boundary is one a reader is expected to be able to run.
  return afterEachBlock.filter((step, index) => afterEachBlock[index + 1]?.section !== step.section)
}

/** finishedFile is the complete app the tutorial prints after its last step. */
function finishedFile(blocks: readonly TutorialBlock[]): string {
  const finals = blocks.filter(block => block.directives[0] === 'final')
  Assert(finals.length === 1, 'exactly one `final` snippet in the tutorial', { count: finals.length })
  return finals[0]!.source
}

/**
 * parseProgram splits Tao source into its use lines and its top-level declarations. A declaration
 * ends at a blank line whose next content starts in column one, which is what keeps the blank lines
 * inside a render body from reading as declaration boundaries.
 */
function parseProgram(source: string): TutorialProgram {
  const lines = source.replace(/\n+$/, '').split('\n')
  const declarations: string[] = []
  const uses: string[] = []
  let current: string[] = []
  for (const [index, line] of lines.entries()) {
    if (current.length === 0 && line.startsWith('use ')) {
      uses.push(line)
      continue
    }
    if (line === '') {
      const next = lines.slice(index + 1).find(later => later !== '')
      if (current.length > 0 && (next === undefined || !next.startsWith(' '))) {
        declarations.push(current.join('\n'))
        current = []
        continue
      }
      if (current.length === 0) {
        continue
      }
    }
    current.push(line)
  }
  if (current.length > 0) {
    declarations.push(current.join('\n'))
  }
  return { declarations, uses }
}

/** renderProgram writes a program back out in Tao's canonical shape: use lines, then declarations. */
function renderProgram(program: TutorialProgram): string {
  return `${program.uses.join('\n')}\n\n${program.declarations.join('\n\n')}\n`
}

/** applyEdit replaces the declarations and use lines a snippet redefines, and places the new ones. */
function applyEdit(program: TutorialProgram, source: string, after: string | undefined): void {
  const edit = parseProgram(source)
  for (const use of edit.uses) {
    const module = useModule(use)
    const modules = program.uses.map(useModule)
    const existing = modules.indexOf(module)
    if (existing >= 0) {
      program.uses[existing] = use
    } else {
      program.uses.splice(modules.filter(other => other < module).length, 0, use)
    }
  }
  let previous = after
  for (const declaration of edit.declarations) {
    const key = declarationKey(declaration)
    const keys = program.declarations.map(declarationKey)
    const existing = keys.indexOf(key)
    if (existing >= 0) {
      program.declarations[existing] = declaration
    } else {
      const anchor = previous === undefined ? -1 : keys.findIndex(other => declarationMatches(other, previous!))
      program.declarations.splice(anchor >= 0 ? anchor + 1 : program.declarations.length, 0, declaration)
    }
    previous = key
  }
}

/** applyTail replaces one declaration's lines from the snippet's first line to that declaration's end. */
function applyTail(program: TutorialProgram, source: string): void {
  const anchor = source.split('\n')[0]!
  const owners = program.declarations
    .map((declaration, index) => ({ declaration, index }))
    .filter(entry => entry.declaration.split('\n').includes(anchor))
  Assert(owners.length === 1, `one declaration holding the line '${anchor.trim()}'`, { owners: owners.length })
  const { declaration, index } = owners[0]!
  const lines = declaration.split('\n')
  program.declarations[index] = [...lines.slice(0, lines.indexOf(anchor)), source.replace(/\n+$/, '')].join('\n')
}

/** declarationKey names a declaration by its kind and name, which is how a later snippet finds it. */
function declarationKey(declaration: string): string {
  return declaration.split('\n')[0]!.split(/\s+/).slice(0, 2).join(' ')
}

/** declarationMatches accepts an `after=` anchor written as a bare kind or as a full key. */
function declarationMatches(key: string, anchor: string): boolean {
  return key === anchor || key.split(' ')[0] === anchor
}

/** useModule is the module a use line imports from, which is the key a later snippet replaces it by. */
function useModule(use: string): string {
  return use.split(' from ')[1]!.trim()
}

/** named collects the first capture of every match, deduplicated, in the order they appear. */
function named(markdown: string, pattern: RegExp): string[] {
  return [...new Set([...markdown.matchAll(pattern)].map(match => match[1]!))]
}

/**
 * referencedRepositoryPaths collects the repository paths a document names, quoted where the path
 * has a space in it and bare inside a shell command.
 */
function referencedRepositoryPaths(markdown: string): string[] {
  const quoted = named(markdown, /(?:"|`)((?:Apps|Docs|packages)\/[^"`\n]+?)(?:"|`)/g)
  // Quoted spans are blanked before the bare pass, or a quoted path with a space in it would also
  // read as a second, shorter bare path starting after that space.
  const bare = named(markdown.replace(/"[^"\n]*"|`[^`\n]*`/g, ' '), /(?:^|\s)((?:Apps|Docs|packages)\/[^\s"`\n]+)/gm)
  return [...new Set([...quoted, ...bare].map(path => path.replace(/[.,;:)]+$/, '')))]
    .filter(path => !path.includes('*'))
}

/** declaredAppNames lists every `app` declared under `Apps/`, which is what `--app` has to name. */
async function declaredAppNames(): Promise<string[]> {
  const names = new Set<string>()
  for await (const path of FS.walk(Repo.resolvePath('Apps'), { extensions: ['.tao'] })) {
    for (const match of (await FS.readText(path)).matchAll(/^app ([A-Za-z][A-Za-z0-9]*)\b/gm)) {
      names.add(match[1]!)
    }
  }
  return [...names]
}

/** taoCliCommandNames reads the command names out of the Tao CLI's own help output. */
async function taoCliCommandNames(): Promise<string[]> {
  // Commander writes help straight to the host streams, so this asks the real executable instead of
  // the in-process runner, which only captures what the CLI writes through the shared terminal.
  const help = await CLI.run(Repo.resolvePath('tao'), { args: ['--help'], cwd: Repo.getRoot() })
  const lines = `${help.stdout}${help.stderr}`.split('\n')
  const start = lines.findIndex(line => line.trim() === 'Commands:')
  Assert(start >= 0, 'the Tao CLI help to list its commands')
  return lines
    .slice(start + 1)
    .map(line => /^ {2}(\S+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
}
