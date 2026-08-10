import { resolve } from 'node:path'
import { generate } from 'rulesync'

const repoRoot = resolve(import.meta.dir, '..')

await generate({
  configPath: '.rulesync/rulesync.jsonc',
  inputRoot: repoRoot,
  outputRoots: [repoRoot],
})
