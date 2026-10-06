import { Assert, Errors, FS, Platform, Switch, TaoResources } from '@shared'
import type * as TS from 'typescript'
import type {
  NativeApiArgument,
  NativeApiCallbackOwnership,
  NativeApiCatalog,
  NativeApiCoverage,
  NativeApiDiagnostic,
  NativeApiEnum,
  NativeApiEventBinding,
  NativeApiImport,
  NativeApiListener,
  NativeApiMember,
  NativeApiOperation,
  NativeApiParameter,
  NativeApiProvenance,
  NativeApiReceiver,
  NativeApiReference,
  NativeApiResolvedInput,
  NativeApiSource,
  NativeApiTarget,
  NativeApiType,
} from './native-api'
import { type NativeResourceContract, nativeTypeReader, type NativeTypeSubstitutions } from './typescript-api-types'
import type { NativeDeferredContract, NativeOperationContract } from './typescript-native-contracts'

// Packaged language servers are CommonJS; source and native host tools are ESM.
const engineRequire = Platform.createModuleRequire(typeof __filename === 'string' ? __filename : import.meta.url)

export type NativeCallbackContract = {
  packageName: string
  declaration: string
  typeName: string
  member: string
  lifetime: 'call'
}
export type NativeGenericContract = {
  packageName: string
  declaration: string
  typeName: string
  member: string
  bindings: Record<string, 'receiver-element' | 'reached-byte-view'>
}

/** Selects the executable compiler separately from declaration-only copied input packages. */
export function resolveTypeScriptApiEngineInput(fromDirectory: string): string {
  const resourceRoot = TaoResources.declaredRoot()
  const pinned = resourceRoot === undefined
    ? undefined
    : FS.resolvePath(
      `${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
      resourceRoot,
    )
  if (pinned !== undefined && FS.existsSync(pinned)) {
    return pinned
  }
  const installed = resourceRoot === undefined
    ? undefined
    : FS.resolvePath(
      `../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
      resourceRoot,
    )
  if (installed !== undefined && FS.existsSync(installed)) {
    return installed
  }
  function runtimeInput(paths?: string[]): string | undefined {
    try {
      const manifest = engineRequire.resolve('typescript/package.json', paths ? { paths } : undefined)
      const runtime = FS.resolvePath('lib/typescript.js', FS.dirname(manifest))
      return FS.existsSync(runtime) ? runtime : undefined
    } catch {
      return undefined
    }
  }
  const enginePath = runtimeInput([fromDirectory]) ?? runtimeInput()
  Assert.input(
    enginePath !== undefined,
    `Cannot resolve an executable TypeScript engine (lib/typescript.js) from '${fromDirectory}'.`,
  )
  return enginePath
}

function typescriptEngine(fromDirectory: string): typeof TS {
  const enginePath = resolveTypeScriptApiEngineInput(fromDirectory)
  const engine = engineRequire(enginePath) as typeof TS
  Assert.input(
    engine.ScriptTarget?.ESNext !== undefined && engine.ModuleResolutionKind?.Bundler !== undefined
      && typeof engine.createProgram === 'function' && typeof engine.resolveModuleName === 'function'
      && typeof engine.sys?.readFile === 'function',
    `TypeScript runtime engine '${enginePath}' does not expose the required compiler API.`,
  )
  return engine
}

const nativeCompilerOptions = (ts: typeof TS): TS.CompilerOptions => ({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  customConditions: ['react-native'],
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
  strict: true,
  strictNullChecks: true,
  skipLibCheck: true,
  noEmit: true,
})

/** Resolves one native declaration input using the same isolated conditions as extraction. */
export function resolveTypeScriptApiInput(packageName: string, fromDirectory: string): string | undefined {
  const ts = typescriptEngine(fromDirectory)
  return ts.resolveModuleName(
    packageName,
    FS.resolvePath('__native_binding_import__.ts', fromDirectory),
    nativeCompilerOptions(ts),
    ts.sys,
  ).resolvedModule?.resolvedFileName
}

