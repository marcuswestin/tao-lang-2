import { AST, Langium, Parser } from '@parser'
import { Assert, CLI, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { readAvailability, withReadAvailability } from '../../apps/runtime/TaoRuntime-src/TR-read-availability'
import { compileReactiveArgument } from '../compiler-src/codegen/react-native/app/reactive-parameters'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { Workspace } from '../compiler-src/workspace'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
const declarations = `
  data Authors / Author { Name text }
  func DescribeOptional(Person Author?) -> text { return DescribeOptional(Person) from ./Native.ts }
  view Text(Value text) { render inject Value \`\`\`ts return null \`\`\` }
  view Stack() { render inject Content @@content \`\`\`ts return Content \`\`\` }
`

Describe('compiler: optional entity guard continuation capture', () => {
  Test('typechecks the generated capture scope and runtime overload in the actual application graph', async () => {
    await withTaoFiles('tao-guard-continuation-capture-', {
      'Main.tao': `
        app GuardCapture { id "com.tao.guardcapture" version "1.0.0" name "Guard capture" view Home }
        data Authors / Author { Name text }
        view Text(Value text) { render inject Value \`\`\`ts void Value; return null \`\`\` }
        view Show(Person Author?) { render inject Person \`\`\`ts void Person; return null \`\`\` }
        view Stack() { render inject Content @@content \`\`\`ts return Content \`\`\` }
        view Home() { state Current = none render Main(Current) }
        view Main(Person Author?) {
          render Stack() {
            guard Person { none -> { Text("Unknown author") } }
            Show(Person)
          }
        }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      const output = FS.resolvePath('output', root)
      for (const file of compiled.files) {
        await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
      }
      Expect(compiled.files.some(file => file.code.includes('_Scope.Person = _TaoGuardSubject'))).toBe(true)
      await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
      const config = FS.resolvePath('tsconfig.json', root)
      await FS.writeJson(config, {
        extends: Repo.resolvePath('packages/tsconfig.base.json'),
        compilerOptions: {
          allowImportingTsExtensions: true,
          composite: false,
          declaration: false,
          incremental: false,
          jsx: 'react-jsx',
          lib: ['ES2023', 'DOM'],
          noEmit: true,
          rootDir: '/',
          typeRoots: [Repo.resolvePath('node_modules/@types')],
          types: ['bun', 'node'],
        },
        include: [`${output}/**/*.ts`, `${output}/**/*.tsx`],
      })
      const checked = await CLI.run('bun', {
        args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', config],
      })
      Assert(checked.exitCode === 0, 'compiled guard capture graph typechecks', {
        stdout: checked.stdout,
        stderr: checked.stderr,
      })
    })
  })

  Test('executes the real compiled continuation against the one sampled live parameter', async () => {
    const { code, file } = await compileGuard(
      `
      view Main(Person Author?) {
        render Stack() {
          guard Person { none -> { Text("Unknown author") } }
          Show(Person)
        }
      }
      view Host() { state Current = none render Main(Current) }
    `,
      declarations.replace(/  func DescribeOptional[^\n]+\n/, '')
        + '\nview Show(Person Author?) { render inject Person ```ts void Person; return null ``` }',
      true,
    )
    Expect(code).toContain('_TaoGuardSubject => TR.BlockScope(_Scope, _Scope => {')
    Expect(code).toContain('_Scope.Person = _TaoGuardSubject')
    const javascript = new Bun.Transpiler({ loader: 'tsx' }).transformSync(`return ${code.trim().slice(1, -1)}`)
    const jsxFactory = javascript.match(/\bjsxDEV_[a-z0-9]+\b/)?.[0]
    const fragment = javascript.match(/\bFragment_[a-z0-9]+\b/)?.[0]
    Expect(jsxFactory).toBeDefined()
    Expect(fragment).toBeDefined()
    const { default: TR } = await runtimeModule
    const original = { Name: 'Before' }
    let current: typeof original | null = original
    let reads = 0
    const live = TR.Mapped(
      () => {
        reads++
        const sampled = current
        current = null
        return TR.Value(sampled)
      },
      TR.Action((next: any) => {
        current = next.evaluate().jsValue
      }),
    )
    const host = file.statements.find(statement => AST.isViewDeclaration(statement) && statement.name === 'Host')
    Expect.Is(host, AST.isViewDeclaration)
    const caller = AST.streamAllContents(host).find(AST.isRender)
    Expect.Is(caller, AST.isRender)
    const argument = AST.argumentsOf(caller)[0]?.value
    Expect.Is(argument, AST.isValueReference)
    Expect.Is(argument.target.ref, AST.isStateDeclaration)
    const callerCode = Langium.toString(compileReactiveArgument(argument))
    const received = new Function('TR', '_Scope', `return ${callerCode}`)(TR, { Current: live })
    Expect(received).toBe(live)
    const scope = {
      Person: received,
      Text: () => undefined,
      Show: () => undefined,
    }
    const makeElement = (type: unknown, props: Record<string, any>) => ({ type, props })
    const rendered = new Function('TR', '_Scope', '_ViewProps', jsxFactory!, fragment!, '_TaoOutline', javascript)(
      TR,
      scope,
      {},
      makeElement,
      'fragment',
      {},
    )
    const text = rendered.props.children
    Expect(text.props.Person.evaluate().jsValue).toEqual(original)
    Expect(reads).toBe(1)
    Expect(current).toBe(null)
    Expect(scope.Person).toBe(live)
    Expect(scope.Person.evaluate().jsValue).toBe(null)
  })

  Test('keeps noneligible source identities and writable/copy parameters on their original binding', async () => {
    for (
      const source of [
        'view Main(mutable Person Author?) { render Stack() { guard Person { none -> {} } Text(DescribeOptional(Person)) } }',
        'view Main(copy Person Author?) { render Stack() { guard Person { none -> {} } Text(DescribeOptional(Person)) } }',
        'view Main(Person Author?) { let Live = Person render Stack() { guard Live { none -> {} } Text(DescribeOptional(Person)) } }',
        'view Main(Person Author?) { render Stack() { guard Person { none -> {} } let Person = none Text(DescribeOptional(Person)) } }',
        'view Main(Person Author?) { render Stack() { guard Person loading {} Text(DescribeOptional(Person)) } }',
      ]
    ) {
      const { code } = await compileGuard(source)
      Expect(code).not.toContain('_TaoGuardSubject')
    }
  })

  Test('keeps the prelude and an enclosing block outside the captured child scope', async () => {
    const { default: TR } = await runtimeModule
    for (
      const body of [
        'Text(DescribeOptional(Person)) guard Person { none -> {} } Text(DescribeOptional(Person))',
        'Stack() { guard Person { none -> {} } Text(DescribeOptional(Person)) } Text(DescribeOptional(Person))',
      ]
    ) {
      const code = await compileChildren(`view Main(Person Author?) { render Stack() { ${body} } }`)
      let current: { Name: string } | null = { Name: 'Before' }
      let reads = 0
      const live = TR.Readonly(TR.Alias(() => {
        reads++
        const sampled = current
        current = null
        return TR.Value(sampled)
      }))
      const scope = {
        Person: live,
        Stack: () => undefined,
        Text: () => undefined,
        DescribeOptional: TR.Function((value: any) => TR.Value(value.evaluate().jsValue?.Name ?? 'absent')),
      }
      const rendered = runChildren(code, TR, scope)
      const values: string[] = []
      const visit = (node: any): void => {
        if (Array.isArray(node)) {
          node.forEach(visit)
          return
        }
        if (!node?.props) {
          return
        }
        if (node.type === scope.Text) {
          values.push(node.props.Value.evaluate().jsValue)
        } else {
          visit(node.props.children)
        }
      }
      visit(rendered)
      Expect(values.toSorted()).toEqual(['Before', 'absent'])
      Expect(scope.Person).toBe(live)
      Expect(reads).toBe(2)
    }
  })

  Test('does not capture an exceptional handler binding', async () => {
    const { code } = await compileGuard(`
      view Main(Person Author?) {
        render Stack() {
          guard Person { none -> { Text(DescribeOptional(Person)) } }
          Text("tail")
        }
      }
    `)
    const { default: TR } = await runtimeModule
    let current: { Name: string } | null = null
    const live = TR.Readonly(TR.Alias(() => {
      const sampled = current
      current = { Name: 'After' }
      return TR.Value(sampled)
    }))
    const scope = {
      Person: live,
      Text: () => undefined,
      DescribeOptional: TR.Function((value: any) => TR.Value(value.evaluate().jsValue?.Name ?? 'absent')),
    }
    const rendered = runChildren(code.trim().slice(1, -1), TR, scope, false)
    Expect(rendered.props.children.props.Value.evaluate().jsValue).toBe('After')
    Expect(scope.Person).toBe(live)
  })

  Test('passes a completed sampled wrapper to the guard remainder and preserves ordinary when callbacks', async () => {
    const { default: TR } = await runtimeModule
    const value = withReadAvailability(TR.Value({ Name: 'Before' }), { status: 'available' })
    let captured: unknown
    const result = TR.GuardRender(
      value,
      [],
      sampled => {
        captured = sampled
        return 'tail'
      },
      undefined,
      undefined,
      true,
    )
    Expect(result).toBe('tail')
    Expect(captured).toBe(value)
    Expect(readAvailability(captured)).toEqual({ status: 'available' })
    Expect(TR.WhenReadRender(value, [], function() {
      return arguments.length
    })).toBe(0)
    Expect(TR.GuardRender(value, [], () => 'old callback')).toBe('old callback')
    Expect(TR.GuardRender(value, [], function() {
      return arguments.length
    })).toBe(0)
  })
})

function runChildren(code: string, runtime: unknown, scope: Record<string, unknown>, fragment = true): any {
  const javascript = new Bun.Transpiler({ loader: 'tsx' }).transformSync(
    fragment ? `return <>${code}</>` : `return ${code}`,
  )
  const jsxFactory = javascript.match(/\bjsxDEV_[a-z0-9]+\b/)?.[0]
  const jsxFragment = javascript.match(/\bFragment_[a-z0-9]+\b/)?.[0]
  Expect(jsxFactory).toBeDefined()
  Expect(jsxFragment).toBeDefined()
  const makeElement = (type: unknown, props: Record<string, unknown>) => ({ type, props })
  return new Function('TR', '_Scope', '_ViewProps', jsxFactory!, jsxFragment!, '_TaoOutline', javascript)(
    runtime,
    scope,
    {},
    makeElement,
    'fragment',
    {},
  )
}

async function compileChildren(source: string): Promise<string> {
  const parsed = await Parser.parseCode(declarations + source, { validation: false })
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  const owner = parsed.entry.ast.statements.find(statement =>
    AST.isViewDeclaration(statement) && statement.name === 'Main'
  )
  Expect.Is(owner, AST.isViewDeclaration)
  const render = AST.streamAllContents(owner).find(AST.isRender)
  Expect.Is(render, AST.isRender)
  Expect.Is(render.block, AST.isBlock)
  return Langium.toString(Compile.RenderBlockFragments(render.block.statements.filter(AST.isRenderFragment)))
}

async function compileGuard(source: string, prefix = declarations, validation = false) {
  const parsed = await Parser.parseCode(prefix + source, { validation })
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  const guard = AST.streamAllContents(parsed.entry.ast).find(AST.isGuardRenderStatement)
  Expect.Is(guard, AST.isGuardRenderStatement)
  Expect.Is(guard.$container, AST.isBlock)
  const remaining = guard.$container.statements.slice(guard.$container.statements.indexOf(guard) + 1)
    .filter(AST.isRenderFragment)
  return { guard, file: parsed.entry.ast, code: Langium.toString(Compile.GuardRenderStatement(guard, remaining)) }
}
