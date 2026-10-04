import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: package publications and requirements', () => {
  Test('parses named and unnamed publications with included modules', async () => {
    const result = await testParseSyntax(`
      package { version 1.0.0 license AGPL-3.0-only includes @ui @icons }
      package { name "Widget Package Foo" version "2.0.0-beta.1" includes @icons }
    `)
    const publications = result.entry.ast.statements.filter(AST.isPackageDeclaration)
    Expect(publications).toHaveLength(2)
    Expect(publications.map(publication => publication.block.statements.find(AST.isPackageName)?.value)).toEqual([
      undefined,
      'Widget Package Foo',
    ])
    Expect(
      publications.map(publication =>
        publication.block.statements.filter(AST.isPackageIncludes).flatMap(includes => includes.modules)
      ),
    ).toEqual([['@ui', '@icons'], ['@icons']])
  })

  Test('preserves requirement names, versions, modules, and aliases', async () => {
    const result = await testParseSyntax(`
      package {
        version 1.0.0
        requires ../widget-library version ^1.0.0 { @ui as @widgets @icons as @widget-icons }
        requires "Widget Package Foo" from ../widget-library version ^2.0.0 { @icons as @extra-icons }
        requires ts npm:date-fns version 4.1.0 as date-fns-v4
      }
    `)
    const [publication] = result.entry.ast.statements
    Expect.Is(publication, AST.isPackageDeclaration)
    const requirements = publication.block.statements.filter(AST.isPackageRequires)
    Expect(requirements.map(requirement => ({
      name: requirement.name,
      locator: requirement.locator,
      npm: requirement.npm,
      version: requirement.version,
      alias: requirement.alias,
      bindings: requirement.bindings?.bindings.map(binding => [binding.module, binding.alias]),
    }))).toEqual([
      {
        name: undefined,
        locator: '../widget-library',
        npm: undefined,
        version: '^1.0.0',
        alias: undefined,
        bindings: [['@ui', '@widgets'], ['@icons', '@widget-icons']],
      },
      {
        name: 'Widget Package Foo',
        locator: '../widget-library',
        npm: undefined,
        version: '^2.0.0',
        alias: undefined,
        bindings: [['@icons', '@extra-icons']],
      },
      {
        name: undefined,
        locator: undefined,
        npm: 'npm:date-fns',
        version: '4.1.0',
        alias: 'date-fns-v4',
        bindings: undefined,
      },
    ])
  })

  Test('parses app metadata and inherited requirements in a with block', async () => {
    const result = await testParseSyntax(`
      app Base { id "base" version "1.0.0-beta.1" name "Base" }
      let Variant = Base with {
        id "variant"
        requires ../widget-library version ^1.0.0 { @ui as @widgets }
      }
    `)
    const [base, variant] = result.entry.ast.statements
    Expect.Is(base, AST.isAppDeclaration)
    Expect(AST.blockStatements(base).filter(AST.isAppProperty).map(property => property.name))
      .toEqual(['id', 'version', 'name'])
    Expect.Is(variant, AST.isAliasDeclaration)
    Expect.Is(variant.value, AST.isRefinementExpression)
    Expect(variant.value.patchBlock.entries.map(entry => entry.requirement?.version))
      .toContain('^1.0.0')
  })

  Test('parses an app-owned npm requirement before its root view', async () => {
    const result = await testParseSyntax(`
      view Root() { render inject \`\`\`ts return null \`\`\` }
      app Reader {
        id "reader"
        version "1.0.0"
        name "Reader"
        requires ts npm:date-fns version 4.1.0 as date-fns-v4
        view Root
      }
    `)
    const app = result.entry.ast.statements.find(AST.isAppDeclaration)
    Expect.Is(app, AST.isAppDeclaration)
    Expect(AST.blockStatements(app).filter(AST.isPackageRequires).map(requirement => requirement.alias))
      .toEqual(['date-fns-v4'])
    Expect(AST.blockStatements(app).filter(AST.isAppView)).toHaveLength(1)
  })
})
