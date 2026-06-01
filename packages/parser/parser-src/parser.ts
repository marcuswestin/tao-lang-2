import * as LGM from 'langium'
import { NodeFileSystem } from 'langium/node'
import * as AST from './parserASTExport'

export * as LGM from 'langium'
export * as LGMGenerate from 'langium/generate'
export * as LGMNode from 'langium/node'
export { AST }

export type TaoParserServices = {
  shared: LGM.LangiumSharedCoreServices
  TaoLang: LGM.LangiumCoreServices
}

export type ParseTaoOptions = {
  uri?: LGM.URI
}

export type ParseTaoResult = {
  ast: AST.TaoFile
  diagnostics: readonly AST.ParseDiagnostic[]
  document: AST.Document
}

export function createTaoParserServices(
  context: LGM.DefaultSharedCoreModuleContext = NodeFileSystem,
): TaoParserServices {
  const shared = LGM.inject(
    LGM.createDefaultSharedCoreModule(context),
    AST.GeneratedSharedModule,
  )
  const TaoLang = LGM.inject(
    LGM.createDefaultCoreModule({ shared }),
    AST.GeneratedModule,
  )
  shared.ServiceRegistry.register(TaoLang)

  return { shared, TaoLang }
}

export async function parseTaoFile(path: string): Promise<ParseTaoResult> {
  const services = createTaoParserServices()
  const document = await services.shared.workspace.LangiumDocumentFactory.fromUri<AST.TaoFile>(LGM.URI.file(path))
  return await buildDocument(services, document)
}

export async function parseTaoSource(source: string, opts: ParseTaoOptions = {}): Promise<ParseTaoResult> {
  const services = createTaoParserServices()
  const uri = opts.uri ?? LGM.URI.file('/__tao__/source.tao')
  const document = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(source, uri)
  return await buildDocument(services, document)
}

async function buildDocument(services: TaoParserServices, document: AST.Document): Promise<ParseTaoResult> {
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {
    eagerLinking: true,
    validation: false,
  })

  return {
    ast: document.parseResult.value,
    diagnostics: document.diagnostics ?? [],
    document,
  }
}
