import { AST } from '@parser'
import { Assert } from '@shared'
import type { TargetCapabilities } from '@validator/validators/target-capabilities-validator'
import type { CompiledFile } from '../../../compiler'
import { Compile } from '../Compile'

export const AppCompiler = {
  App(app: AST.AppDeclaration, profile: TargetCapabilities): CompiledFile[] {
    const navigator = app.block!.statements.find(statement =>
      AST.isAppProperty(statement) && statement.name === 'Navigator'
    )
    Assert(
      AST.isAppProperty(navigator) && AST.isConfigurationConstructor(navigator.value),
      'validated Swift app has a navigator',
    )
    const initial = navigator.value.block!.entries.find(entry => entry.name === 'Initial')!.value
    Assert(
      AST.isConfigurationReference(initial) && AST.isViewDeclaration(initial.target.ref),
      'validated Swift navigator has a scene',
    )
    const scene = initial.target.ref
    const sourcePath = AST.getDocument(app).uri.fsPath
    return [
      {
        sourcePath,
        relativePath: 'WatchApp.swift',
        code:
          `import SwiftUI\n\n@main\nstruct TaoWatchApp: App {\n    var body: some Scene {\n        WindowGroup {\n            NavigationStack {\n                TaoScene_${scene.name}()\n            }\n        }\n    }\n}\n`,
      },
      {
        sourcePath: AST.getDocument(scene).uri.fsPath,
        relativePath: `TaoScene_${scene.name}.swift`,
        code: Compile.Scene(scene, profile),
      },
    ]
  },
} as const
