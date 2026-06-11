import { AST, Langium, type ParseOptions, type ParseResult } from '@parser'
import { loadEntryAndReachableDocuments } from '@parser/module-resolution'
import { TaoValueScopeProvider } from '@parser/value-scope'
import { FS } from '@shared'
import { createTypirLangiumServices, initializeLangiumTypirServices } from 'typir-langium'
import { registerTaoValidationChecks } from './langium-validation'
import { type TaoSpecifics, TaoTypeSystem, type TaoTypirServices } from './type-system'

type Services = {
  shared: Langium.LangiumSharedCoreServices
  language: Langium.LangiumDefaultCoreServices
  typir: TaoTypirServices
}

type ValidatorLspServices = {
  shared: Langium.LangiumSharedServices
  language: Langium.LangiumServices
  typir: TaoTypirServices
}

/** ValidatorParseResult declares a parse result built by validator-owned services. */
export type ValidatorParseResult = ParseResult & {
  typir: TaoTypirServices
  workspaceFiles: AST.TaoFile[]
  entryFilePath?: string
}

/** parseCodeForValidation parses Tao source with validator-owned Langium and Typir services. */
export async function parseCodeForValidation(code: string, opts: ParseOptions = {}): Promise<ValidatorParseResult> {
  const services = createValidatorServices()
  const uri = opts.uri ?? Langium.URI.file('/__tao__/source.tao')
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(code, uri)
  return await buildDocuments(services, document, [document])
}

/** parseFileForValidation parses a Tao file with validator-owned Langium and Typir services. */
export async function parseFileForValidation(path: string): Promise<ValidatorParseResult> {
  const services = createValidatorServices()
  const entryPath = FS.resolvePath(path)
  const documents = await loadEntryAndReachableDocuments(services, entryPath)
  const entryDocument = documents.find(document => document.uri.path === entryPath)
  if (!entryDocument) {
    throw new Error(`Expected entry Tao document for ${entryPath}`)
  }
  return await buildDocuments(services, entryDocument, documents)
}

/** rebuildForValidation reparses a parser result with validator-owned services. */
export async function rebuildForValidation(parsed: ParseResult): Promise<ValidatorParseResult> {
  return await parseCodeForValidation(parsed.document.textDocument.getText(), { uri: parsed.document.uri })
}

/** createValidatorServices creates Langium services with Tao Typir services initialized. */
function createValidatorServices(): Services {
  const shared = Langium.inject(
    Langium.createDefaultSharedCoreModule(Langium.NodeFileSystem),
    AST.GeneratedSharedModule,
  )
  const typir = createTypirLangiumServices<TaoSpecifics>(
    shared,
    AST.reflection,
    new TaoTypeSystem(),
  )
  const language = Langium.inject(
    Langium.createDefaultCoreModule({ shared }),
    AST.GeneratedModule,
    {
      references: {
        ScopeProvider: (services) => new TaoValueScopeProvider(services),
      },
    },
  )
  shared.ServiceRegistry.register(language)
  registerTaoValidationChecks(language)
  initializeLangiumTypirServices(language, typir)

  return { shared, language, typir }
}

/** createValidatorLspServices creates Langium LSP services with Tao Typir services initialized. */
export function createValidatorLspServices(
  context: Langium.DefaultSharedModuleContext = Langium.NodeFileSystem,
): ValidatorLspServices {
  const shared = Langium.inject(
    Langium.createDefaultSharedModule(context),
    AST.GeneratedSharedModule,
  )
  const typir = createTypirLangiumServices<TaoSpecifics>(
    shared,
    AST.reflection,
    new TaoTypeSystem(),
  )
  const language = Langium.inject(
    Langium.createDefaultModule({ shared }),
    AST.GeneratedModule,
    {
      references: {
        ScopeProvider: (services) => new TaoValueScopeProvider(services),
      },
    },
  )
  shared.ServiceRegistry.register(language)
  registerTaoValidationChecks(language)
  initializeLangiumTypirServices(language, typir)

  return { shared, language, typir }
}

async function buildDocuments(
  services: Services,
  entryDocument: AST.Document,
  documents: AST.Document[],
): Promise<ValidatorParseResult> {
  for (const document of documents) {
    services.shared.workspace.LangiumDocuments.addDocument(document)
  }
  await services.shared.workspace.DocumentBuilder.build(documents, {
    eagerLinking: true,
    validation: false,
  })

  return {
    ast: entryDocument.parseResult.value,
    diagnostics: entryDocument.diagnostics ?? [],
    document: entryDocument,
    typir: services.typir,
    workspaceFiles: documents.map(document => document.parseResult.value),
    entryFilePath: entryDocument.uri.scheme === 'file' ? entryDocument.uri.path : undefined,
  }
}
