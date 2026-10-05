import { ASTUtils } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '@source-actions'

const tsFence = '```ts'
const fence = '```'

Describe('compiler: Studio render occurrences', () => {
  Test('keeps external authored schemas while excluding standard library schemas', async () => {
    await withTaoFiles('tao-studio-external-schemas-', {
      'Package.tao': `package { version "1.0.0" license AGPL-3.0-only }`,
      'app/Main.tao': `
        use Shared from ../shared/Views
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() { render Shared() }
      `,
      'shared/Views.tao': `
        public type Tone is one of Neutral, Good
        public view Shared() { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['app/Main.tao'], { studio: true })

      Expect(compiled.studioManifest?.views.map(view => ({ name: view.name, path: view.source.path }))).toEqual([
        { name: 'Main', path: paths['app/Main.tao'] },
        { name: 'Shared', path: paths['shared/Views.tao'] },
      ])
      Expect(compiled.studioManifest?.generationDeclarations).toEqual([
        { kind: 'case', name: 'Tone', cases: ['Neutral', 'Good'] },
      ])
    })
  })

  Test('publishes an imported shared fixture without a runtime import binding', async () => {
    await withTaoFiles('tao-studio-shared-fixture-', {
      'Data.tao': `public data Playlists / Playlist { Title text }`,
      'Main.tao': `
        use Playlist from ./Data
        use Sketches from ./Sketches
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() { render Native() }
        view Native() { render inject ${tsFence} return null ${fence} }
        view PlaylistRow(Playlist) { render Native() }
        scenarios PlaylistRow "sketch" {
          fixture Sketches
          device phone
          scenario "draft" { render (Playlist: ChillVibes) }
        }
      `,
      'Sketches.tao': `
        use Playlist from ./Data
        public fixture Sketches {
          ChillVibes = create Playlist { Title: "Chill Vibes" }
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })

      Expect(compiled.studioManifest?.fixtures).toHaveLength(1)
      Expect(compiled.studioManifest?.fixtures[0]).toMatchObject({
        creates: [{ entity: 'Playlist', fields: { Title: 'Chill Vibes' }, name: 'ChillVibes' }],
        name: 'Sketches',
        source: { path: paths['Sketches.tao'] },
      })
      Expect(compiled.studioManifest?.scenarios[0]).toMatchObject({
        fixtureId: compiled.studioManifest?.fixtures[0]?.id,
        subject: {
          arguments: { Playlist: { handle: 'ChillVibes', kind: 'fixture-reference' } },
          kind: 'view',
          viewName: 'PlaylistRow',
        },
      })
      Expect(compiled.code).not.toContain('Sketches as')
    })
  })

  Test('publishes empty-store journey steps and distinct omitted-action stand-ins', async () => {
    await withTaoFiles('tao-studio-scenario-journey-', {
      'Main.tao': `
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() { render Native() }
        view SavedToast(Revert action()) { render Native() }
        view Native() { render inject ${tsFence} return null ${fence} }

        scenarios SavedToast "states" {
          device phone
          scenario "held" {
            render ()
            press down label "Revert"
            advance 1.5.ms
            press up #revertSave
            hover placeholder "Revert save"
            focus #revertSave
            press #revertSave
            enter "Tao" into label "Name"
            submit #name
            select #rows[2] { press text "Open" }
          }
        }
      `,
    }, async paths => {
      const manifest = (await Workspace.compile(paths['Main.tao'], { studio: true })).studioManifest

      const scenario = manifest?.scenarios[0]
      Expect(scenario?.fixtureId).toBeUndefined()
      Expect(scenario).toMatchObject({
        steps: [
          { kind: 'pressDown', selector: 'label', target: 'Revert' },
          { kind: 'advance', milliseconds: 1.5 },
          { kind: 'pressUp', selector: 'tag', target: 'revertSave' },
          { kind: 'hover', selector: 'placeholder', target: 'Revert save' },
          { kind: 'focus', tag: 'revertSave' },
          { kind: 'press', selector: 'tag', target: 'revertSave' },
          { kind: 'enter', selector: 'label', target: 'Name', value: 'Tao' },
          { kind: 'submit', selector: 'tag', target: 'name' },
          {
            index: 2,
            kind: 'select',
            steps: [{ kind: 'press', selector: 'text', target: 'Open' }],
            tag: 'rows',
          },
        ],
        subject: {
          arguments: { Revert: { kind: 'action-stand-in', parameter: 'Revert' } },
          kind: 'view',
          viewName: 'SavedToast',
        },
      })
    })
  })

  Test('adds version-bound occurrence metadata without replacing existing Tao props behavior', async () => {
    await withTaoFiles('tao-studio-render-occurrences-', {
      'Main.tao': `
        type ConfirmResult is one of Confirmed

        app First { id "com.tao.test.first" version "1.0.0" name "First"  view Main }
        app Second { id "com.tao.test.second" version "1.0.0" name "Second"  view Alternate }

        view Main() {
          action Open() {
            let Result = ask Prompt()
            if Result is Confirmed { }
          }
          render Surface() [gap 12] {
            #selected
            Child()
          }
        }

        view Alternate() { render Child() }

        view Prompt() responds ConfirmResult {
          action Confirm() { respond Confirmed }
          render Surface()
        }

        view Surface() { render inject Content @@content ${tsFence} return null ${fence} }
        view Child() { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'Second', studio: true })
      const renders = AST.streamAllContents(compiled.validation.entry.ast).filter(AST.isRender)
      const rootRender = requireRender(renders, 'Main', AST.isRenderStatement)
      const childRender = requireRender(renders, 'Main', AST.isViewRender)
      const code = compact(compiled.code)

      Expect(code).toContain(compact(studioOccurrence(rootRender, paths['Main.tao'])))
      Expect(code).toContain(compact(studioOccurrence(childRender, paths['Main.tao'])))
      Expect(code).toContain(compact(`TR.Studio.LensRender identity={${studioIdentity(rootRender, paths['Main.tao'])}`))
      Expect(code).toContain(
        compact(`TR.Studio.LensRender identity={${studioIdentity(childRender, paths['Main.tao'])}`),
      )
      Expect(code).toContain('designSpec: TR.Design.Spec([["gap",12]])')
      Expect(code).toContain('testTag: "selected"')
      Expect(code).toContain('...TR.TaoContext(_ViewProps.__tao)')
      Expect(code).toContain('TR.Navigation.Ask(')
      Expect(code).toContain('TR.Navigation.Respond(')
      Expect(code).toContain('export default TaoApps["Second"]')

      const production = await Workspace.compile(paths['Main.tao'], { appName: 'Second' })
      Expect(production.code).not.toContain('studio:')
      Expect(production.code).not.toContain('TR.Studio.LensRender')
      Expect(production.code).not.toContain(paths['Main.tao'])
    })
  })

  Test('uses Studio source text versions for test journey observations', async () => {
    const source = `
      app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
      view Main() { render Native() }
      view Native() { render inject ${tsFence} return null ${fence} }
    `
    await withTaoFiles('tao-journey-observation-version-', { 'Main.tao': source }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { journeyObservations: true })
      const compiledSource = await FS.readText(paths['Main.tao'])

      Expect(compiled.code).toContain(
        `sourceVersion: ${JSON.stringify(SourceActions.studioSourceVersion(compiledSource))}`,
      )
      Expect(compiled.code).not.toContain('studio:')
    })
  })

  Test('publishes Snap rectangle identity and source coordinates in the render inventory', async () => {
    await withTaoFiles('tao-studio-render-inventory-', {
      'App.tao': `
        use Main from @/studio
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
      `,
      '@/studio/Main.tao': `
        // Studio-written generated source. Read-only until moved to a package.

        use Text from @tao/ui
        public view Main() {
          #studio_rect_006100720074
          render Text("Hello")
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['App.tao'], { studio: true })
      const generated = compiled.validation.files.find(file => file.path === paths['@/studio/Main.tao'])!.ast
      const render = [...AST.streamAllContents(generated).filter(AST.isRender)][0]!
      const source = render.$cstNode!

      Expect(compiled.studioManifest?.renders).toEqual([{
        elementName: 'Text',
        renderId: `${paths['@/studio/Main.tao']}:${source.offset}:${source.end}`,
        source: { end: source.end, path: paths['@/studio/Main.tao'], start: source.offset },
        studioRectId: 'art',
      }])
    })
  })

  Test('keeps a Snap rectangle marker out of the test tag a release build ships', async () => {
    await withTaoFiles('tao-studio-render-marker-test-tag-', {
      'App.tao': `
        use Main from @/studio
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
      `,
      '@/studio/Main.tao': `
        // Studio-written generated source. Read-only until moved to a package.

        use Text from @tao/ui
        public view Main() {
          #studio_rect_006100720074
          render Text("Hello")
        }
      `,
    }, async paths => {
      const moduleCode = (compiled: Awaited<ReturnType<typeof Workspace.compile>>): string =>
        compiled.files.find(file => file.sourcePath === paths['@/studio/Main.tao'])!.code
      const release = moduleCode(await Workspace.compile(paths['App.tao']))
      const studio = moduleCode(await Workspace.compile(paths['App.tao'], { studio: true }))

      Expect(release).not.toContain('testTag')
      Expect(release).not.toContain('studio_rect_')
      Expect(studio).not.toContain('testTag')
      Expect(compact(studio)).toContain('studioRectId: "art"')
    })
  })

  Test('does not publish spoofed Studio rectangle markers from authored source', async () => {
    await withTaoFiles('tao-studio-render-spoof-', {
      'Main.tao': `
        use Text from @tao/ui
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() {
          #studio_rect_006100720074
          render Text("Hello")
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })

      Expect(compiled.studioManifest?.renders[0]).not.toHaveProperty('studioRectId')
      Expect(compact(compiled.code)).not.toContain('studioRectId: "art"')
    })
  })

  Test('does not authenticate a nested authored @/studio path as the project generated root', async () => {
    await withTaoFiles('tao-studio-render-nested-spoof-', {
      'Main.tao': `
        use Text from @tao/ui
        use Generated from @/studio
        use Spoof from ./Authored/@/studio
        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() { render Text("Hello") }
      `,
      '@/studio/Generated.tao': `
        // Studio-written generated source. Read-only until moved to a package.

        use Text from @tao/ui
        public view Generated() {
          #studio_rect_00670065006e00750069006e0065
          render Text("Generated")
        }
      `,
      'Authored/@/studio/Spoof.tao': `
        // Studio-written generated source. Read-only until moved to a package.

        use Text from @tao/ui
        public view Spoof() {
          #studio_rect_00730070006f006f0066
          render Text("Spoof")
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })
      const generated = compiled.studioManifest?.renders.find(render =>
        render.source.path === paths['@/studio/Generated.tao']
      )
      const spoof = compiled.studioManifest?.renders.find(render =>
        render.source.path === paths['Authored/@/studio/Spoof.tao']
      )

      Expect(generated?.studioRectId).toBe('genuine')
      Expect(spoof).toBeDefined()
      Expect(spoof).not.toHaveProperty('studioRectId')
    })
  })

  Test('publishes source-owned view schemas only for Studio compilations', async () => {
    await withTaoFiles('tao-studio-preview-manifest-', {
      'Main.tao': `
        type Tone is one of Neutral, Good
        use Account, Detail from ./More.tao

        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() { render Native() }
        view Card(
          Title text,
          Enabled boolean,
          Tone Tone,
          ChangedAt time,
          Owner Account,
          Count number default 1
        ) { render Native() }
        view Native() { render inject ${tsFence} return null ${fence} }
        view OwnerCard(Owner Account) { render Native() }
        view TitleCard(Title text) { render Native() }

        fixture StudioCards {
          Lead = create Account { Name: "Ada" }
        }
        scenarios OwnerCard "states" {
          fixture StudioCards
          device phone
          appearance dark
          network offline
          locale pseudolocale
          direction rightToLeft
          scenario "lead" {
            render (Owner: Lead)
          }
          scenario "long name" {
            render TitleCard(Title: "A much longer card title")
            appearance light
          }
        }
      `,
      'More.tao': `
        project data Accounts / Account { Name text }
        project view Detail(Label text) { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })
      const manifest = compiled.studioManifest

      Expect(manifest?.formatVersion).toBe(2)
      Expect(manifest?.selectedAppName).toBe('Preview')
      Expect(manifest?.views.map(view => view.name)).toEqual([
        'Main',
        'Card',
        'Native',
        'OwnerCard',
        'TitleCard',
        'Detail',
      ])
      Expect(manifest?.views.find(view => view.name === 'Card')?.parameters).toEqual([
        { kind: 'text', name: 'Title', required: true, typeName: 'text' },
        { kind: 'boolean', name: 'Enabled', required: true, typeName: 'boolean' },
        { choices: ['Neutral', 'Good'], kind: 'choice', name: 'Tone', required: true, typeName: 'Tone' },
        { kind: 'time', name: 'ChangedAt', required: true, typeName: 'time' },
        { entity: 'Account', kind: 'entity', name: 'Owner', required: true, typeName: 'Account' },
        { kind: 'number', name: 'Count', required: false, typeName: 'number' },
      ])
      Expect(manifest?.views.find(view => view.name === 'Detail')?.source.path).toBe(paths['More.tao'])
      Expect(manifest?.fixtures[0]).toMatchObject({
        creates: [{ entity: 'Account', fields: { Name: 'Ada' }, name: 'Lead' }],
        name: 'StudioCards',
      })
      Expect(manifest?.scenarios[0]).toMatchObject({
        environment: {
          appearance: 'dark',
          device: { height: 844, preset: 'phone', width: 390 },
          direction: 'rightToLeft',
          locale: 'pseudolocale',
          network: 'offline',
        },
        group: 'states',
        name: 'lead',
        subject: {
          arguments: { Owner: { handle: 'Lead', kind: 'fixture-reference' } },
          kind: 'view',
          viewName: 'OwnerCard',
        },
      })
      Expect(manifest?.scenarios[0]?.id).toContain('#scenario:states:lead')
      Expect(manifest?.scenarios[1]).toMatchObject({
        environment: {
          appearance: 'light',
          device: { height: 844, preset: 'phone', width: 390 },
          direction: 'rightToLeft',
          locale: 'pseudolocale',
          network: 'offline',
        },
        group: 'states',
        name: 'long name',
        subject: {
          arguments: { Title: 'A much longer card title' },
          kind: 'view',
          viewName: 'TitleCard',
        },
      })
      Expect(manifest?.scenarios[1]?.id).toContain('#scenario:states:long%20name')

      const generated = compiled.files.find(file => file.relativePath === 'TaoStudioManifest.ts')
      Expect(generated?.code).toContain('"formatVersion":2')
      Expect(generated?.code).toContain(JSON.stringify(manifest?.scenarios[0]?.id))
      Expect(generated?.code).not.toContain('"renders"')
      Expect(compiled.code).toContain(
        "import { _TaoDataCatalog, Detail } from './modules/More.tao'",
      )
      Expect(compiled.code).toContain('const useTaoGeneratedStudioScenario = TR.Studio.Environment.useScenario')
      Expect(compiled.code).toContain('const useTaoGeneratedStudioFixture = TR.Studio.Environment.useFixture')
      Expect(compiled.code).toContain('useTaoGeneratedStudioScenario()')
      Expect(compiled.code).toContain('useTaoGeneratedStudioFixture([_Scope._TaoDataCatalog])')
      // A focused view is mounted through a navigator of its own, so `present` inside it has
      // somewhere to go — the subject entry is the app definition that navigator belongs to.
      Expect(compiled.code).toContain(
        `${JSON.stringify(`${paths['Main.tao']}#OwnerCard`)}: subjectArguments => ({`,
      )
      Expect(compiled.code).toContain(
        '<TR.Studio.SubjectHost key={_TaoFixtureSeed.revision} arguments={_TaoStudioArgs} definition={_TaoStudioSubject} />',
      )
      Expect(compiled.code).toContain('restoration: { exclusions: [], mode: \'fresh\' as const, variant: "Preview" }')

      const production = await Workspace.compile(paths['Main.tao'])
      Expect(production.studioManifest).toBeUndefined()
      Expect(production.files.some(file => file.relativePath === 'TaoStudioManifest.ts')).toBe(false)
      Expect(production.code).not.toContain('useTaoGeneratedStudioScenario')
    })
  })

  // The preview bundles the manifest sidecar, and the generated root imports it. Source ranges moved
  // by every length-changing edit used to change it, so Metro re-ran the root and re-rendered the tree.
  Test('keeps the preview manifest sidecar unchanged when an edit only moves text', async () => {
    const source = (label: string) => `
      app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview" view Main }
      view Main() { render Label(Text: "${label}") }
      view Label(Text text) { render inject ${tsFence} return null ${fence} }

      scenarios Label "states" {
        device phone
        scenario "short" {
          render (Text: "Short")
        }
      }
    `
    await withTaoFiles('tao-studio-manifest-sidecar-', { 'Main.tao': source('Edit') }, async paths => {
      const sidecar = (compiled: Awaited<ReturnType<typeof Workspace.compile>>) =>
        compiled.files.find(file => file.relativePath === 'TaoStudioManifest.ts')?.code
      const before = await Workspace.compile(paths['Main.tao'], { studio: true })
      await FS.writeText(paths['Main.tao'], source('A much longer edit'))
      const after = await Workspace.compile(paths['Main.tao'], { studio: true })

      Expect(after.studioManifest?.scenarios[0]?.source).not.toEqual(before.studioManifest?.scenarios[0]?.source)
      Expect(sidecar(after)).toBeDefined()
      Expect(sidecar(after)).toBe(sidecar(before))
      Expect(sidecar(after)).not.toContain('"source"')
    })
  })

  Test('publishes entity and case generation declarations for Studio fixture generation', async () => {
    await withTaoFiles('tao-studio-generation-manifest-', {
      'Main.tao': `
        type DocumentKind is one of Note, Article, "Other"

        project
        data Workspaces / Workspace {
          Name text (required "Use a realistic workspace name."),
          Summary text?,
          CreatedAt time (default now),
          Pinned yes / no,
          Documents (owned)
        }

        project
        data Documents / Document {
          Title text (default "Untitled"),
          Score number (default 0),
          Public yes / Private no (default Public),
          Workspace
        }

        app Preview { id "com.tao.test.preview" version "1.0.0" name "Preview"  view Main }
        view Main() { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })

      Expect(compiled.studioManifest?.generationDeclarations).toEqual([
        { kind: 'case', name: 'DocumentKind', cases: ['Note', 'Article', 'Other'] },
        {
          kind: 'entity',
          name: 'Workspace',
          collection: 'Workspaces',
          fields: [
            {
              guidance: 'Use a realistic workspace name.',
              name: 'Name',
              optional: false,
              secret: false,
              type: { kind: 'scalar', scalar: 'text' },
            },
            {
              name: 'Summary',
              optional: true,
              secret: false,
              type: { kind: 'scalar', scalar: 'text' },
            },
            {
              defaultValue: { kind: 'now' },
              name: 'CreatedAt',
              optional: false,
              secret: false,
              type: { kind: 'scalar', scalar: 'time' },
            },
            {
              defaultValue: false,
              name: 'Pinned',
              optional: false,
              secret: false,
              type: { kind: 'scalar', scalar: 'boolean' },
            },
            {
              name: 'Documents',
              optional: false,
              secret: false,
              type: { entity: 'Document', inverse: true, kind: 'relation' },
            },
          ],
        },
        {
          kind: 'entity',
          name: 'Document',
          collection: 'Documents',
          fields: [
            {
              defaultValue: 'Untitled',
              name: 'Title',
              optional: false,
              secret: false,
              type: { kind: 'scalar', scalar: 'text' },
            },
            {
              defaultValue: 0,
              name: 'Score',
              optional: false,
              secret: false,
              type: { kind: 'scalar', scalar: 'number' },
            },
            {
              defaultValue: true,
              name: 'Public',
              optional: false,
              secret: false,
              type: { kind: 'scalar', scalar: 'boolean' },
            },
            {
              name: 'Workspace',
              optional: false,
              secret: false,
              type: { entity: 'Workspace', inverse: false, kind: 'relation' },
            },
          ],
        },
      ])
      // Studio reads generation schemas from its in-process manifest; the preview never does.
      const generated = compiled.files.find(file => file.relativePath === 'TaoStudioManifest.ts')
      Expect(generated?.code).not.toContain('"generationDeclarations"')
      Expect(generated?.code).not.toContain('"guidance":"Use a realistic workspace name."')

      const production = await Workspace.compile(paths['Main.tao'])
      Expect(production.studioManifest).toBeUndefined()
      Expect(production.files.some(file => file.relativePath === 'TaoStudioManifest.ts')).toBe(false)
    })
  })
})

function requireRender(
  renders: readonly AST.Render[],
  ownerName: string,
  guard: (render: AST.Render) => boolean,
): AST.Render {
  const render = renders.find(candidate => AST.findOwningView(candidate)?.name === ownerName && guard(candidate))
  Assert.defined(render, `${ownerName} render occurrence`)
  return render
}

function studioOccurrence(render: AST.Render, sourcePath: string): string {
  return `studio: ${studioIdentity(render, sourcePath)}`
}

function studioIdentity(render: AST.Render, sourcePath: string): string {
  const cstNode = render.$cstNode
  Assert.defined(cstNode, 'render source coordinates')
  const elementName = ASTUtils.design.standardElementName(render)
  return `{
    sourcePath: ${JSON.stringify(sourcePath)},
    start: ${cstNode.offset},
    end: ${cstNode.end},
    kind: 'render',
    ${elementName === undefined ? '' : `elementName: ${JSON.stringify(elementName)},`}
    ownerName: ${JSON.stringify(AST.findOwningView(render)?.name)},
  }`
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ')
}
