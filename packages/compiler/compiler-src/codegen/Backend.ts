import type { AST } from '@parser'
import type { ValidationResult } from '@validator'
import type { CompileOptions, CompilerContext, CompileResult } from '../compiler'
import { ReactNativeBackend } from './react-native/Backend'
import { SwiftUIBackend } from './swiftui/Compile'

/** Backend receives a validated graph after shared app selection, before target-specific planning. */
export type Backend = {
  compile(input: {
    validation: ValidationResult
    context: CompilerContext
    app: AST.AppValueDeclaration
    appPath: string
    options: CompileOptions
  }): CompileResult
}

/** Backends is the target dispatch boundary; omitted targets retain the React Native backend. */
export const Backends = {
  'react-native': ReactNativeBackend,
  watchos: SwiftUIBackend,
} as const
