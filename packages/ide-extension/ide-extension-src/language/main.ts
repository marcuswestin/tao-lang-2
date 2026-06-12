import { TaoFormatter } from 'tao-formatter'
import { Langium } from 'tao-parser'
import { TaoCodeActionProvider } from 'tao-source-actions/langium-code-actions'
import { createValidatorLspServices } from 'tao-validator/langium-services'

const connection = Langium.createConnection(Langium.ProposedFeatures.all)
const services = createValidatorLspServices({ connection, ...Langium.NodeFileSystem }, {
  lspFormatter: () => new TaoFormatter(),
  lspCodeActionProvider: () => new TaoCodeActionProvider(),
})

Langium.startLanguageServer(services.shared)
