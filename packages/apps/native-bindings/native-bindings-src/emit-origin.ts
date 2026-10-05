import { Assert, FS } from '@shared'
import type { NativeApiOriginOptions, NativeApiProvenance, NativeApiResolvedInput } from './native-api'

/** Physical links are relative to each emitted file; catalogs keep their portable semantic locations. */
export function nativeOriginEmitter(
  inputs: readonly NativeApiResolvedInput[],
  options: NativeApiOriginOptions & { taoOriginDirectory: string; typescriptOriginDirectory: string },
) {
  function comments(provenance: NativeApiProvenance): { tao: string[]; sidecar: string[] } {
    const matches = inputs.filter(input =>
      input.packageName === provenance.packageName && input.declaration === provenance.declaration
    )
    Assert.input(
      options.originDeclaration !== undefined || new Set(matches.map(input => input.filePath)).size <= 1,
      `Native origin '${provenance.packageName}/${provenance.declaration}' resolves to multiple physical declarations. Provide an originDeclaration resolver.`,
    )
    const declaration = options.originDeclaration === undefined
      ? matches[0]?.filePath
      : options.originDeclaration(provenance, matches[0])
    if (declaration === undefined) {
      return { tao: [], sidecar: [] }
    }
    Assert.input(
      FS.isAbsolute(declaration) && !/[\r\n]/.test(declaration),
      'A native origin resolver must return an absolute declaration path without line breaks.',
    )
    Assert.input(
      Number.isInteger(provenance.line) && provenance.line > 0
        && Number.isInteger(provenance.column) && provenance.column > 0,
      'A native origin must have a positive declaration line and column.',
    )
    function comment(directory: string): string {
      const relative = FS.relativePath(FS.resolvePath(directory), declaration!).replaceAll('\\', '/')
      const path = relative.startsWith('.') ? relative : `./${relative}`
      return `// Native origin: ${path}:${provenance.line}:${provenance.column}`
    }
    return { tao: [comment(options.taoOriginDirectory)], sidecar: [comment(options.typescriptOriginDirectory)] }
  }

  function decorate(
    lines: readonly string[],
    owners: ReadonlyMap<string, NativeApiProvenance>,
    language: 'tao' | 'sidecar',
  ): string[] {
    return lines.flatMap(line => {
      const declaration = line.match(/^(?:public (?:type|action)|(?:export )?(?:type|const|function)) (\w+)/)?.[1]
      const owner = declaration === undefined ? undefined : owners.get(declaration)
      return owner === undefined ? [line] : [...comments(owner)[language], line]
    })
  }

  return { comments, decorate }
}
