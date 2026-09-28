import { AST } from '@parser'
import { Assert, Diagnostics, FS, TaoResources } from '@shared'
import type { ValidationResult } from '@validator'
import {
  type TargetCapabilities,
  TargetCapabilitiesValidator,
} from '@validator/validators/target-capabilities-validator'
import type { CompileOptions, CompilerContext, CompileResult } from '../../compiler'
import type { Backend } from '../Backend'
import { AppCompiler } from './app/AppCompiler'
import { ExpressionsCompiler } from './app/ExpressionsCompiler'
import { ViewsCompiler } from './app/ViewsCompiler'

/** Compile owns AST emission for the SwiftUI backend. */
export const Compile = { ...AppCompiler, ...ExpressionsCompiler, ...ViewsCompiler } as const

/** SwiftUIBackend owns native watchOS capability validation and Swift artifacts. */
export const SwiftUIBackend: Backend = {
  compile: ({ validation, context, app, options }) => compileSwiftUI(validation, context, app, options),
}

/** compileSwiftUI validates the selected native graph before emitting any Swift artifacts. */
function compileSwiftUI(
  validation: ValidationResult,
  context: CompilerContext,
  app: AST.AppValueDeclaration,
  options: CompileOptions,
): CompileResult {
  const profile = capabilities(validation, context)
  const diagnostics = TargetCapabilitiesValidator.validate(app, profile, {
    packagesContext: context.packagesContext,
    workspaceFiles: validation.files.map(file => file.ast),
    entryFilePath: validation.entry.path,
  })
  validation = { ...validation, diagnostics: [...validation.diagnostics, ...diagnostics] }
  const errors = Diagnostics.errorMessages(diagnostics)
  Assert.input(errors.length === 0, `Cannot compile Tao source for watchos: ${errors.join('; ')}`, {
    diagnostics: Diagnostics.errors(diagnostics),
    errors,
  })
  Assert.input(
    !options.studio && !options.debug && !options.journeyObservations && !options.appDatasourceConfiguration,
    'watchos does not support Studio, debugger, journey instrumentation, or datasource overrides yet.',
  )
  Assert(AST.isAppDeclaration(app), 'validated watch app is a direct app declaration')
  const files = Compile.App(app, profile)
  const name = app.block?.statements.find(statement => AST.isAppProperty(statement) && statement.name === 'Name')
  const displayName = AST.isAppProperty(name) && AST.isStringLiteral(name.value) ? name.value.value : undefined
  const runtimePath = TaoResources.resolve(`${TaoResources.RUNTIME_DIRECTORY}/swiftui/TaoValues.swift`)
    ?? FS.resolvePath('../../../../apps/runtime/swiftui/TaoValues.swift', import.meta.dirname)
  files.push({ sourcePath: runtimePath, relativePath: 'TaoValues.swift', code: FS.readTextSync(runtimePath) })
  return {
    target: 'watchos',
    entryArtifact: 'WatchApp.swift',
    ...(displayName === undefined ? {} : { displayName }),
    code: files[0]!.code,
    files,
    validation,
    appNames: validation.files.flatMap(file =>
      AST.appValueDeclarationsInFile(file.ast).map(candidate => candidate.name)
    ),
  }
}

function capabilities(validation: ValidationResult, context: CompilerContext): TargetCapabilities {
  const bindings = new Map<AST.Node, 'StackNav' | 'ScrollView' | 'Col' | 'Text' | 'FormButton'>()
  const nativeFiles = {
    '@tao/ui/Views.tao': ['ScrollView', 'Col', 'Text'],
    '@tao/ui/native/Native.tao': ['FormButton'],
    '@tao/nav/native/Navigation.tao': ['StackNav'],
  } as const
  for (const [relative, names] of Object.entries(nativeFiles)) {
    const file = validation.files.find(file =>
      file.path === FS.resolvePath(relative, context.packagesContext.stdlibRoot)
    )
    for (const declaration of file?.ast.statements ?? []) {
      if (
        (AST.isViewDeclaration(declaration) || AST.isTypeDeclaration(declaration))
        && (names as readonly string[]).includes(declaration.name)
      ) {
        bindings.set(declaration, declaration.name as 'StackNav' | 'ScrollView' | 'Col' | 'Text' | 'FormButton')
      }
    }
  }
  // Re-exported aliases retain the native declaration's identity; an unrelated same-name view does not.
  const declarations = validation.files.flatMap(file => file.ast.statements)
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) {
      if ((AST.isViewDeclaration(declaration) || AST.isTypeDeclaration(declaration)) && declaration.aliasTarget) {
        const binding = bindings.get(declaration.aliasTarget.member.ref!)
        if (binding && !bindings.has(declaration)) {
          bindings.set(declaration, binding)
          changed = true
        }
      }
    }
  }
  return { target: 'watchos', bindings }
}
