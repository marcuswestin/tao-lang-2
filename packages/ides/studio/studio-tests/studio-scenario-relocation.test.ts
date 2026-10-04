import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Errors, FS } from '@shared'
import { Deferred, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { StudioGeneratedSources } from '../studio-src/StudioGeneratedSources'
import { StudioProjectSession } from '../studio-src/StudioProjectSession'

const baseFiles = {
  '@/studio/View1.tao':
    '// Studio-written generated source. Read-only until moved to a package.\npublic view View1() { }\nscenarios View1 "sketch" { scenario "draft" { render () } }',
  '@views/Existing.tao': 'public view Existing() { }',
  'Garden.tao': 'app Garden { id "garden" version "1.0.0" name "Garden" view Main }\nview Main() { }',
}

const moveSlot = testOverrideSlot({
  read: () => StudioGeneratedSources.prototype.moveView,
  write: value => {
    StudioGeneratedSources.prototype.moveView = value
  },
})

for (const existing of [false, true]) {
  Test(`Move preserves an author change before writing ${existing ? 'existing' : 'new'} Scenarios.tao`, async () => {
    await withTaoFiles('tao-move-before-scenarios-', {
      ...baseFiles,
      ...(existing ? { 'Scenarios.tao': 'let Before = "old"' } : {}),
    }, async (paths, root) => {
      const session = await StudioProjectSession.open({
        async compile() {},
        entryPath: paths['Garden.tao'],
        projectRoot: root,
      })
      const before = await session.readFile('@/studio/View1.tao')
      const move = StudioGeneratedSources.prototype.moveView
      const scenariosPath = FS.resolvePath('Scenarios.tao', root)
      const restore = moveSlot.install(async function(this: StudioGeneratedSources, ...args) {
        const result = await move.apply(this, args)
        if (result === FS.resolvePath('@views/View1.tao', root)) {
          await FS.writeText(scenariosPath, 'let Authored = "before write"')
        }
        return result
      })
      try {
        await Expect(
          session.moveGeneratedSource({
            path: before.path,
            sourceVersion: before.sourceVersion,
            targetPackage: '@views',
            writeId: 'before-write',
          }),
        )
          .rejects.toThrow('Scenarios.tao changed during the move')
        Expect(await FS.readText(scenariosPath)).toBe('let Authored = "before write"')
        Expect(await session.readFile('@/studio/View1.tao')).toEqual(before)
      } finally {
        restore()
      }
    })
  })
}

for (const existing of [false, true]) {
  Test(
    `Move rollback preserves concurrent author edits to ${existing ? 'existing' : 'new'} Scenarios.tao`,
    async () => {
      await withTaoFiles('tao-move-concurrent-scenarios-', {
        ...baseFiles,
        ...(existing ? { 'Scenarios.tao': 'let Before = "old"' } : {}),
      }, async (paths, root) => {
        const entered = Deferred<void>()
        const release = Deferred<void>()
        let first = true
        const session = await StudioProjectSession.open({
          async compile() {
            if (first) {
              first = false
              entered.resolve()
              await release.promise
              Errors.throwUserInput('Reject moved source.')
            }
          },
          entryPath: paths['Garden.tao'],
          projectRoot: root,
        })
        const before = await session.readFile('@/studio/View1.tao')
        const action = session.moveGeneratedSource({
          path: before.path,
          sourceVersion: before.sourceVersion,
          targetPackage: '@views',
          writeId: 'concurrent-scenarios',
        })
        const failure = action.then(() => undefined, error => Errors.asError(error))
        await entered.promise
        const scenariosPath = FS.resolvePath('Scenarios.tao', root)
        try {
          await FS.writeText(scenariosPath, 'let Authored = "preserve me"')
        } finally {
          release.resolve()
        }
        const rejected = await failure
        Expect(await FS.readText(scenariosPath)).toBe('let Authored = "preserve me"')
        Expect(rejected?.message).toContain('Scenarios.tao changed during the move')
        Expect(await session.readFile('@/studio/View1.tao')).toEqual(before)
        Expect(await FS.exists(FS.resolvePath('@views/View1.tao', root))).toBe(false)
      })
    },
  )
}

Test('Scenario relocation distinguishes a fixture handle from a same-named private view', async () => {
  await withTaoFiles('tao-move-private-name-', {
    ...baseFiles,
    '@/studio/View1.tao': `// Studio-written generated source. Read-only until moved to a package.
use Task from @model
public fixture Demo { Example = create Task { Title: "Example" } }
view Example() { }
public view View1(Task) { }
scenarios View1 "sketch" { fixture Demo scenario "draft" { render (Task: Example) } }`,
    '@model/Data.tao': 'public data Tasks / Task { Title text }',
  }, async (paths, root) => {
    const session = await StudioProjectSession.open({
      async compile() {},
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    const before = await session.readFile('@/studio/View1.tao')
    const moved = await session.moveGeneratedSource({
      path: before.path,
      sourceVersion: before.sourceVersion,
      targetPackage: '@views',
      writeId: 'same-name',
    })
    Expect(moved.status).toBe('moved')
    const scenariosPath = FS.resolvePath('Scenarios.tao', root)
    const source = await FS.readText(scenariosPath)
    Expect(source).toContain('use Demo from @views')
    Expect(source).not.toContain('use Example')
    const parsed = await (await Workspace.open(root)).parse(scenariosPath)
    const group = parsed.entry.ast.statements.find(AST.isScenarioGroupDeclaration)!
    const scenario = AST.scenarioDeclarations(group)[0]!
    const render = AST.effectiveScenarioSubjectClause(scenario)!
    Expect.Is(render, AST.isScenarioRenderClause)
    const value = render.argumentList!.arguments[0]!.value
    Expect.Is(value, AST.isFixtureValueReference)
    Expect.Is(value.target.ref, AST.isFixtureCreateBinding)
  })
})
