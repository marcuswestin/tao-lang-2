import { AST } from '@parser'
import { Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { StudioSketchSource } from '../studio-src/StudioSketchSource'

Test('Studio sketch source is one flowed placeholder with one fixtureless focused draft cell', async () => {
  const source = await StudioSketchSource.generate({
    height: 76,
    name: 'View1',
    project: 'music',
    width: 360,
  })

  Expect(source).toBe(`use Placeholder from @tao/ui

public
view View1() {
   render Placeholder("View1") [width 360, height 76]
}

scenarios View1 "sketch" {
   device phone
   scenario "draft" {
      render ()
}  }
`)
  Expect(source).not.toContain('Rect')
  Expect(source).not.toContain(' at ')
  Expect(source).not.toContain('Canvas')

  await withTaoFiles('tao-studio-sketch-source-', {
    '@/studio/View1.tao': source,
    'App.tao': `
      use View1 from @/studio
      app Music { view View1 }
    `,
    'Project.tao': `project { id "music" name "Music" DefaultApp Music }`,
  }, async paths => {
    const parsed = await Workspace.parse(paths['App.tao'])
    const compiled = await Workspace.compile(paths['App.tao'], { studio: true })
    const generatedFile = parsed.files.find(file => file.path === paths['@/studio/View1.tao'])
    const view = generatedFile?.ast.statements.find(AST.isViewDeclaration)
    const scenario = compiled.studioManifest?.scenarios.find(candidate =>
      candidate.group === 'sketch' && candidate.name === 'draft'
    )

    Expect(view?.name).toBe('View1')
    Expect(scenario?.fixtureId).toBeUndefined()
    Expect(scenario).toMatchObject({
      environment: { device: { preset: 'phone' } },
      prepare: [],
      subject: { arguments: {}, kind: 'view', viewName: 'View1' },
    })
  })
})

Test('Studio sketch source rejects invalid names, dimensions, and project identities', async () => {
  const valid = { height: 76, name: 'View1', project: 'music', width: 360 }

  await Expect(StudioSketchSource.generate({ ...valid, name: 'Untitled 1' })).rejects.toThrow('ViewN')
  await Expect(StudioSketchSource.generate({ ...valid, name: 'View0' })).rejects.toThrow('above zero')
  await Expect(StudioSketchSource.generate({ ...valid, width: 0 })).rejects.toThrow('width')
  await Expect(StudioSketchSource.generate({ ...valid, height: 76.5 })).rejects.toThrow('height')
  await Expect(StudioSketchSource.generate({ ...valid, project: '' })).rejects.toThrow('project')
  await Expect(StudioSketchSource.generate({ ...valid, project: 'music\nother' })).rejects.toThrow('project')
})
