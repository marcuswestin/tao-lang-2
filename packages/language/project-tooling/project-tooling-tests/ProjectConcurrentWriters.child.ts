import { Errors, FS, HCI, Platform, Time } from '@shared'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

const [, , root, gatesRoot] = Platform.runtimeProcess.argv
if (root === undefined || gatesRoot === undefined) {
  Errors.throwUnexpected('Expected a project root and gate directory.')
}

for (let phase = 0; phase < 3; phase += 1) {
  HCI.writeLine(`READY:${phase}`)
  const gatePath = FS.resolvePath(String(phase), gatesRoot)
  while (!await FS.isFile(gatePath)) {
    await Time.sleep(20)
  }
  const results = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await ProjectTooling.refresh(root, {})
    results.push({
      status: result.status,
      diagnostics: result.diagnostics.map(diagnostic => ({
        code: diagnostic.code,
        filePath: diagnostic.filePath,
        severity: diagnostic.severity,
      })),
      contractPaths: result.contractPaths,
      sourceMappings: result.sourceMappings,
      revision: result.revision,
    })
  }
  HCI.writeLine(`RESULT:${JSON.stringify({ phase, results })}`)
}
