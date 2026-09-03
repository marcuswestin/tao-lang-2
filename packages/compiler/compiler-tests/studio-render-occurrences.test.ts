import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'

const tsFence = '```ts'
const fence = '```'

Describe('compiler: Studio render occurrences', () => {
  Test('publishes an imported shared fixture without a runtime import binding', async () => {
    await withTaoFiles('tao-studio-shared-fixture-', {
      'Data.tao': `public data Playlists / Playlist { Title text }`,
      'Main.tao': `
        use Playlists from ./Data
        use Sketches from ./Sketches
        app Preview { view Main }
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
        use Playlists from ./Data
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
        app Preview { view Main }
        view Main() { render Native() }
        view SavedToast(Revert action()) { render Native() }
        view Native() { render inject ${tsFence} return null ${fence} }

        scenarios SavedToast "states" {
          device phone
          scenario "held" {
            render ()
            press down label "Revert"
            advance 600.ms
            press up #revertSave
            hover placeholder "Revert save"
            focus #revertSave
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
          { kind: 'advance', milliseconds: 600 },
          { kind: 'pressUp', selector: 'tag', target: 'revertSave' },
          { kind: 'hover', selector: 'placeholder', target: 'Revert save' },
          { kind: 'focus', tag: 'revertSave' },
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

        app First { view Main }
        app Second { view Alternate }

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
      Expect(code).toContain('designSpec: TR.Design.Spec([["gap",12]])')
      Expect(code).toContain('testTag: "selected"')
      Expect(code).toContain('...TR.TaoContext(_ViewProps.__tao)')
      Expect(code).toContain('}, _ViewProps.__tao)')
      Expect(code).toContain('TR.Navigation.Ask(')
      Expect(code).toContain('TR.Navigation.Respond(')
      Expect(compiled.appNames).toEqual(['First', 'Second'])
      Expect(code).toContain('export default TaoApps["Second"]')

      const production = await Workspace.compile(paths['Main.tao'], { appName: 'Second' })
      Expect(production.code).not.toContain('studio:')
      Expect(production.code).not.toContain(paths['Main.tao'])
    })
  })

  Test('publishes Snap rectangle identity in the render inventory and generated occurrence metadata', async () => {
    await withTaoFiles('tao-studio-render-inventory-', {
      'Main.tao': `
        use Text from @tao/ui
        app Preview { view Main }
        view Main() {
          #studio_rect_006100720074
          render Text("Hello")
        }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })
      const render = [...AST.streamAllContents(compiled.validation.entry.ast).filter(AST.isRender)][0]!
      const source = render.$cstNode!

      Expect(compiled.studioManifest?.renders).toEqual([{
        elementName: 'Text',
        renderId: `${paths['Main.tao']}:${source.offset}:${source.end}`,
        source: { end: source.end, path: paths['Main.tao'], start: source.offset },
        studioRectId: 'art',
      }])
      Expect(compact(compiled.code)).toContain('elementName: "Text", studioRectId: "art",')
    })
  })

  Test('publishes source-owned view schemas only for Studio compilations', async () => {
    await withTaoFiles('tao-studio-preview-manifest-', {
      'Main.tao': `
        type Tone is one of Neutral, Good
        use Accounts, Detail from ./More.tao

        app Preview { view Main }
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
        workspace data Accounts / Account { Name text }
        workspace view Detail(Label text) { render inject ${tsFence} return null ${fence} }
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
      Expect(generated?.code).toContain(JSON.stringify(paths['Main.tao']))
      Expect(compiled.code).toContain(
        "import { _TaoDataCatalog, Accounts, Detail } from './modules/More.tao'",
      )
      Expect(compiled.code).toContain('TR.Studio.Environment.useScenario()')
      Expect(compiled.code).toContain('TR.Studio.Environment.useFixture(_Scope._TaoDataCatalog)')
      Expect(compiled.code).toContain(
        `${JSON.stringify(`${paths['Main.tao']}#OwnerCard`)}: TR.Navigation.ViewReference(`,
      )
      Expect(compiled.code).toContain(
        '<TR.Studio.FocusedViewHost',
      )
      Expect(compiled.code).toContain('app={_TaoAppDefinition_Preview}')
      Expect(compiled.code).toContain('arguments={_TaoStudioArgs}')
      Expect(compiled.code).toContain('occurrence={_TaoStudioScenario}')
      Expect(compiled.code).toContain('view={_TaoStudioView}')

      const production = await Workspace.compile(paths['Main.tao'])
      Expect(production.studioManifest).toBeUndefined()
      Expect(production.files.some(file => file.relativePath === 'TaoStudioManifest.ts')).toBe(false)
      Expect(production.code).not.toContain('TR.Studio.Environment.useScenario()')
    })
  })

  Test('publishes entity and case generation declarations for Studio fixture generation', async () => {
    await withTaoFiles('tao-studio-generation-manifest-', {
      'Main.tao': `
        type DocumentKind is one of Note, Article, "Other"

        workspace
        data Workspaces / Workspace {
          Name text (required "Use a realistic workspace name.")
          Summary text?
          CreatedAt time (default now)
          Pinned yes / no
          Documents (owned)
        }

        workspace
        data Documents / Document {
          Title text (default "Untitled")
          Score number (default 0)
          Public yes / Private no (default Public)
          Workspace
        }

        app Preview { view Main }
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
      const generated = compiled.files.find(file => file.relativePath === 'TaoStudioManifest.ts')
      Expect(generated?.code).toContain('"generationDeclarations"')
      Expect(generated?.code).toContain('"guidance":"Use a realistic workspace name."')

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
  const cstNode = render.$cstNode
  Assert.defined(cstNode, 'render source coordinates')
  const elementName = ASTUtils.standardDesignElementName(render)
  return `studio: {
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
