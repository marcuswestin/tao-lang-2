import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions, { type StudioAddSketchEntityParameterPatchRequest } from '../source-actions-src/source-actions'

const request: StudioAddSketchEntityParameterPatchRequest = {
  entity: { declarationName: 'Playlists', importPath: './Data.tao', parameterName: 'Playlist' },
  fixtureName: 'Sketches',
  kind: 'add-sketch-entity-parameter',
  scenarioArguments: [
    { fixtureHandle: 'Chill', scenarioName: 'first' },
    { fixtureHandle: 'Morning', scenarioName: 'second' },
  ],
  scenarioGroupName: 'sketch',
  viewName: 'View1',
}

function files(fixtureClause = '') {
  return {
    'Data.tao': 'public data Playlists / Playlist { Title text }\npublic data Albums / Album { Title text }',
    'Sketches.tao': `
      use Playlist, Album from ./Data
      public fixture Sketches {
        Chill = create Playlist { Title: "Chill" }
        Morning = create Playlist { Title: "Morning" }
        Wrong = create Album { Title: "Album" }
      }
      public fixture Other { }
    `,
    'View1.tao': `
      use Sketches, Other from ./Sketches
      use Text from @tao/ui
      public view View1(Title text) { #title render Text(Title) }
      scenarios View1 "sketch" {
        ${fixtureClause}
        device phone
        render (Title: "Inherited")
        scenario "first" { render (Title: "Existing") press #title }
        scenario "second" { press down #title advance 600.ms press up #title }
      }
    `,
  }
}

Describe('Studio shared fixture entity parameters', () => {
  for (const fixtureClause of ['', 'fixture Sketches']) {
    Test(`binds an imported fixture with ${fixtureClause || 'no existing fixture clause'}`, async () => {
      await withTaoFiles('tao-source-actions-shared-fixture-', files(fixtureClause), async (paths, root) => {
        const workspace = await Workspace.open(root)
        const parsed = await workspace.parse(paths['View1.tao'])
        const patch = await SourceActions.applyStudioPatch(parsed.entry.document, request, {
          files: parsed.files.map(file => file.ast),
        })
        const updated = await workspace.parseSource(patch.content, parsed.entry.document.uri)

        Expect(patch.content).toContain('view View1(Title text, Playlist)')
        Expect(patch.content).toContain('render (Title: "Existing", Playlist: Chill)\n      press #title')
        Expect(patch.content).toContain(
          'render (Title: "Inherited", Playlist: Morning)\n      press down #title\n      advance 600.ms\n      press up #title',
        )
        const group = updated.entry.ast.statements.find(AST.isScenarioGroupDeclaration)!
        Expect(group.block.entries.filter(AST.isScenarioFixtureClause)).toHaveLength(1)
        const fixture = group.block.entries.find(AST.isScenarioFixtureClause)!.fixture.ref
        Expect.Is(fixture, AST.isFixtureDeclaration)
        Expect(fixture.name).toBe('Sketches')
        for (const scenario of AST.scenarioDeclarations(group)) {
          const render = scenario.block.entries.find(AST.isScenarioRenderClause)!
          const value = render.argumentList!.arguments.find(argument => argument.label === 'Playlist')!.value
          Expect.Is(value, AST.isFixtureValueReference)
          Expect(value.target.ref?.name).toBe(scenario.name === 'first' ? 'Chill' : 'Morning')
        }
        Expect(updated.entry.document.parseResult.parserErrors).toEqual([])
      })
    })
  }

  for (const fixtureHandle of ['Wrong', 'Removed']) {
    Test(`rejects the invalid imported fixture handle ${fixtureHandle}`, async () => {
      await withTaoFiles('tao-source-actions-invalid-shared-handle-', files(), async (paths, root) => {
        const parsed = await (await Workspace.open(root)).parse(paths['View1.tao'])
        await Expect(SourceActions.applyStudioPatch(parsed.entry.document, {
          ...request,
          scenarioArguments: [request.scenarioArguments[0]!, { fixtureHandle, scenarioName: 'second' }],
        }, { files: parsed.files.map(file => file.ast) })).rejects.toThrow('does not create Playlist')
      })
    })
  }

  Test('rejects an existing conflicting imported fixture', async () => {
    await withTaoFiles(
      'tao-source-actions-conflicting-shared-fixture-',
      files('fixture Other'),
      async (paths, root) => {
        const parsed = await (await Workspace.open(root)).parse(paths['View1.tao'])
        await Expect(SourceActions.applyStudioPatch(parsed.entry.document, request, {
          files: parsed.files.map(file => file.ast),
        })).rejects.toThrow('already uses another fixture')
      },
    )
  })

  Test('requires an existing linked fixture import', async () => {
    const sources = files()
    sources['View1.tao'] = sources['View1.tao'].replace('use Sketches, Other from ./Sketches', '')
    await withTaoFiles('tao-source-actions-missing-shared-fixture-', sources, async (paths, root) => {
      const parsed = await (await Workspace.open(root)).parse(paths['View1.tao'])
      await Expect(SourceActions.applyStudioPatch(parsed.entry.document, request, {
        files: parsed.files.map(file => file.ast),
      })).rejects.toThrow('fixture is not uniquely')
    })
  })
})
