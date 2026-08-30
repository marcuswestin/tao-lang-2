import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'

const tsFence = '```ts'
const fence = '```'

Describe('compiler: Studio render occurrences', () => {
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

        fixture StudioCards {
          Lead = create Account { Name: "Ada" }
        }
        scenario OwnerCard.lead {
          fixture StudioCards
          render OwnerCard(Owner: Lead)
          device phone
          appearance dark
          network offline
          locale pseudolocale
          direction rightToLeft
        }
      `,
      'More.tao': `
        workspace data Accounts / Account { Name text }
        workspace view Detail(Label text) { render inject ${tsFence} return null ${fence} }
      `,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { studio: true })
      const manifest = compiled.studioManifest

      Expect(manifest?.formatVersion).toBe(1)
      Expect(manifest?.selectedAppName).toBe('Preview')
      Expect(manifest?.views.map(view => view.name)).toEqual(['Main', 'Card', 'Native', 'OwnerCard', 'Detail'])
      Expect(manifest?.views.find(view => view.name === 'Card')?.parameters).toEqual([
        { kind: 'text', name: 'Title', required: true, typeName: 'text' },
        { kind: 'boolean', name: 'Enabled', required: true, typeName: 'boolean' },
        { choices: ['Neutral', 'Good'], kind: 'choice', name: 'Tone', required: true, typeName: 'Tone' },
        { kind: 'time', name: 'ChangedAt', required: true, typeName: 'time' },
        { kind: 'unsupported', name: 'Owner', required: true, typeName: 'Account' },
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
        name: 'OwnerCard.lead',
        subject: {
          arguments: { Owner: { handle: 'Lead', kind: 'fixture-reference' } },
          kind: 'view',
          viewName: 'OwnerCard',
        },
      })

      const generated = compiled.files.find(file => file.relativePath === 'TaoStudioManifest.ts')
      Expect(generated?.code).toContain('"formatVersion":1')
      Expect(generated?.code).toContain(JSON.stringify(paths['Main.tao']))
      Expect(compiled.code).toContain(
        "import { _TaoDataCatalog, Accounts, Detail } from './modules/More.tao'",
      )
      Expect(compiled.code).toContain('TR.Studio.Environment.useScenario()')
      Expect(compiled.code).toContain('TR.Studio.Environment.useFixture(_Scope._TaoDataCatalog)')
      Expect(compiled.code).toContain(`${JSON.stringify(`${paths['Main.tao']}#OwnerCard`)}: _Scope.OwnerCard`)
      Expect(compiled.code).toContain('React.createElement(_TaoStudioView, _TaoStudioArgs)')

      const production = await Workspace.compile(paths['Main.tao'])
      Expect(production.studioManifest).toBeUndefined()
      Expect(production.files.some(file => file.relativePath === 'TaoStudioManifest.ts')).toBe(false)
      Expect(production.code).not.toContain('TR.Studio.Environment.useScenario()')
    })
  })
})

function requireRender(
  renders: readonly AST.Render[],
  ownerName: string,
  guard: (render: AST.Render) => boolean,
): AST.Render {
  const render = renders.find(candidate => AST.findOwningView(candidate)?.name === ownerName && guard(candidate))
  if (render === undefined) {
    throw new Error(`Expected ${ownerName} render occurrence.`)
  }
  return render
}

function studioOccurrence(render: AST.Render, sourcePath: string): string {
  const cstNode = render.$cstNode
  if (cstNode === undefined) {
    throw new Error('Expected render source coordinates.')
  }
  return `studio: {
    sourcePath: ${JSON.stringify(sourcePath)},
    start: ${cstNode.offset},
    end: ${cstNode.end},
    kind: 'render',
    ownerName: ${JSON.stringify(AST.findOwningView(render)?.name)},
  }`
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ')
}
