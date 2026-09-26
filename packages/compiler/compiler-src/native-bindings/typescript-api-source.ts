import { Assert, Errors, FS, Platform, Repo, TaoResources } from '@shared'
import type * as TS from 'typescript'
import type {
  NativeApiCatalog,
  NativeApiDiagnostic,
  NativeApiEnum,
  NativeApiImport,
  NativeApiOperation,
  NativeApiSource,
  NativeApiType,
} from './native-api'

type EnumReflection = { declaration: NativeApiEnum; types: readonly TS.Type[] }

/** readTypeScriptApi resolves public exports without loading or executing the native package. */
export async function readTypeScriptApi(
  source: string,
  request: NativeApiImport,
): ReturnType<NativeApiSource['read']> {
  const resourceRoot = TaoResources.declaredRoot()
  const typescriptPath = resourceRoot === undefined
    ? Repo.resolvePath('node_modules/typescript/lib/typescript.js')
    : FS.resolvePath(
      `../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
      resourceRoot,
    )
  const ts = require(typescriptPath) as typeof TS
  const configPath = ts.findConfigFile(request.fromDirectory, ts.sys.fileExists)
  const inherited = configPath === undefined ? undefined : ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  })
  const options: TS.CompilerOptions = {
    ...inherited?.options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  }
  const resolved = ts.resolveModuleName(
    request.packageName,
    FS.resolvePath('__native_binding_import__.ts', request.fromDirectory),
    options,
    ts.sys,
  ).resolvedModule
  Assert.input(resolved !== undefined, `Cannot resolve installed declarations for '${request.packageName}'.`)
  const program = ts.createProgram([resolved.resolvedFileName], options)
  const syntaxErrors = program.getSyntacticDiagnostics()
  Assert.input(
    syntaxErrors.length === 0,
    ts.formatDiagnostics(syntaxErrors, {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => request.fromDirectory,
      getNewLine: () => '\n',
    }),
  )
  const checker = program.getTypeChecker()
  const file = program.getSourceFile(resolved.resolvedFileName)
  Assert.defined(file, 'resolved native API declaration exists')
  const module = checker.getSymbolAtLocation(file)
  Assert.input(module !== undefined, `'${request.packageName}' has no public TypeScript module exports.`)
  const unalias = (symbol: TS.Symbol): TS.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const exported = runtimeExports(ts, program, options, request, checker.getExportsOfModule(module))
  const diagnostics: NativeApiDiagnostic[] = []
  const enums: EnumReflection[] = []
  for (const symbol of exported) {
    const actual = unalias(symbol)
    if (!(actual.flags & ts.SymbolFlags.Enum)) {
      continue
    }
    const declaration = actual.declarations?.find(ts.isEnumDeclaration)
    if (declaration === undefined) {
      continue
    }
    if (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Const) {
      diagnostics.push({ symbol: symbol.name, reason: 'Const enums may not have a runtime export.' })
      continue
    }
    const members = declaration.members.map(member => ({
      name: member.name.getText().replace(/^['"]|['"]$/g, ''),
      value: checker.getConstantValue(member),
    }))
    if (members.some(member => member.value === undefined)) {
      diagnostics.push({ symbol: symbol.name, reason: 'Enum members require constant string or number values.' })
      continue
    }
    const type = checker.getDeclaredTypeOfSymbol(actual)
    enums.push({
      declaration: {
        name: symbol.name,
        members: members.map(member => {
          Assert.defined(member.value, 'checked enum member has a value')
          return { name: member.name, value: member.value }
        }),
      },
      types: type.isUnion() ? type.types : [type],
    })
  }
  let candidates = exported
  if (request.exportName !== undefined) {
    const selected = exported.find(symbol => symbol.name === request.exportName)
    Assert.input(
      selected !== undefined,
      `Package '${request.packageName}' has no public export '${request.exportName}'.`,
    )
    const actual = unalias(selected)
    const declaration = actual.valueDeclaration ?? actual.declarations?.[0]
    Assert.input(declaration !== undefined, `Export '${request.exportName}' has no value declaration.`)
    candidates = checker.getPropertiesOfType(checker.getTypeOfSymbolAtLocation(actual, declaration))
  }
  const operations: NativeApiOperation[] = []
  for (const exportedSymbol of candidates) {
    const symbol = unalias(exportedSymbol)
    if (!(symbol.flags & ts.SymbolFlags.Value) || symbol.flags & ts.SymbolFlags.Enum) {
      continue
    }
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (declaration === undefined) {
      continue
    }
    const signatures = checker.getSignaturesOfType(
      checker.getTypeOfSymbolAtLocation(symbol, declaration),
      ts.SignatureKind.Call,
    )
    if (signatures.length !== 1) {
      diagnostics.push({
        symbol: exportedSymbol.name,
        reason: 'Only a single non-overloaded callable signature is supported.',
      })
      continue
    }
    const signature = signatures[0]!
    const result = checker.getReturnTypeOfSignature(signature)
    const awaited = checker.getAwaitedType(result)
    if (signature.typeParameters?.length || awaited === undefined || !(awaited.flags & ts.TypeFlags.Void)) {
      diagnostics.push({
        symbol: exportedSymbol.name,
        reason: 'This proof of concept supports non-generic void or Promise<void> actions.',
      })
      continue
    }
    try {
      const parameters = signature.parameters.map(parameter => {
        const parameterDeclaration = parameter.valueDeclaration
        Assert.input(
          parameterDeclaration !== undefined && ts.isParameter(parameterDeclaration),
          'A parameter declaration is required.',
        )
        Assert.input(parameterDeclaration.dotDotDotToken === undefined, 'Rest parameters are not supported.')
        const type = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration)
        const optional = parameterDeclaration.questionToken !== undefined
          || parameterDeclaration.initializer !== undefined
        Assert.input(
          optional || !type.isUnion() || !type.types.some(member => member.flags & ts.TypeFlags.Undefined),
          'Required parameters accepting undefined need an explicit absence mapping.',
        )
        return {
          name: parameter.name,
          type: readType(type, ts, checker, enums),
          optional,
        }
      })
      const platforms = symbol.getJsDocTags(checker).filter(tag => tag.name === 'platform')
        .flatMap(tag => ts.displayPartsToString(tag.text).split(/\s+/).filter(Boolean))
      operations.push({
        name: exportedSymbol.name,
        parameters,
        asynchronous: awaited !== result,
        platforms,
      })
    } catch (error) {
      diagnostics.push({ symbol: exportedSymbol.name, reason: Errors.asError(error).message })
    }
  }
  const packageRoot = await findPackageRoot(resolved.resolvedFileName)
  const manifest = await FS.readJson<{ name?: string; version?: string }>(FS.resolvePath('package.json', packageRoot))
  const declarationFiles = program.getSourceFiles().filter(sourceFile =>
    FS.pathIsWithin(sourceFile.fileName, packageRoot)
  )
    .toSorted((left, right) => left.fileName.localeCompare(right.fileName))
  const catalog: NativeApiCatalog = {
    source,
    packageName: request.packageName,
    packageVersion: manifest.version ?? 'unknown',
    declaration: FS.relativePath(packageRoot, resolved.resolvedFileName),
    declarationHash: Platform.sha256Hex(declarationFiles.flatMap(sourceFile => [
      FS.relativePath(packageRoot, sourceFile.fileName),
      '\n',
      sourceFile.text,
      '\n',
    ])),
    enums: enums.map(item => item.declaration).toSorted((left, right) => left.name.localeCompare(right.name)),
    operations: operations.toSorted((left, right) => left.name.localeCompare(right.name)),
  }
  return { catalog, diagnostics }
}

/** Ask TypeScript which namespace properties are legal values, including through type-only star reexports. */
function runtimeExports(
  ts: typeof TS,
  program: TS.Program,
  options: TS.CompilerOptions,
  request: NativeApiImport,
  symbols: readonly TS.Symbol[],
): TS.Symbol[] {
  const path = FS.resolvePath('__native_binding_import__.ts', request.fromDirectory)
  const source = `import * as api from ${JSON.stringify(request.packageName)};\n`
    + symbols.map(symbol => `api[${JSON.stringify(symbol.name)}];`).join('\n')
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, createNew) =>
    fileName === path
      ? ts.createSourceFile(path, source, languageVersion, true)
      : original(fileName, languageVersion, onError, createNew)
  const probe = ts.createProgram([path], options, host, program)
  const file = probe.getSourceFile(path)
  Assert.defined(file, 'native export probe exists')
  const unavailable = new Set<number>()
  for (const diagnostic of probe.getSemanticDiagnostics(file)) {
    const line = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line
    Assert.input(line > 0, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    // A const enum has a value declaration but cannot be read as an object; retain it for an explicit diagnostic.
    if (diagnostic.code !== 2475) {
      unavailable.add(line - 1)
    }
  }
  return symbols.filter((_, index) => !unavailable.has(index))
}

function readType(
  type: TS.Type,
  ts: typeof TS,
  checker: TS.TypeChecker,
  enums: readonly EnumReflection[],
): NativeApiType {
  const present = type.isUnion() ? type.types.filter(member => !(member.flags & ts.TypeFlags.Undefined)) : [type]
  const enumeration = enums.find(item => present.length > 0 && present.every(member => item.types.includes(member)))
  if (enumeration !== undefined) {
    Assert.input(present.length === enumeration.types.length, 'Narrowed enum subsets require an explicit mapping.')
    return { kind: 'enum', name: enumeration.declaration.name }
  }
  if (type.flags & ts.TypeFlags.String) {
    return { kind: 'primitive', name: 'text' }
  }
  if (type.flags & ts.TypeFlags.Number) {
    return { kind: 'primitive', name: 'number' }
  }
  if (
    type.flags & ts.TypeFlags.Boolean
    || present.length === 2 && present.every(member => member.flags & ts.TypeFlags.BooleanLiteral)
  ) {
    return { kind: 'primitive', name: 'boolean' }
  }
  if (checker.isArrayType(type)) {
    const element = checker.getTypeArguments(type as TS.TypeReference)[0]
    Assert.defined(element, 'array has an element type')
    const item = readType(element, ts, checker, enums)
    Assert.input(item.kind !== 'union', 'Arrays of unions require a named element type.')
    return { kind: 'list', element: item }
  }
  if (type.isUnion() && present.length > 0) {
    const members = present.map(member => readType(member, ts, checker, enums))
    Assert.input(
      members.every(member =>
        member.kind === 'primitive' || member.kind === 'list' && member.element.kind === 'primitive'
      ),
      'Only primitive and primitive-list unions are supported.',
    )
    return members.length === 1 ? members[0]! : { kind: 'union', members }
  }
  return Errors.throwUserInput(`Unsupported native API type '${checker.typeToString(type)}'.`)
}

async function findPackageRoot(declaration: string): Promise<string> {
  let directory = FS.dirname(declaration)
  while (!await FS.isFile(FS.resolvePath('package.json', directory))) {
    const parent = FS.dirname(directory)
    Assert.input(parent !== directory, 'The native API declaration must belong to an installed package.')
    directory = parent
  }
  return directory
}
