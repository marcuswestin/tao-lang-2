import { AST, Langium, type ParseOptions, type ParseResult } from '@parser'
import { TaoValueScopeProvider } from '@parser/value-scope'
import { createTypirLangiumServices, initializeLangiumTypirServices } from 'typir-langium'
import { type TaoSpecifics, TaoTypeSystem, type TaoTypirServices } from './type-system'

type Services = {
  shared: Langium.LangiumSharedCoreServices
  language: Langium.LangiumDefaultCoreServices
  typir: TaoTypirServices
}

/** ValidatorParseResult declares a parse result built by validator-owned services. */
export type ValidatorParseResult = ParseResult & {
  typir: TaoTypirServices
}

/** parseCodeForValidation parses Tao source with validator-owned Langium and Typir services. */
export async function parseCodeForValidation(code: string, opts: ParseOptions = {}): Promise<ValidatorParseResult> {
  const services = createValidatorServices()
  const uri = opts.uri ?? Langium.URI.file('/__tao__/source.tao')
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(code, uri)
  return await buildDocument(services, document)
}

/** parseFileForValidation parses a Tao file with validator-owned Langium and Typir services. */
export async function parseFileForValidation(path: string): Promise<ValidatorParseResult> {
  const services = createValidatorServices()
  const document = await services.shared.workspace.LangiumDocumentFactory.fromUri<AST.TaoFile>(Langium.URI.file(path))
  return await buildDocument(services, document)
}

/** rebuildForValidation reparses a parser result with validator-owned services. */
export async function rebuildForValidation(parsed: ParseResult): Promise<ValidatorParseResult> {
  return await parseCodeForValidation(parsed.document.textDocument.getText(), { uri: parsed.document.uri })
}

/** createValidatorServices creates Langium services with Tao Typir services initialized. */
export function createValidatorServices(): Services {
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
  initializeLangiumTypirServices(language, typir)

  return { shared, language, typir }
}

async function buildDocument(services: Services, document: AST.Document): Promise<ValidatorParseResult> {
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: false,
  })

  return {
    ast: document.parseResult.value,
    diagnostics: document.diagnostics ?? [],
    document,
    typir: services.typir,
  }
}
