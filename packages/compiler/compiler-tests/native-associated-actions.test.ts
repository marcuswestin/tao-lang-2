import { ASTUtils } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST, Langium, Parser } from '@parser'
import { Assert, CLI, Diagnostics, Errors, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { foreignActionBindingName } from '../compiler-src/codegen/react-native/app/injection-plan'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { TestCompiler as Compiler } from './test-compile'

const { default: TR } = await import(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))

Describe('compiler: native associated actions', () => {
  Test('retains generic capability action dispatch through failure handlers and joined cleanup', async () => {
    const parsed = await Parser.parseCode(`
      can Readable { action Read() -> text }
      can Closable { action Close() }
      type Handle is { Path text } with {
        action Read() returns text from ./Native.ts
        action Close() from ./Native.ts
      }
      view ReadView where type T is Readable and Closable (Value T) {
        state Outcome = "pending"
        action Run() {
          defer { do Value.Close() }
          do Value.Read() then {
            done -> { set Outcome = "saved" }
            error -> { set Outcome = "handled" }
          }
          return Outcome
        }
        render inject \`\`\`ts return null \`\`\`
      }
      view Main(Provided Handle) { render ReadView(.Value Provided) }
    `)
    Expect(Diagnostics.errorMessages(parsed.diagnostics)).toEqual([])
    const view = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'ReadView')
    Expect.Is(view, AST.isViewDeclaration)
    Assert.defined(view.block, 'the generic view has an authored action body')
    const run = view.block.statements.find(AST.isActionDeclaration)
    Expect.Is(run, AST.isActionDeclaration)
    const effects = ASTUtils.createAssociatedEffects([parsed.entry.ast])
    Assert.defined(effects, 'generic capability contracts are sealed before action emission')
    const handle = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Handle')
    Expect.Is(handle, AST.isTypeDeclaration)
    const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
    Expect.Is(main, AST.isViewDeclaration)
    Assert.defined(main.block, 'the concrete caller has an authored render')
    const render = main.block.statements.find(AST.isRenderStatement)
    Expect.Is(render, AST.isRenderStatement)
    const code = ASTUtils.withAssociatedEffects(
      effects,
      () =>
        withAssociatedWitnessBindings(new Map([[handle, '_TaoHandleWitness']]), () => {
          const prop = Langium.toString(Compile.RenderArguments(ASTUtils.resolveRenderInvocation(render))).trim()
          Assert(prop.startsWith('Value={') && prop.endsWith('}'), 'the generic view receives one transported prop')
          return `${Langium.toString(Compile.AssociatedMethodsDeclaration(handle))}\n`
            + `_Scope.Value = ${prop.slice('Value={'.length, -1)}\n`
            + Langium.toString(Compile.ActionDeclaration(run))
        }),
    )
    const events: string[] = []
    const actions = AST.ownAssociatedActions(handle)
    const read = actions.find(action => action.name === 'Read')
    const close = actions.find(action => action.name === 'Close')
    Expect.Is(read, AST.isActionDeclaration)
    Expect.Is(close, AST.isActionDeclaration)
    const native = { Path: 'fail' }
    const scope: Record<string, any> = {
      Provided: TR.Value(native),
      Outcome: TR.Cell(TR.Value('pending')),
    }
    new Function(
      'TR',
      '_Scope',
      '_TaoActionOwner',
      foreignActionBindingName(read),
      foreignActionBindingName(close),
      new Bun.Transpiler({ loader: 'ts' }).transformSync(code),
    )(
      TR,
      scope,
      undefined,
      (receiver: typeof native) => {
        Expect(receiver === native).toBe(true)
        events.push('Read')
        Errors.throwHostEnvironment('Read failed')
      },
      (receiver: typeof native) => {
        Expect(receiver === native).toBe(true)
        events.push('Close')
      },
    )
    Expect(events).toEqual([])
    const result = await TR.DoResult(scope['Run'])
    Expect(result.evaluate().jsValue).toBe('handled')
    Expect(events).toEqual(['Read', 'Close'])
  })

  Test('checks stable owner-qualified foreign exports with receiver-first instance contracts', async () => {
    const compiled = await Compiler.compileCode(`
      type File is { Path text } with {
        static action Construct(Path text) returns File from ./Native.ts
        action Open() returns text from ./Native.ts
      }
      app Demo { id "com.tao.native.contract" version "1.0.0" name "Native contract" view Main }
      view Main() { render inject \`\`\`ts return null \`\`\` }
    `)
    const contracts = BridgeMetadata.collect(compiled.validation.files, '/').map(file => file.code).join('\n')
    Expect(contracts).toContain('typeof Sidecar.File_Construct')
    Expect(contracts).toContain('typeof Sidecar.File_Open')
    Expect(contracts).toContain('receiver: { "Path": string }')
    Expect(compiled.code).toContain('File_Construct as __tao_foreign_action_Construct_1__')
    Expect(compiled.code).toContain('File_Open as __tao_foreign_action_Open_2__')
  })

  Test('runs static constructors and captured instance actions with result and deferred cleanup', async () => {
    await withTaoFiles('tao-native-associated-actions-', {
      'Main.tao': `
        use ReadFile, ReadHandled from ./Files
        app Demo { id "com.tao.native.actions" version "1.0.0" name "Native actions" view Main }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Files.tao': `
        type File is { Path text } with {
          static action Construct(Path text) returns File from ./Native.ts
          action Open() returns Handle from ./Native.ts
        }
        type Handle is { Path text } with {
          action Read() returns text from ./Native.ts
          action Close() from ./Native.ts
        }
        action Observe(Label text) from ./Native.ts
        public action ReadFile(Path text) {
          let Source = do File.Construct(Path)
          let Opened = do Source.Open()
          defer { do Opened.Close() }
          let Read = Opened.Read
          let Value = do Read()
          return Value
        }
        public action ReadHandled(Path text) {
          do ReadFile(Path) then {
            done -> { do Observe("done") }
            error -> { do Observe("handled") }
          }
          return "handled"
        }
      `,
      'Native.ts': `
        import * as Errors from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/core/Errors.ts'))}
        const calls: string[] = []
        export function File_Construct(path: string) { calls.push("construct:" + path); return { Path: path } }
        export function File_Open(file: { Path: string }) { calls.push("open:" + file.Path); return file }
        export function Handle_Read(handle: { Path: string }) {
          calls.push("read:" + handle.Path)
          if (handle.Path === "fail") Errors.throwHostEnvironment("Read failed")
          return handle.Path
        }
        export function Handle_Close(handle: { Path: string }) { calls.push("close:" + handle.Path) }
        export function Observe(label: string) { calls.push(label) }
        export function Calls() { return calls }
      `,
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      const output = FS.resolvePath('output', root)
      for (const file of compiled.files) {
        await FS.writeText(FS.resolvePath(file.relativePath, output), file.code)
      }
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
      Assert(checked.exitCode === 0, 'the nominal action graph and receiver-first sidecar contracts typecheck', {
        stdout: checked.stdout,
        stderr: checked.stderr,
      })
      const source = compiled.files.find(file =>
        file.sourcePath === paths['Files.tao'] && file.relativePath.endsWith('.tsx')
      )
      const native = compiled.files.find(file => file.sourcePath === paths['Native.ts'])
      Assert.defined(source, 'the nominal action source module is emitted')
      Assert.defined(native, 'the nominal action sidecar is emitted')
      const actions = await import(FS.resolvePath(source.relativePath, output))
      const probe = await import(FS.resolvePath(native.relativePath, output))
      const result = await TR.DoResult(actions.ReadFile, TR.Value('ok'))
      Expect(result.evaluate().jsValue).toBe('ok')
      await Expect(Promise.resolve(TR.DoResult(actions.ReadFile, TR.Value('fail')))).rejects.toThrow('Read failed')
      const handled = await TR.DoResult(actions.ReadHandled, TR.Value('fail'))
      Expect(handled.evaluate().jsValue).toBe('handled')
      Expect(probe.Calls()).toEqual([
        'construct:ok',
        'open:ok',
        'read:ok',
        'close:ok',
        'construct:fail',
        'open:fail',
        'read:fail',
        'close:fail',
        'construct:fail',
        'open:fail',
        'read:fail',
        'close:fail',
        'handled',
      ])
    })
  })
})
