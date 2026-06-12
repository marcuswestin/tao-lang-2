import { TaoFormatter } from 'tao-formatter'
import { Langium } from 'tao-parser'
import { createValidatorLspServices } from 'tao-validator/langium-services'

const connection = Langium.createConnection(Langium.ProposedFeatures.all)
const services = createValidatorLspServices({ connection, ...Langium.NodeFileSystem }, {
  lspFormatter: () => new TaoFormatter(),
})

Langium.startLanguageServer(services.shared)
