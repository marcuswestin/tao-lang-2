import { Langium } from 'tao-parser'
import { createValidatorLspServices } from 'tao-validator/langium-services'

const connection = Langium.createConnection(Langium.ProposedFeatures.all)
const services = createValidatorLspServices({ connection, ...Langium.NodeFileSystem })

Langium.startLanguageServer(services.shared)
