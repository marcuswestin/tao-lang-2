import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  BUILD_RECORD_NAME,
  checkBuildFreshness,
  hashFile,
  hashOutputs,
  makeBuildRecord,
} from '../ide-extension-src/build-record/build-identity'

const OUTPUT_ROOTS = ['out', 'syntaxes']

async function builtTree(): Promise<{ root: string; grammar: string; recordPath: string }> {
  const root = await mkTestDir('tao-ide-build-identity-')
  const grammar = FS.resolvePath('syntaxes/tao.tmLanguage.json', root)
  await FS.writeText(grammar, 'base grammar')
  const baseGrammar = await hashFile(grammar)
  await FS.writeText(grammar, 'merged grammar')
  await FS.writeText(FS.resolvePath('out/main.cjs', root), 'bundle')
  const recordPath = FS.resolvePath(`out/${BUILD_RECORD_NAME}`, root)
  await FS.writeJson(recordPath, makeBuildRecord('inputs-a', await hashOutputs(root, OUTPUT_ROOTS), baseGrammar))
  return { root, grammar, recordPath }
}

function check(tree: { root: string; grammar: string; recordPath: string }, inputs = 'inputs-a') {
  return checkBuildFreshness({
    packageRoot: tree.root,
    recordPath: tree.recordPath,
    outputRoots: OUTPUT_ROOTS,
    grammarPath: tree.grammar,
    inputs,
  })
}

Describe('editor build identity', () => {
  Test('an untouched build with the same inputs is fresh', async () => {
    Expect(await check(await builtTree())).toEqual({ status: 'fresh' })
  })

  Test('changed inputs rebuild', async () => {
    Expect((await check(await builtTree(), 'inputs-b')).status).toBe('stale')
  })

  Test('an edited, added, or missing output rebuilds', async () => {
    const edited = await builtTree()
    await FS.writeText(FS.resolvePath('out/main.cjs', edited.root), 'other bundle')
    Expect((await check(edited)).status).toBe('stale')

    const added = await builtTree()
    await FS.writeText(FS.resolvePath('out/extra.cjs', added.root), 'extra')
    Expect((await check(added)).status).toBe('stale')

    const missing = await builtTree()
    await FS.remove(FS.resolvePath('out/main.cjs', missing.root))
    Expect((await check(missing)).status).toBe('stale')
  })

  Test('a tree without a record rebuilds', async () => {
    const tree = await builtTree()
    await FS.remove(tree.recordPath)
    Expect((await check(tree)).status).toBe('stale')
  })

  Test('a grammar the parser generator rewrote unmerged needs only the merge', async () => {
    const tree = await builtTree()
    await FS.writeText(tree.grammar, 'base grammar')
    Expect(await check(tree)).toEqual({ status: 'grammar-unmerged' })
    await FS.writeText(tree.grammar, 'some other grammar')
    Expect((await check(tree)).status).toBe('stale')
  })
})