/** Resolves public declarations without importing or executing the native package. */
export async function readTypeScriptApi(
  source: string,
  request: NativeApiImport,
  resources: readonly NativeResourceContract[] = [],
  callbacks: readonly NativeCallbackContract[] = [],
  generics: readonly NativeGenericContract[] = [],
  contracts: readonly NativeOperationContract[] = [],
  deferredContracts: readonly NativeDeferredContract[] = [],
): ReturnType<NativeApiSource['read']> {
  const ts = typescriptEngine(request.fromDirectory)
  const options = nativeCompilerOptions(ts)
  const resolved = ts.resolveModuleName(
    request.packageName,
    FS.resolvePath('__native_binding_import__.ts', request.fromDirectory),
    options,
    ts.sys,
  ).resolvedModule
  Assert.input(resolved !== undefined, `Cannot resolve installed declarations for '${request.packageName}'.`)
  const rootDeclarationPath = resolved.resolvedFileName
  const program = ts.createProgram([rootDeclarationPath], options)
  Assert.input(
    program.getSyntacticDiagnostics().length === 0,
    ts.formatDiagnostics(program.getSyntacticDiagnostics(), {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => request.fromDirectory,
      getNewLine: () => '\n',
    }),
  )
  const checker = program.getTypeChecker()
  const root = program.getSourceFile(resolved.resolvedFileName)
  Assert.defined(root, 'resolved native declaration is in the program')
  const module = checker.getSymbolAtLocation(root)
  Assert.input(module !== undefined, 'The native API declaration must be an external module.')
  const unalias = (symbol: TS.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const allExports = checker.getExportsOfModule(module)
  const moduleExports = runtimeExports(ts, program, options, request, allExports)
  const globalSymbols = [...new Set(request.globalExports ?? [])].sort().map(name => {
    const selected = checker.getSymbolsInScope(root, ts.SymbolFlags.Value).find(symbol => symbol.name === name)
    const actual = selected && unalias(selected)
    Assert.input(
      actual !== undefined && actual.declarations?.some(ambientDeclaration),
      `Native global export '${name}' must resolve to a declared global runtime value.`,
    )
    Assert.input(
      !moduleExports.some(symbol => symbol.name === name),
      `Native global export '${name}' conflicts with a public package export.`,
    )
    Assert.input(
      !(actual.flags & ts.SymbolFlags.Enum),
      `Native global enum '${name}' requires explicit enum target metadata.`,
    )
    return actual
  })
  const exported = [...moduleExports, ...globalSymbols]
  const diagnostics: NativeApiDiagnostic[] = []
  const coverage: NativeApiCoverage[] = []
  const operations: NativeApiOperation[] = []
  const enums: { declaration: NativeApiEnum; types: readonly TS.Type[] }[] = []
  const references: NativeApiReference[] = []
  const listeners: NativeApiListener[] = []
  const publicTargets = new Set<string>()
  const origins = new Map<string, { packageName: string; packageVersion: string; directory: string }>()
  function origin(file: TS.SourceFile) {
    let known = origins.get(file.fileName)
    if (known) {
      return known
    }
    let directory = FS.dirname(file.fileName)
    while (!ts.sys.fileExists(FS.resolvePath('package.json', directory))) {
      const parent = FS.dirname(directory)
      Assert.input(parent !== directory, `Native declaration '${file.fileName}' has no owning package.`)
      directory = parent
    }
    const manifest = JSON.parse(ts.sys.readFile(FS.resolvePath('package.json', directory))!) as {
      name?: string
      version?: string
    }
    known = {
      directory,
      packageName: manifest.name ?? request.packageName,
      packageVersion: manifest.version ?? 'unknown',
    }
    origins.set(file.fileName, known)
    return known
  }
  const sourceDeferred = deferredContracts.filter(contract =>
    contract.packageName === request.packageName && contract.packageVersion === origin(root).packageVersion
  ).flatMap(contract =>
    contract.symbols.map(symbol => {
      const exported = allExports.find(item => item.name === symbol)
      const declaration = exported && (unalias(exported).valueDeclaration ?? unalias(exported).declarations?.[0])
      Assert.input(
        declaration !== undefined
          && FS.relativePath(origin(declaration.getSourceFile()).directory, declaration.getSourceFile().fileName)
            === contract.declaration,
        `Pinned native deferral '${symbol}' does not match '${contract.declaration}'.`,
      )
      return { symbol, disposition: contract.disposition, reason: contract.reason }
    })
  )
  request = { ...request, defer: [...sourceDeferred, ...request.defer ?? []] }
  for (const file of program.getSourceFiles()) {
    const owner = origin(file)
    if (owner.packageName !== 'bun-types' && owner.packageName !== '@types/node') {
      continue
    }
    let globalDeclaration = !ts.isExternalModule(file)
    function checkGlobal(node: TS.Node) {
      if (ts.isModuleDeclaration(node) && node.flags & ts.NodeFlags.GlobalAugmentation) {
        globalDeclaration = true
      }
      ts.forEachChild(node, checkGlobal)
    }
    checkGlobal(file)
    Assert.input(
      !globalDeclaration,
      `Native declaration environment includes unsupported host globals from '${owner.packageName}/${
        FS.relativePath(owner.directory, file.fileName)
      }'.`,
    )
  }
  const signatureModules = new Map<string, string>()
  function portableSignature(signature: TS.Signature, declaration: TS.Node): string {
    const description = checker.signatureToString(signature, declaration, ts.TypeFormatFlags.NoTruncation)
    const prefix = 'type NativeSignature = { '
    const syntax = ts.createSourceFile(
      '__native_signature__.ts',
      `${prefix}${description} };`,
      ts.ScriptTarget.Latest,
      true,
    )
    const replacements: { start: number; end: number; text: string }[] = []
    function visit(node: TS.Node): void {
      if (
        ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
        && ts.isStringLiteral(node.argument.literal) && FS.isAbsolute(node.argument.literal.text)
      ) {
        const literal = node.argument.literal
        let moduleName = signatureModules.get(literal.text)
        if (moduleName === undefined) {
          const withoutExtension = (path: string) => path.replace(/(?:\.d)?\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/, '')
          const file = program.getSourceFiles().find(file =>
            file.fileName === literal.text || withoutExtension(file.fileName) === literal.text
          )
          Assert.defined(file, 'an absolute signature module refers to a loaded native declaration')
          const owner = origin(file)
          moduleName = `${owner.packageName}/${withoutExtension(FS.relativePath(owner.directory, file.fileName))}`
            .replaceAll('\\', '/')
          signatureModules.set(literal.text, moduleName)
        }
        replacements.push({
          start: literal.getStart(syntax) - prefix.length,
          end: literal.end - prefix.length,
          text: JSON.stringify(moduleName),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(syntax)
    // Replace only import-type module literals, preserving unrelated string and template literal types.
    return replacements.sort((a, b) => b.start - a.start).reduce(
      (text, replacement) => text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end),
      description,
    )
  }
  function provenance(
    node: TS.Node,
    symbol: string,
    signature?: TS.Signature,
    overload?: number,
    substitutions?: NativeTypeSubstitutions,
    requiredParameter?: string,
  ): NativeApiProvenance {
    const file = node.getSourceFile()
    const owner = origin(file)
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    return {
      packageName: owner.packageName,
      declaration: FS.relativePath(owner.directory, file.fileName),
      line: position.line + 1,
      column: position.character + 1,
      symbol,
      ...(signature
        ? { signature: portableSignature(signature, node), overload }
        : {}),
      ...(substitutions?.size || requiredParameter !== undefined
        ? {
          specialization: Object.fromEntries(
            [
              ...[...(substitutions ?? [])].map(([a, b]) => [checker.typeToString(a), checker.typeToString(b)]),
              ...(requiredParameter === undefined ? [] : [['requiredParameter', requiredParameter]]),
            ],
          ),
        }
        : {}),
    }
  }
  function declarationOwner(node: TS.Node): string | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) {
        return parent.name?.text
      }
    }
    return undefined
  }
  function report(node: TS.Node, name: string, error: unknown): void {
    const reason = Errors.asError(error).message
    diagnostics.push({ symbol: name, reason })
    coverage.push({ provenance: provenance(node, name), disposition: 'unsupported', operations: [], reason })
  }
  function deferred(symbol: TS.Symbol, name: string): boolean {
    publicTargets.add(name)
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration) {
      return false
    }
    const explicit = request.defer?.find(item => item.symbol === name)
    const deprecated = symbol.getJsDocTags(checker).find(tag => tag.name === 'deprecated')
    if (!explicit && !deprecated) {
      return false
    }
    coverage.push({
      provenance: provenance(declaration, name),
      disposition: explicit?.disposition ?? 'deprecated',
      operations: [],
      reason: explicit?.reason
        ?? (ts.displayPartsToString(deprecated?.text) || 'Deprecated by the upstream declaration.'),
    })
    return explicit !== undefined
  }
  for (const publicSymbol of exported) {
    const symbol = unalias(publicSymbol)
    if (!(symbol.flags & ts.SymbolFlags.Enum)) {
      continue
    }
    const declaration = symbol.declarations?.find(ts.isEnumDeclaration)
    if (!declaration) {
      continue
    }
    if (deferred(symbol, publicSymbol.name)) {
      continue
    }
    if (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Const) {
      report(declaration, publicSymbol.name, new Errors.UserInputError('Const enums may not have a runtime export.'))
      continue
    }
    const members = declaration.members.map(member => ({
      name: member.name.getText().replace(/^['"]|['"]$/g, ''),
      value: checker.getConstantValue(member),
    }))
    if (members.some(member => member.value === undefined)) {
      report(
        declaration,
        publicSymbol.name,
        new Errors.UserInputError('Enum members require constant string or number values.'),
      )
      continue
    }
    const type = checker.getDeclaredTypeOfSymbol(symbol)
    enums.push({
      declaration: {
        name: publicSymbol.name,
        members: members.map(member => ({ name: member.name, value: member.value! })),
      },
      types: type.isUnion() ? type.types : [type],
    })
    coverage.push({ provenance: provenance(declaration, publicSymbol.name), disposition: 'generated', operations: [] })
  }
  const referenceTypes = new Map<string, string>()
  const symbolIds = new Map<TS.Symbol, number>()
  const exportedValues = new Map<TS.Type, { name: string; construct: boolean; global?: true }>()
  for (const publicSymbol of exported) {
    const actual = unalias(publicSymbol)
    const declaration = actual.valueDeclaration ?? actual.declarations?.[0]
    if (!declaration || !(actual.flags & ts.SymbolFlags.Value)) {
      continue
    }
    const type = checker.getTypeOfSymbolAtLocation(actual, declaration)
    const constructors = checker.getSignaturesOfType(type, ts.SignatureKind.Construct)
    const global = globalSymbols.includes(actual) ? { global: true as const } : {}
    exportedValues.set(type, { name: publicSymbol.name, construct: false, ...global })
    for (const signature of constructors) {
      exportedValues.set(checker.getReturnTypeOfSignature(signature), {
        name: publicSymbol.name,
        construct: true,
        ...global,
      })
    }
  }
  const publicAliases = new Map<TS.Type, TS.Type>()
  for (const [type, value] of exportedValues) {
    if (
      !value.construct || !(type.flags & ts.TypeFlags.Object)
      || !((type as TS.ObjectType).objectFlags & ts.ObjectFlags.Class)
    ) {
      continue
    }
    for (const base of checker.getBaseTypes(type as TS.InterfaceType)) {
      const declaration = base.getSymbol()?.declarations?.[0]
      if (
        declaration && origin(declaration.getSourceFile()).packageName === request.packageName
        && !allExports.some(item => unalias(item) === base.getSymbol())
        && checker.isTypeAssignableTo(base, type) && checker.isTypeAssignableTo(type, base)
      ) {
        Assert.input(
          !publicAliases.has(base),
          `Native base '${checker.typeToString(base)}' has ambiguous public aliases.`,
        )
        publicAliases.set(base, type)
      }
    }
  }
  function declarationMember(node: TS.Node): string | undefined {
    for (let parent: TS.Node | undefined = node; parent; parent = parent.parent) {
      if (ts.isConstructorDeclaration(parent)) {
        return 'constructor'
      }
      if (
        ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isPropertyDeclaration(parent)
        || ts.isPropertySignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)
        || ts.isFunctionDeclaration(parent)
      ) {
        return parent.name?.getText().replace(/^['"]|['"]$/g, '')
      }
      if (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) {
        return undefined
      }
    }
    return undefined
  }
  function operationContract(node: TS.Node, member = declarationMember(node)): NativeOperationContract | undefined {
    const owner = origin(node.getSourceFile())
    const declaration = FS.relativePath(owner.directory, node.getSourceFile().fileName)
    return contracts.find(contract =>
      contract.packageName === owner.packageName
      && (contract.packageVersion === undefined || contract.packageVersion === owner.packageVersion)
      && contract.declaration === declaration && contract.typeName === declarationOwner(node)
      && contract.member === member
    )
  }
  const typeIds = new Map<TS.Type, number>()
  function typeId(type: TS.Type): number {
    if (!typeIds.has(type)) {
      typeIds.set(type, typeIds.size)
    }
    return typeIds.get(type)!
  }
  function ambientDeclaration(declaration: TS.Declaration): boolean {
    for (let node: TS.Node | undefined = declaration.parent; node; node = node.parent) {
      if (ts.isModuleDeclaration(node)) {
        if (node.flags & ts.NodeFlags.GlobalAugmentation) {
          return true
        }
        if (ts.isStringLiteral(node.name)) {
          return false
        }
      }
    }
    return declaration.getSourceFile().hasNoDefaultLib || !ts.isExternalModule(declaration.getSourceFile())
  }
  function declarationModule(declaration: TS.Declaration): string {
    for (let node: TS.Node | undefined = declaration.parent; node; node = node.parent) {
      if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
        return node.name.text
      }
    }
    return origin(declaration.getSourceFile()).packageName
  }
  function publicTypeExport(symbol: TS.Symbol, declaration: TS.Declaration): TS.Symbol | undefined {
    const moduleName = declarationModule(declaration)
    if (moduleName === request.packageName) {
      return allExports.find(item => unalias(item) === symbol)
    }
    for (let node: TS.Node | undefined = declaration.parent; node; node = node.parent) {
      if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
        const module = checker.getSymbolAtLocation(node.name)
        return module && checker.getExportsOfModule(module).find(item => unalias(item) === symbol)
      }
    }
    const declarationPath = ts.resolveModuleName(moduleName, rootDeclarationPath, options, ts.sys).resolvedModule
      ?.resolvedFileName
    const declarationFile = declarationPath === undefined ? undefined : program.getSourceFile(declarationPath)
    const module = declarationFile === undefined ? undefined : checker.getSymbolAtLocation(declarationFile)
    return module === undefined ? undefined : checker.getExportsOfModule(module).find(item => unalias(item) === symbol)
  }
  const signatureAnchors = new Map<TS.Type, string>()
  function ambientSpelling(type: TS.Type, declaration: TS.Declaration, name: string): string {
    if (declaration.getSourceFile().hasNoDefaultLib || exportedValues.get(type)?.global) {
      return `globalThis.${name}`
    }
    const anchor = signatureAnchors.get(type)
    Assert.input(
      anchor !== undefined,
      `Native ambient reference '${name}' requires an unambiguous public signature type anchor.`,
    )
    return anchor
  }
  function annotation(input: TS.Type, substitutions: NativeTypeSubstitutions): string {
    const concrete = types.concrete(input, substitutions)
    const type = publicAliases.get(concrete) ?? concrete
    if (type.isUnion()) {
      return type.types.map(member => annotation(member, substitutions)).join(' | ')
    }
    const symbol = type.aliasSymbol ?? type.getSymbol()
    const declaration = symbol?.declarations?.[0]
    if (!(type.flags & ts.TypeFlags.Object) || !symbol || !declaration || symbol.name.startsWith('__')) {
      return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
    }
    const publicType = publicTypeExport(symbol, declaration)
    Assert.input(
      ambientDeclaration(declaration) || publicType !== undefined,
      `Native reference '${symbol.name}' has no public TypeScript annotation.`,
    )
    const spelling = ambientDeclaration(declaration)
      ? ambientSpelling(type, declaration, symbol.name)
      : `import(${JSON.stringify(declarationModule(declaration))}).${publicType?.name ?? symbol.name}`
    const arguments_ = typeArguments(type)
    return spelling
      + (arguments_.length ? `<${arguments_.map(argument => annotation(argument, substitutions)).join(', ')}>` : '')
  }
  const referenceQueue: { type: TS.Type; reference: NativeApiReference; substitutions: NativeTypeSubstitutions }[] = []
  function typeArguments(type: TS.Type): readonly TS.Type[] {
    if (type.aliasTypeArguments) {
      return type.aliasTypeArguments
    }
    const reference = type as TS.TypeReference
    return checker.getTypeArguments(reference).slice(0, reference.target?.typeParameters?.length ?? 0)
  }
  function reference(type: TS.Type, hint: string, substitutions: NativeTypeSubstitutions): NativeApiType {
    type = publicAliases.get(type) ?? type
    const arguments_ = typeArguments(type)
    const concreteArguments = arguments_.map(argument => types.concrete(argument, substitutions))
    const symbol = type.aliasSymbol ?? type.getSymbol()
    if (symbol && !symbolIds.has(symbol)) {
      symbolIds.set(symbol, symbolIds.size)
    }
    const referenceKey = `${symbol ? `symbol${symbolIds.get(symbol)}` : `type${typeId(type)}`}:${
      concreteArguments.map(argument => annotation(argument, substitutions)).join(',')
    }`
    const known = referenceTypes.get(referenceKey)
    if (known) {
      return { kind: 'reference', name: known }
    }
    const valueExport = exportedValues.get(type)
    const declaration = symbol?.declarations?.[0]
    Assert.input(
      symbol !== undefined && declaration !== undefined,
      `Native reference '${hint}' needs a named declaration (${checker.typeToString(type)}).`,
    )
    Assert.input(
      concreteArguments.every(argument => !(argument.flags & ts.TypeFlags.TypeParameter)),
      `Unresolved generic native reference '${checker.typeToString(type)}'.`,
    )
    const suffix = concreteArguments.map(argument => token(checker.typeToString(argument))).join('')
    const ambient = ambientDeclaration(declaration)
    const collision = allExports.some(item => item.name === symbol.name && unalias(item) !== symbol)
    const name = (ambient && collision
      ? `Ambient${symbol.name}`
      : symbol.name.startsWith('__')
      ? valueExport?.name ?? hint
      : symbol.name) + suffix
    Assert.input(!references.some(item => item.name === name), `Native reference name '${name}' is ambiguous.`)
    const publicType = publicTypeExport(symbol, declaration)
    Assert.input(
      ambient || publicType !== undefined || valueExport !== undefined,
      `Native reference '${symbol.name}' has no public TypeScript annotation.`,
    )
    const typeName = publicType?.name ?? symbol.name
    const spelling = valueExport && !valueExport.construct && symbol.name.startsWith('__')
      ? valueExport.global
        ? `typeof globalThis.${valueExport.name}`
        : `typeof import(${JSON.stringify(request.packageName)}).${valueExport.name}`
      : ambient
      ? ambientSpelling(type, declaration, typeName)
      : `import(${JSON.stringify(declarationModule(declaration))}).${typeName}`
    const annotatedArguments = concreteArguments.map(argument => annotation(argument, substitutions))
    const constructor = valueExport?.construct
      ? { name: valueExport.name }
      : exported.find(item => unalias(item) === symbol && !!(unalias(item).flags & ts.SymbolFlags.Class))
    const item: NativeApiReference = {
      name,
      typescript: spelling + (annotatedArguments.length ? `<${annotatedArguments.join(', ')}>` : ''),
      provenance: provenance(declaration, name),
      methods: [],
      ...(constructor
        ? {
          runtimeConstructor: { path: [constructor.name], ...(valueExport?.global ? { global: true as const } : {}) },
        }
        : {}),
    }
    references.push(item)
    referenceTypes.set(referenceKey, name)
    referenceQueue.push({ type, reference: item, substitutions })
    const bases = type.flags & ts.TypeFlags.Object
        && (type as TS.ObjectType).objectFlags & (ts.ObjectFlags.Class | ts.ObjectFlags.Interface)
      ? checker.getBaseTypes(type as TS.InterfaceType).filter(base =>
        (base.getSymbol() ?? base.aliasSymbol)?.declarations?.length || checker.getPropertiesOfType(base).length > 0
        || checker.getIndexInfosOfType(base).length > 0
      )
      : []
    const publicBases = bases.filter(base => {
      const symbol = base.getSymbol() ?? base.aliasSymbol
      const declaration = symbol?.declarations?.[0]
      return declaration === undefined || ambientDeclaration(declaration)
        || origin(declaration.getSourceFile()).packageName !== request.packageName || allExports.some(item =>
          unalias(item) === symbol
        )
    })
    const parents = publicBases.map(base => reference(base, `${name}Base`, substitutions)).map(value => {
      Assert(value.kind === 'reference', 'native base is a reference')
      return value.name
    })
    if (parents.length) {
      item.base = parents[0]
      if (parents.length > 1) {
        item.protocols = parents.slice(1)
      }
    }
    if (item.runtimeConstructor && bases[0]?.getSymbol()?.flags && bases[0].getSymbol()!.flags & ts.SymbolFlags.Class) {
      item.runtimeConstructor.inheritedPrototype = true
    }
    for (const node of symbol.declarations ?? []) {
      if (!ts.isClassDeclaration(node)) {
        continue
      }
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) {
          continue
        }
        for (const implemented of clause.types) {
          const protocol = reference(checker.getTypeAtLocation(implemented), `${name}Protocol`, substitutions)
          Assert(protocol.kind === 'reference', 'implemented protocol is a reference')
          item.protocols = [...new Set([...(item.protocols ?? []), protocol.name])]
        }
      }
    }
    return { kind: 'reference', name }
  }
  let diagnosticProgram: TS.Program | undefined
  function unresolvedType(type: TS.Type, node?: TS.Node): never {
    const name = checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation)
    let reason = `Unresolved TypeScript type '${name}'.`
    if (node) {
      diagnosticProgram ??= ts.createProgram({
        rootNames: program.getRootFileNames(),
        options: { ...options, skipLibCheck: false },
        oldProgram: program,
      })
      const origins: TS.Node[] = [node, ...type.aliasSymbol?.declarations ?? []]
      const visited = new Set<TS.Node>()
      function importedOrigins(child: TS.Node) {
        if (visited.has(child)) {
          return
        }
        visited.add(child)
        if (ts.isIdentifier(child)) {
          const symbol = checker.getSymbolAtLocation(child)
          if (symbol?.flags && symbol.flags & (ts.SymbolFlags.Alias | ts.SymbolFlags.TypeAlias)) {
            const declarations = [...symbol.declarations ?? [], ...unalias(symbol).declarations ?? []]
            for (const declaration of declarations) {
              if (ts.isTypeAliasDeclaration(declaration)) {
                origins.push(declaration)
                importedOrigins(declaration)
                continue
              }
              let parent: TS.Node = declaration
              while (parent.parent && !ts.isImportDeclaration(parent) && !ts.isExportDeclaration(parent)) {
                parent = parent.parent
              }
              origins.push(parent)
            }
          }
        }
        ts.forEachChild(child, importedOrigins)
      }
      origins.forEach(importedOrigins)
      const files = [...new Set(origins.map(origin => origin.getSourceFile().fileName))]
      const diagnostic = files.flatMap(fileName => {
        const file = diagnosticProgram!.getSourceFile(fileName)
        return file ? diagnosticProgram!.getSemanticDiagnostics(file) : []
      }).find(diagnostic =>
        diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.start !== undefined
        && origins.some(origin =>
          origin.getSourceFile().fileName === diagnostic.file?.fileName && diagnostic.start! >= origin.getStart()
          && diagnostic.start! < origin.getEnd()
        )
      )
      if (diagnostic?.file && diagnostic.start !== undefined) {
        const owner = origin(diagnostic.file)
        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        reason += ` ${owner.packageName}/${FS.relativePath(owner.directory, diagnostic.file.fileName)}:${
          position.line + 1
        }:${position.character + 1}: TS${diagnostic.code}: ${
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        }`
      }
    }
    return Errors.throwUserInput(reason)
  }
  function listenerType(
    type: TS.Type,
    node: TS.Node | undefined,
    substitutions: NativeTypeSubstitutions,
  ): NativeApiType | undefined {
    if (
      !node || type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)
      || type.isUnion() && type.types.some(member => member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))
    ) {
      return undefined
    }
    const contract = operationContract(node)?.event
    if (
      !contract || (contract.kind !== 'property'
        && (!ts.isParameter(node) || node.name.getText() !== contract.callback))
    ) {
      return undefined
    }
    const protocol = checker.resolveName(contract.protocolType, node, ts.SymbolFlags.Type, false)
    const declaration = protocol?.declarations?.[0]
    Assert.input(
      protocol !== undefined && declaration !== undefined,
      `Native listener protocol '${contract.protocolType}' is unresolved.`,
    )
    const location = provenance(declaration, contract.protocolType)
    const operationOwner = origin(node.getSourceFile())
    Assert.input(
      location.packageName === operationOwner.packageName
        && location.declaration === FS.relativePath(operationOwner.directory, node.getSourceFile().fileName),
      `Native listener protocol '${contract.protocolType}' does not match its pinned declaration owner.`,
    )
    const protocolType = checker.getDeclaredTypeOfSymbol(protocol)
    const candidates = protocolType.isUnion() ? protocolType.types : [protocolType]
    const signature = candidates.flatMap(candidate => checker.getSignaturesOfType(candidate, ts.SignatureKind.Call))[0]
    Assert.input(signature !== undefined, `Native listener protocol '${contract.protocolType}' has no callable form.`)
    const parameters = types.parameters(signature, contract.listener, substitutions)
    const existing = listeners.find(listener => listener.name === contract.listener)
    Assert.input(
      existing === undefined || JSON.stringify(existing.parameters) === JSON.stringify(parameters),
      `Native listener '${contract.listener}' has incompatible reached callback arguments.`,
    )
    if (!existing) {
      listeners.push({
        name: contract.listener,
        parameters,
        typescript: `globalThis.${contract.protocolType}`,
        provenance: location,
        returnContract: contract.returnContract,
        returnProvenance: provenance(node, declarationMember(node) ?? contract.listener),
        event: { argumentIndex: 0, permittedControls: [...contract.permittedControls] },
      })
      coverage.push({ provenance: location, disposition: 'type', operations: [] })
    }
    return { kind: 'listener', name: contract.listener }
  }
  const types = nativeTypeReader(ts, checker, resources, enums, reference, unresolvedType, listenerType)
  function assertValue(type: NativeApiType, resourceAllowed = false, callbacksAllowed = false): void {
    Switch.kind(type, {
      primitive: () => undefined,
      enum: () => undefined,
      dynamic: () => undefined,
      bytes: () => undefined,
      absence: () => undefined,
      reference: () => undefined,
      listener: () => undefined,
      callback: item => {
        Assert.input(callbacksAllowed, 'Nested callbacks require an explicit resource contract.')
        item.parameters.forEach(parameter => assertValue(parameter.type))
      },
      nullable: item => assertValue(item.value, false, callbacksAllowed),
      list: item => assertValue(item.element),
      map: item => assertValue(item.value),
      union: item => item.members.forEach(member => assertValue(member, false, callbacksAllowed)),
      record: item => {
        const record = types.records.find(record => record.name === item.name)
        Assert.defined(record, 'referenced native record exists')
        if (record.disposal) {
          Assert.input(resourceAllowed, 'Nested native resources require an explicit ownership mapping.')
        } else {
          record.fields.forEach(field => assertValue(field.type, false, callbacksAllowed))
        }
      },
    })
  }
  function callbackFields(type: NativeApiType, fields: string[] = []): string[][] {
    return Switch.kind<NativeApiType, string[][]>(type, {
      primitive: () => [],
      enum: () => [],
      dynamic: () => [],
      bytes: () => [],
      absence: () => [],
      reference: () => [],
      listener: () => [],
      list: () => [],
      map: () => [],
      callback: () => [fields],
      nullable: item => callbackFields(item.value, fields),
      union: item => item.members.flatMap(member => callbackFields(member, fields)),
      record: item => {
        const record = types.records.find(record => record.name === item.name)!
        return record.disposal
          ? []
          : record.fields.flatMap(field => callbackFields(field.type, [...fields, field.name]))
      },
    })
  }
  function signatures(
    symbol: TS.Symbol,
    type: TS.Type,
    name: string,
    target: NativeApiTarget,
    receiver?: string,
    kind = ts.SignatureKind.Call,
    inheritedSubstitutions: NativeTypeSubstitutions = new Map(),
    sourceSymbol = name,
  ): void {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    Assert.defined(declaration, 'native operation has a declaration')
    const candidates = checker.getSignaturesOfType(type, kind)
    Assert.input(candidates.length > 0, `Native '${name}' has no callable declaration.`)
    const names = new Set<string>()
    const reflectedSignatures = candidates.map(signature => ({
      signature,
      description: portableSignature(signature, declaration),
    })).sort((a, b) => a.description.localeCompare(b.description))
    const ordered = reflectedSignatures.filter((item, index) =>
      index === 0 || reflectedSignatures[index - 1]!.description !== item.description
    )
    const optionalParameter = (parameter: TS.Symbol) => {
      const node = parameter.valueDeclaration ?? parameter.declarations?.[0]
      return node !== undefined && ts.isParameter(node)
        && (node.questionToken !== undefined || node.initializer !== undefined || node.dotDotDotToken !== undefined)
    }
    const absentSignature = candidates.find(candidate => candidate.parameters.every(optionalParameter))
    for (const [overload, { signature }] of ordered.entries()) {
      const rollback = types.checkpoint()
      const referenceCount = references.length
      const queueCount = referenceQueue.length
      const referenceNames = new Map(referenceTypes)
      const operationCount = operations.length
      const coverageCount = coverage.length
      const listenerCount = listeners.length
      try {
        let variants: Map<TS.Type, TS.Type>[] = [new Map(inheritedSubstitutions)]
        for (const parameter of signature.typeParameters ?? []) {
          const constraint = checker.getBaseConstraintOfType(parameter)
          let choices = constraint?.isUnion() ? constraint.types : constraint ? [constraint] : []
          const node = signature.declaration ?? declaration
          const location = provenance(node, sourceSymbol)
          const ownerName = declarationOwner(node)
          const contract = generics.find(contract =>
            contract.packageName === location.packageName && contract.declaration === location.declaration
            && contract.typeName === ownerName && contract.member === symbol.name
          )
          const binding = contract?.bindings[checker.typeToString(parameter)]
          if (binding) {
            const receiverType = referenceQueue.find(item => item.reference.name === receiver)?.type
            choices = binding === 'receiver-element' && receiverType
              ? typeArguments(receiverType).slice(0, 1)
              : types.byteViews
            Assert.input(
              choices.length > 0 && choices.every(choice =>
                !(choice.flags & ts.TypeFlags.TypeParameter)
                && (constraint === undefined || checker.isTypeAssignableTo(choice, constraint))
              ),
              `Generic operation '${sourceSymbol}' has no reached concrete specialization for '${
                checker.typeToString(parameter)
              }'.`,
            )
          }
          Assert.input(
            choices.length > 0
              && (binding !== undefined
                || choices.every(choice => choice.isStringLiteral() || choice.isNumberLiteral())),
            `Generic operation '${name}' requires a finite literal constraint for '${
              checker.typeToString(parameter)
            }'.`,
          )
          variants = variants.flatMap(previous => choices.map(choice => new Map([...previous, [parameter, choice]])))
        }
        let requiredParameters: (number | undefined)[] = [undefined]
        if (absentSignature && absentSignature !== signature && signature.parameters.every(optionalParameter)) {
          const ownReturn = checker.getReturnTypeOfSignature(signature)
          const absentReturn = checker.getReturnTypeOfSignature(absentSignature)
          if (
            !checker.isTypeAssignableTo(ownReturn, absentReturn) || !checker.isTypeAssignableTo(absentReturn, ownReturn)
          ) {
            const earlier = candidates.slice(0, candidates.indexOf(signature))
            requiredParameters = signature.parameters.flatMap((parameter, index) => {
              const node = parameter.valueDeclaration ?? parameter.declarations?.[0]
              Assert.defined(node, 'overload discriminator has a declaration')
              const type = checker.getTypeOfSymbolAtLocation(parameter, node)
              const present = (type.isUnion() ? type.types : [type]).filter(member =>
                !(member.flags & ts.TypeFlags.Undefined)
              )
              const distinguishes = present.length > 0 && earlier.every(candidate => {
                const other = candidate.parameters[index]
                if (!other) {
                  return !candidate.parameters.some(parameter => {
                    const node = parameter.valueDeclaration
                    return node !== undefined && ts.isParameter(node) && node.dotDotDotToken !== undefined
                  })
                }
                const otherNode = other.valueDeclaration ?? other.declarations?.[0]
                Assert.defined(otherNode, 'overload discriminator has a declaration')
                const otherType = checker.getTypeOfSymbolAtLocation(other, otherNode)
                return present.every(member => !checker.isTypeAssignableTo(member, otherType))
              })
              return distinguishes ? [index] : []
            })
            Assert.input(
              requiredParameters.length > 0,
              `Native overload '${sourceSymbol}' has conflicting absent-argument results without a finite distinguishing parameter.`,
            )
          }
        }
        for (
          const { substitutions, requiredIndex } of variants.flatMap(substitutions =>
            requiredParameters.map(requiredIndex => ({ substitutions, requiredIndex }))
          )
        ) {
          const discriminant = ordered.length > 1
            ? signature.parameters.map(parameter => {
              const node = parameter.valueDeclaration ?? parameter.declarations?.[0]
              Assert.defined(node, 'overload parameter has a declaration')
              return token(checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, node)))
            }).join('And') || 'NoArguments'
            : ''
          const specialization = [...substitutions.values()].map(value => token(checker.typeToString(value))).join(
            'And',
          )
          const operationName = name + (discriminant ? `With${discriminant}` : '')
            + (specialization ? `For${specialization}` : '')
            + (requiredIndex === undefined ? '' : `Requiring${upper(signature.parameters[requiredIndex]!.name)}`)
          Assert.input(
            !names.has(operationName),
            `Native overloads of '${name}' need a distinct descriptive argument type.`,
          )
          names.add(operationName)
          const reflected = types.parameters(signature, upper(operationName), substitutions)
          if (requiredIndex !== undefined) {
            reflected[requiredIndex]!.optional = false
          }
          const arguments_: NativeApiArgument[] = []
          const parameters: NativeApiParameter[] = receiver
            ? [{ name: 'receiver', optional: false, type: { kind: 'reference' as const, name: receiver } }]
            : []
          for (const [index, parameter] of reflected.entries()) {
            const parameterSymbol = signature.parameters[index]!
            const parameterType = checker.getTypeOfSymbolAtLocation(parameterSymbol, parameterSymbol.valueDeclaration!)
            const bound = substitutions.get(parameterType)
            if (bound?.isStringLiteral() || bound?.isNumberLiteral()) {
              const member = bound.getSymbol()?.declarations?.find(ts.isEnumMember)
              if (member) {
                const enumSymbol = checker.getSymbolAtLocation(member.parent.name)
                const publicEnum = exported.find(item => unalias(item) === enumSymbol)
                Assert.input(
                  publicEnum !== undefined,
                  `Native specialization '${checker.typeToString(bound)}' needs its public runtime enum export.`,
                )
                arguments_.push({
                  kind: 'export',
                  path: [publicEnum.name, member.name.getText().replace(/^['"]|['"]$/g, '')],
                })
              } else {
                arguments_.push({ kind: 'literal', value: bound.value })
              }
            } else {
              arguments_.push({
                kind: 'parameter',
                index: parameters.length,
                ...(parameter.rest ? { rest: true } : {}),
              })
              parameters.push(parameter)
            }
          }
          const result = checker.getReturnTypeOfSignature(signature)
          const awaited = checker.getAwaitedType(result)
          Assert.input(awaited !== undefined, `Native operation '${name}' has an unresolved promise result.`)
          if (ordered.length === 1 && !signature.typeParameters?.length && kind === ts.SignatureKind.Call) {
            const modulePath = (path: string[], global?: true) =>
              (global ? 'typeof globalThis' : `typeof import(${JSON.stringify(request.packageName)})`)
              + path.map(member => `[${JSON.stringify(member)}]`).join('')
            const receiverName = target.kind === 'method' && target.receiver.kind === 'reference'
              ? target.receiver.name
              : undefined
            const callable = target.kind === 'call'
              ? modulePath(target.path, target.global)
              : target.kind === 'method' && typeof target.member === 'string'
              ? target.receiver.kind === 'module'
                ? `${modulePath(target.receiver.path, target.receiver.global)}[${JSON.stringify(target.member)}]`
                : `(${references.find(item => item.name === receiverName)!.typescript})[${
                  JSON.stringify(target.member)
                }]`
              : undefined
            if (callable && !signatureAnchors.has(awaited)) {
              signatureAnchors.set(awaited, `Awaited<ReturnType<${callable}>>`)
            }
          }
          const returned = awaited.flags & ts.TypeFlags.Void
            ? undefined
            : types.read(
              awaited,
              `${upper(operationName)}Result`,
              false,
              substitutions,
              signature.declaration ?? declaration,
            )
          Assert.input(returned?.kind !== 'callback', 'Returned callbacks need an explicit resource contract.')
          if (returned) {
            assertValue(returned, true)
          }
          const behavior = operationContract(
            signature.declaration ?? declaration,
            kind === ts.SignatureKind.Construct ? 'constructor' : symbol.name,
          )
          Assert.input(
            !behavior?.pending || awaited !== result,
            `Pinned native pending operation '${sourceSymbol}' must return a promise.`,
          )
          Assert.input(
            !behavior?.callbackEffect || receiver !== undefined,
            `Pinned native callback disposal '${sourceSymbol}' requires an explicit reference receiver.`,
          )
          const callbackOwnership: NativeApiCallbackOwnership[] = []
          for (const [index, parameter] of parameters.entries()) {
            const nested = callbackFields(parameter.type).filter(fields => fields.length > 0)
            for (const fields of nested) {
              const contract = behavior?.callbacks?.find(contract =>
                contract.parameter === parameter.name && JSON.stringify(contract.fields) === JSON.stringify(fields)
              )
              Assert.input(contract !== undefined, 'Nested callbacks require an explicit resource contract.')
              Assert.input(
                contract.lifetime.kind !== 'promise' || behavior?.pending && awaited !== result,
                `Native callback '${sourceSymbol}.${parameter.name}.${
                  fields.join('.')
                }' requires a pending promise owner.`,
              )
              Assert.input(
                contract.lifetime.kind !== 'resource' || returned?.kind === 'reference',
                `Native callback '${sourceSymbol}.${parameter.name}.${
                  fields.join('.')
                }' requires a returned native resource.`,
              )
              callbackOwnership.push({ parameter: index, fields, lifetime: contract.lifetime })
            }
            if (parameter.type.kind === 'callback') {
              parameter.type.parameters.forEach(argument => assertValue(argument.type))
            } else {
              assertValue(parameter.type, true, nested.length > 0)
            }
          }
          for (const contract of behavior?.callbacks ?? []) {
            Assert.input(
              callbackOwnership.some(ownership =>
                parameters[ownership.parameter]?.name === contract.parameter
                && JSON.stringify(ownership.fields) === JSON.stringify(contract.fields)
              ),
              `Pinned native callback '${sourceSymbol}.${contract.parameter}.${
                contract.fields.join('.')
              }' does not exist.`,
            )
          }
          let callbackLifetime: 'call' | 'subscription' | undefined
          if (parameters.some(parameter => parameter.type.kind === 'callback')) {
            const location = provenance(signature.declaration ?? declaration, sourceSymbol)
            const contract = callbacks.find(contract =>
              contract.packageName === location.packageName && contract.declaration === location.declaration
              && contract.typeName === declarationOwner(signature.declaration ?? declaration)
              && contract.member === symbol.name
            )
            if (contract) {
              callbackLifetime = contract.lifetime
            } else {
              Assert.input(
                returned?.kind === 'record'
                  && types.records.some(record => record.name === returned.name && record.disposal),
                'Callback operations must return a supported owned subscription.',
              )
              callbackLifetime = 'subscription'
            }
            parameters.forEach((parameter, index) => {
              if (parameter.type.kind === 'callback') {
                callbackOwnership.push({ parameter: index, fields: [], lifetime: { kind: callbackLifetime! } })
              }
            })
          }
          let eventBinding: NativeApiEventBinding | undefined
          if (behavior?.event && behavior.event.kind !== 'property') {
            Assert.input(receiver !== undefined, 'Native event registration requires an explicit reference receiver.')
            const role = (name: string | undefined) => {
              const index = signature.parameters.findIndex(parameter => parameter.name === name)
              Assert.input(index >= 0, `Pinned native event role '${sourceSymbol}.${name}' does not exist.`)
              return arguments_[index]!
            }
            const callback = role(behavior.event.callback)
            const eventName = role(behavior.event.eventName)
            const options = behavior.event.options ? role(behavior.event.options) : undefined
            Assert.input(
              callback.kind === 'parameter' && (options === undefined || options.kind === 'parameter'),
              `Pinned native event '${sourceSymbol}' has invalid callback or options roles.`,
            )
            Assert.input(
              eventName.kind === 'parameter' || eventName.kind === 'literal' && typeof eventName.value === 'string',
              `Pinned native event '${sourceSymbol}' has an invalid event name role.`,
            )
            eventBinding = {
              kind: behavior.event.kind,
              listener: behavior.event.listener,
              receiverParameter: 0,
              eventName: eventName.kind === 'parameter'
                ? { kind: 'parameter', index: eventName.index }
                : { kind: 'literal', value: eventName.value as string },
              callbackParameter: callback.index,
              ...(options?.kind === 'parameter' ? { optionsParameter: options.index } : {}),
            }
          }
          const platforms = symbol.getJsDocTags(checker).filter(tag => tag.name === 'platform').flatMap(tag =>
            ts.displayPartsToString(tag.text).split(/\s+/).filter(Boolean)
          )
          operations.push({
            name: operationName,
            parameters,
            ...(returned ? { result: returned } : {}),
            ...(callbackLifetime ? { callbackLifetime } : {}),
            ...(callbackOwnership.length ? { callbackOwnership } : {}),
            ...(eventBinding ? { eventBinding } : {}),
            ...(behavior?.pending
              ? { pending: { name: `${operationName}Pending`, ...(returned ? { result: returned } : {}) } }
              : {}),
            ...(behavior?.callbackEffect ? { callbackEffect: { kind: behavior.callbackEffect, parameter: 0 } } : {}),
            asynchronous: awaited !== result,
            platforms,
            target,
            arguments: arguments_,
            provenance: provenance(
              signature.declaration ?? declaration,
              sourceSymbol,
              signature,
              overload,
              substitutions,
              requiredIndex === undefined ? undefined : reflected[requiredIndex]!.name,
            ),
          })
          coverage.push({
            provenance: provenance(
              signature.declaration ?? declaration,
              sourceSymbol,
              signature,
              overload,
              substitutions,
              requiredIndex === undefined ? undefined : reflected[requiredIndex]!.name,
            ),
            disposition: 'generated',
            operations: [operationName],
          })
        }
      } catch (error) {
        listeners.splice(listenerCount)
        rollback()
        references.splice(referenceCount)
        referenceQueue.splice(queueCount)
        referenceTypes.clear()
        for (const [type, name] of referenceNames) {
          referenceTypes.set(type, name)
        }
        operations.splice(operationCount)
        coverage.splice(coverageCount)
        report(signature.declaration ?? declaration, sourceSymbol, error)
      }
    }
  }
  function memberName(property: TS.Symbol): NativeApiMember {
    if (!property.name.startsWith('__@')) {
      return property.name
    }
    const node = property.declarations?.[0]
    const computed = node && 'name' in node ? (node as TS.NamedDeclaration).name : undefined
    Assert.input(
      computed !== undefined && ts.isComputedPropertyName(computed)
        && ts.isPropertyAccessExpression(computed.expression) && computed.expression.expression.getText() === 'Symbol',
      `Unsupported native symbol member '${property.name}'.`,
    )
    const symbol = computed.expression.name.text
    Assert.input(
      symbol === 'iterator' || symbol === 'asyncIterator' || symbol === 'dispose' || symbol === 'asyncDispose'
        || symbol === 'toStringTag',
      `Unsupported native symbol member 'Symbol.${symbol}'.`,
    )
    return { symbol }
  }
  function publicMember(symbol: TS.Symbol): boolean {
    return !(symbol.declarations ?? []).some(node =>
      !!(ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
      || ('name' in node && (node as TS.NamedDeclaration).name !== undefined
        && ts.isPrivateIdentifier((node as TS.NamedDeclaration).name!))
    )
  }
  function members(
    type: TS.Type,
    owner: string,
    receiver: NativeApiReceiver,
    referenceName?: string,
    substitutions: NativeTypeSubstitutions = new Map(),
  ): void {
    for (const property of checker.getPropertiesOfType(type)) {
      if (!publicMember(property) || property.name === 'prototype') {
        continue
      }
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      if (!declaration) {
        continue
      }
      const prototype = receiver.kind === 'module' ? checker.getPropertyOfType(type, 'prototype') : undefined
      const instance = prototype && checker.getTypeOfSymbolAtLocation(prototype, declaration)
      const staticCollision = instance && checker.getPropertyOfType(instance, property.name) !== undefined
      const name = `${owner}${staticCollision ? 'Static' : ''}${
        upper(property.name.startsWith('__@') ? property.name.split('@')[1]!.split('@')[0]! : property.name)
      }`
      const symbolName = `${owner}.${
        property.name.startsWith('__@') ? (declaration as TS.NamedDeclaration).name?.getText() : property.name
      }`
      if (deferred(property, symbolName)) {
        continue
      }
      const rollbackTypes = types.checkpoint()
      const referenceCount = references.length
      const queueCount = referenceQueue.length
      const referenceNames = new Map(referenceTypes)
      const operationCount = operations.length
      const coverageCount = coverage.length
      const listenerCount = listeners.length
      try {
        const member = memberName(property)
        const valueType = checker.getTypeOfSymbolAtLocation(property, declaration)
        const callable = property.flags & ts.SymbolFlags.Optional && valueType.isUnion() && valueType.types.some(type =>
            type.flags & ts.TypeFlags.Undefined
          )
            && !valueType.types.some(type => type.flags & ts.TypeFlags.Null)
          ? checker.getNonNullableType(valueType)
          : valueType
        if (checker.getSignaturesOfType(callable, ts.SignatureKind.Call).length) {
          signatures(
            property,
            callable,
            name,
            { kind: 'method', receiver, member },
            referenceName,
            ts.SignatureKind.Call,
            substitutions,
            symbolName,
          )
          continue
        }
        const awaited = checker.getAwaitedType(valueType)
        Assert.input(awaited !== undefined, `Native getter '${symbolName}' has an unresolved promise result.`)
        const value = awaited.flags & ts.TypeFlags.Void
          ? undefined
          : types.read(awaited, `${name}Value`, false, substitutions, declaration)
        if (value) {
          assertValue(value)
        }
        const parameters = referenceName
          ? [{ name: 'receiver', type: { kind: 'reference' as const, name: referenceName }, optional: false }]
          : []
        const event = operationContract(declaration)?.event
        Assert.input(
          !event || event.kind === 'property' && referenceName !== undefined,
          `Pinned native event property '${symbolName}' requires an explicit reference receiver.`,
        )
        operations.push({
          name: `${name}Get`,
          parameters,
          ...(value ? { result: value } : {}),
          asynchronous: awaited !== valueType,
          platforms: [],
          target: { kind: 'get', receiver, member },
          provenance: provenance(declaration, symbolName),
          arguments: [],
          ...(event
            ? { eventBinding: { kind: 'property-get' as const, listener: event.listener, receiverParameter: 0 } }
            : {}),
        })
        const generated = [`${name}Get`]
        const getterOnly = property.declarations?.some(ts.isGetAccessorDeclaration)
          && !property.declarations.some(ts.isSetAccessorDeclaration)
        const readonly = property.declarations?.some(node =>
          !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Readonly)
        )
        if (!getterOnly && !readonly) {
          const setter = property.declarations?.find(ts.isSetAccessorDeclaration)
          const setterParameter = setter?.parameters[0]
          const setterType = setterParameter ? checker.getTypeAtLocation(setterParameter) : valueType
          const setValue = types.read(
            setterType,
            `${name}SetValue`,
            false,
            substitutions,
            setterParameter ?? declaration,
          )
          assertValue(setValue)
          operations.push({
            name: `${name}Set`,
            parameters: [...parameters, { name: 'value', type: setValue, optional: false }],
            asynchronous: false,
            platforms: [],
            target: { kind: 'set', receiver, member },
            provenance: provenance(declaration, symbolName),
            arguments: [{ kind: 'parameter', index: parameters.length }],
            ...(event
              ? {
                eventBinding: {
                  kind: 'property-set' as const,
                  listener: event.listener,
                  receiverParameter: 0,
                  callbackParameter: parameters.length,
                },
              }
              : {}),
          })
          generated.push(`${name}Set`)
        }
        coverage.push({
          provenance: provenance(declaration, symbolName),
          disposition: 'generated',
          operations: generated,
        })
      } catch (error) {
        listeners.splice(listenerCount)
        rollbackTypes()
        references.splice(referenceCount)
        referenceQueue.splice(queueCount)
        referenceTypes.clear()
        for (const [type, name] of referenceNames) {
          referenceTypes.set(type, name)
        }
        operations.splice(operationCount)
        coverage.splice(coverageCount)
        report(declaration, symbolName, error)
      }
    }
  }
  let candidates = exported
  let selectedPath: string[] = []
  if (request.exportName !== undefined) {
    const selected = moduleExports.find(symbol => symbol.name === request.exportName)
    Assert.input(
      selected !== undefined,
      `Package '${request.packageName}' has no public export '${request.exportName}'.`,
    )
    const actual = unalias(selected)
    const declaration = actual.valueDeclaration ?? actual.declarations?.[0]
    Assert.defined(declaration, 'selected native export has a declaration')
    candidates = checker.getPropertiesOfType(checker.getTypeOfSymbolAtLocation(actual, declaration))
    selectedPath = [request.exportName]
    candidates = [...candidates, ...globalSymbols]
  }
  const excluded = [...new Set(request.exclude ?? [])].sort()
  for (const name of excluded) {
    Assert.input(
      candidates.some(symbol => symbol.name === name),
      `No public native export '${name}' exists to exclude.`,
    )
  }
  for (const exportedSymbol of candidates) {
    const symbol = unalias(exportedSymbol)
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration || symbol.flags & ts.SymbolFlags.Enum || !(symbol.flags & ts.SymbolFlags.Value)) {
      continue
    }
    if (excluded.includes(exportedSymbol.name)) {
      coverage.push({
        provenance: provenance(declaration, exportedSymbol.name),
        disposition: 'unsupported',
        operations: [],
        reason: 'Explicitly excluded by the import request.',
      })
      continue
    }
    if (deferred(symbol, exportedSymbol.name)) {
      continue
    }
    try {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
      const global = globalSymbols.includes(symbol) ? { global: true as const } : {}
      const path = [...(global.global ? [] : selectedPath), exportedSymbol.name]
      if (checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length) {
        reference(
          checker.getReturnTypeOfSignature(checker.getSignaturesOfType(type, ts.SignatureKind.Construct)[0]!),
          exportedSymbol.name,
          new Map(),
        )
        signatures(
          symbol,
          type,
          `${exportedSymbol.name}Construct`,
          { kind: 'construct', path, ...global },
          undefined,
          ts.SignatureKind.Construct,
          new Map(),
          `${exportedSymbol.name}.constructor`,
        )
        members(type, exportedSymbol.name, { kind: 'module', path, ...global })
        coverage.push({
          provenance: provenance(declaration, exportedSymbol.name),
          disposition: 'generated',
          operations: [],
        })
      } else if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) {
        signatures(symbol, type, exportedSymbol.name, { kind: 'call', path, ...global })
      } else {
        const reflected = types.read(type, upper(exportedSymbol.name), false, new Map(), declaration)
        operations.push({
          name: `${exportedSymbol.name}Get`,
          parameters: [],
          result: reflected,
          asynchronous: false,
          platforms: [],
          target: {
            kind: 'get',
            receiver: { kind: 'module', path: global.global ? [] : selectedPath, ...global },
            member: exportedSymbol.name,
          },
          arguments: [],
          provenance: provenance(declaration, exportedSymbol.name),
        })
        coverage.push({
          provenance: provenance(declaration, exportedSymbol.name),
          disposition: 'generated',
          operations: [`${exportedSymbol.name}Get`],
        })
        if (reflected.kind === 'record') {
          members(type, exportedSymbol.name, { kind: 'module', path, ...global })
        }
      }
    } catch (error) {
      report(declaration, exportedSymbol.name, error)
    }
  }
  for (const queued of referenceQueue) {
    const properties = checker.getPropertiesOfType(queued.type).filter(publicMember)
    for (const property of properties) {
      if (property.flags & ts.SymbolFlags.Optional) {
        continue
      }
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      if (!declaration) {
        continue
      }
      if (
        !checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(property, declaration), ts.SignatureKind.Call)
          .length
      ) {
        continue
      }
      try {
        queued.reference.methods.push(memberName(property))
      } catch (error) {
        report(declaration, `${queued.reference.name}.${property.name}`, error)
      }
    }
    members(
      queued.type,
      queued.reference.name,
      { kind: 'reference', name: queued.reference.name },
      queued.reference.name,
      queued.substitutions,
    )
  }
  for (const publicSymbol of allExports) {
    if (exported.includes(publicSymbol)) {
      continue
    }
    const actual = unalias(publicSymbol)
    const declaration = actual.declarations?.[0]
    if (declaration) {
      coverage.push({ provenance: provenance(declaration, publicSymbol.name), disposition: 'type', operations: [] })
    }
  }
  const typeNames = new Set([
    ...enums.map(item => item.declaration.name),
    ...types.records.map(item => item.name),
    ...references.map(item => item.name),
    ...listeners.map(item => item.name),
  ])
  const reservedNames = new Set([...typeNames, ...operations.map(operation => operation.name)])
  const renamed = new Map<string, string>()
  for (const operation of [...operations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (typeNames.has(operation.name)) {
      const original = operation.name
      let name = `${original}Action`
      while (reservedNames.has(name)) {
        name += 'Action'
      }
      reservedNames.add(name)
      renamed.set(original, name)
      operation.name = name
      if (operation.pending) {
        operation.pending.name = `${name}Pending`
      }
    }
  }
  for (const row of coverage) {
    row.operations = row.operations.map(name => renamed.get(name) ?? name)
    if (
      row.disposition === 'generated'
      && references.some(reference => reference.runtimeConstructor?.path[0] === row.provenance.symbol)
    ) {
      row.operations = operations.filter(operation =>
        operation.provenance?.symbol.startsWith(`${row.provenance.symbol}.`)
      )
        .map(operation => operation.name)
    }
  }
  for (const row of coverage) {
    if (row.disposition === 'deprecated') {
      row.operations = operations.filter(operation => operation.provenance?.symbol === row.provenance.symbol).map(
        operation => operation.name,
      )
    }
  }
  for (const item of request.defer ?? []) {
    Assert.input(publicTargets.has(item.symbol), `No public native export '${item.symbol}' exists to defer.`)
  }
  const rootOrigin = origin(root)
  const resolvedInputs: NativeApiResolvedInput[] = program.getSourceFiles().map(file => {
    const owner = origin(file)
    return {
      packageName: owner.packageName,
      packageVersion: owner.packageVersion,
      declaration: FS.relativePath(owner.directory, file.fileName),
      hash: Platform.sha256Hex([file.text]),
      filePath: file.fileName,
      packageRoot: owner.directory,
    }
  }).sort((a, b) => `${a.packageName}/${a.declaration}`.localeCompare(`${b.packageName}/${b.declaration}`))
  const inputs = resolvedInputs.map(({ filePath: _filePath, packageRoot: _packageRoot, ...input }) => input)
  const catalog: NativeApiCatalog = {
    source,
    packageName: request.packageName,
    packageVersion: rootOrigin.packageVersion,
    declaration: FS.relativePath(rootOrigin.directory, root.fileName),
    declarationHash: Platform.sha256Hex([JSON.stringify(inputs)]),
    inputs,
    enums: enums.map(item => item.declaration).sort((a, b) => a.name.localeCompare(b.name)),
    ...(types.records.length ? { records: types.records.sort((a, b) => a.name.localeCompare(b.name)) } : {}),
    ...(references.length ? { references: references.sort((a, b) => a.name.localeCompare(b.name)) } : {}),
    ...(listeners.length ? { listeners: listeners.sort((a, b) => a.name.localeCompare(b.name)) } : {}),
    coverage,
    ...(excluded.length ? { excluded } : {}),
    operations: operations.sort((a, b) => a.name.localeCompare(b.name)),
  }
  return { catalog, diagnostics, resolvedInputs }
}

function upper(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}
function token(name: string): string {
  return name.split(/[^A-Za-z0-9]+/).filter(Boolean).map(upper).join('')
}

/** TypeScript checks value availability, including type-only star reexports and const enums. */
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
    if (diagnostic.code !== 2475) {
      unavailable.add(line - 1)
    }
  }
  return symbols.filter((_, index) => !unavailable.has(index))
}
