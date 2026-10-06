import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { CiDurationsImport, fold, unzip } from '../dev-cli-src/pr/CiDurationsImport'
import { CiTimingsCommand } from '../dev-cli-src/pr/CiTimingsCommand'
import type { PrChecksDependencies } from '../dev-cli-src/pr/PrChecksCommand'

/**
 * The scripted `fetch` answers the Actions API by path with one run whose three partitions each
 * uploaded a `summary.json` zipped the way GitHub serves artifacts, so the fold into the seed and
 * the measured spread are checked against arithmetic without a network or a token store.
 */

const SLUG = 'owner/repo'

/** zip writes a minimal archive: local headers, central directory, end record. CRCs are not checked. */
function zip(entries: Record<string, string>, deflate: boolean): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = new TextEncoder().encode(name)
    const raw = new TextEncoder().encode(text)
    const data = deflate ? new Uint8Array(Bun.deflateSync(raw, { windowBits: -15 })) : raw
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(8, deflate ? 8 : 0, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, raw.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const header = new Uint8Array(46 + nameBytes.length)
    const headerView = new DataView(header.buffer)
    headerView.setUint32(0, 0x02014b50, true)
    headerView.setUint16(10, deflate ? 8 : 0, true)
    headerView.setUint32(20, data.length, true)
    headerView.setUint32(24, raw.length, true)
    headerView.setUint16(28, nameBytes.length, true)
    headerView.setUint32(42, offset, true)
    header.set(nameBytes, 46)
    parts.push(local, data)
    central.push(header)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, central.length, true)
  endView.setUint16(10, central.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const bytes = new Uint8Array(all.reduce((total, part) => total + part.length, 0))
  let cursor = 0
  for (const part of all) {
    bytes.set(part, cursor)
    cursor += part.length
  }
  return bytes
}

function summary(index: number, gates: [string, number, string?][]) {
  return JSON.stringify({
    elapsedMs: gates.reduce((total, [, ms]) => total + ms, 0) + 5_000,
    gates: gates.map(([name, elapsedMs, status]) => ({
      elapsedMs,
      name,
      status: status ?? 'passed',
      ...(name.includes('#') ? { suite: name.split('#')[0] } : {}),
    })),
    partition: { count: 3, digest: 'abc', index },
  })
}

function fakeDependencies(root: string, options: { token?: string; ghToken?: string } = {}) {
  const lines: string[] = []
  const requested: string[] = []
  const authorizations: (string | undefined)[] = []
  const respond = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
  const summaries: Record<number, string> = {
    1: summary(1, [['shared#1', 60_000], ['_lint', 20_000], ['skipped-one', 0, 'skipped']]),
    2: summary(2, [['shared#2', 40_000]]),
    3: summary(3, [['testing/verification#1', 90_000]]),
  }
  const dependencies: PrChecksDependencies = {
    env: options.token === undefined ? {} : { GH_TOKEN: options.token },
    fetch: async (url, init) => {
      const path = url.replace('https://api.github.com', '')
      requested.push(path)
      authorizations.push(init.headers['Authorization'])
      if (path.startsWith(`/repos/${SLUG}/actions/workflows/verify.yml/runs?branch=main&`)) {
        return respond({
          workflow_runs: [{
            head_branch: 'main',
            head_sha: 'c484883dfeed',
            id: 77,
            updated_at: '2026-10-06T01:00:00Z',
          }],
        })
      }
      if (path === `/repos/${SLUG}/actions/runs/77/artifacts?per_page=100`) {
        return respond({
          artifacts: [
            { expired: false, id: 1003, name: 'verify-partition-3' },
            { expired: false, id: 1001, name: 'verify-partition-1' },
            { expired: false, id: 9999, name: 'something-else' },
            { expired: false, id: 1002, name: 'verify-partition-2' },
          ],
        })
      }
      const artifact = /\/actions\/artifacts\/100(\d)\/zip$/u.exec(path)
      if (artifact !== null) {
        if (init.headers['Authorization'] === undefined) {
          return respond({ message: 'Requires authentication' }, 401)
        }
        const index = Number(artifact[1])
        return new Response(zip({ 'summary.json': summaries[index]! }, index !== 2), { status: 200 })
      }
      return respond({ message: 'Not Found' }, 404)
    },
    now: () => 0,
    run: async (command, spec = {}) => {
      const args = (spec.args ?? []).join(' ')
      const stdout = args === 'remote get-url origin'
        ? `git@github.com:${SLUG}.git\n`
        : command === 'gh' && args === 'auth token'
        ? `${options.ghToken ?? ''}\n`
        : ''
      return { args: [...(spec.args ?? [])], command, cwd: spec.cwd, exitCode: 0, signal: null, stderr: '', stdout }
    },
    sleep: async () => {},
    writeLine: line => lines.push(line),
  }
  return { authorizations, dependencies, lines, requested, root }
}

Describe('ci-timings --import-durations', () => {
  Test('folds every partition summary of the newest green main run into the seed, count-agnostically', async () => {
    const root = await mkTestDir('tao-ci-durations-')
    const seedPath = FS.resolvePath('.github/verify/durations.json', root)
    await FS.writeJson(seedPath, {
      nodes: {
        'shared#1': { emaMs: 100_000, lastMs: 100_000, lastRunAt: '2026-10-05T00:00:00.000Z', samples: 1 },
        _lint: { emaMs: 10_000, lastMs: 10_000, lastRunAt: '2026-10-05T00:00:00.000Z', samples: 3 },
        'studio-smoke': { emaMs: 70_000, lastMs: 70_000, lastRunAt: '2026-10-05T00:00:00.000Z', samples: 1 },
      },
      version: 1,
    })
    const fake = fakeDependencies(root, { token: 'ghp_test' })
    const result = await CiTimingsCommand.run({ importDurations: true, repositoryRoot: root }, fake.dependencies)
    Expect(result.exitCode).toBe(0)

    const store = await FS.readJson<{ nodes: Record<string, Record<string, unknown>> }>(seedPath)
    // A single-sample prior is replaced; an averaged node moves by the wall EMA weight; a new one takes
    // the measurement; an unmeasured one stays.
    Expect(store.nodes['shared#1']).toEqual({
      emaMs: 60_000,
      lastMs: 60_000,
      lastRunAt: '2026-10-06T01:00:00Z',
      lastWallMs: 60_000,
      samples: 1,
      source: 'wall',
    })
    Expect(store.nodes['_lint']?.['emaMs']).toBe(13_000)
    Expect(store.nodes['_lint']?.['samples']).toBe(4)
    Expect(store.nodes['testing/verification#1']?.['emaMs']).toBe(90_000)
    Expect(store.nodes['testing/verification#1']?.['samples']).toBe(1)
    Expect(store.nodes['studio-smoke']).toEqual({
      emaMs: 70_000,
      lastMs: 70_000,
      lastRunAt: '2026-10-05T00:00:00.000Z',
      samples: 1,
    })
    Expect(store.nodes['skipped-one']).toBeUndefined()
    Expect(Object.keys(store.nodes)).toEqual([
      '_lint',
      'shared',
      'shared#1',
      'shared#2',
      'studio-smoke',
      'testing/verification',
      'testing/verification#1',
    ])
    // A sharded suite's total is the sum of its shards: the number the planner apportions by ledger cost.
    Expect(store.nodes['shared']?.['emaMs']).toBe(100_000)

    // Only the three partition artifacts are downloaded, each with the token.
    const downloads = fake.requested.filter(path => path.endsWith('/zip'))
    Expect(downloads.sort()).toEqual([
      `/repos/${SLUG}/actions/artifacts/1001/zip`,
      `/repos/${SLUG}/actions/artifacts/1002/zip`,
      `/repos/${SLUG}/actions/artifacts/1003/zip`,
    ])
    Expect(fake.authorizations.every(header => header === 'Bearer ghp_test')).toBe(true)

    Expect(fake.lines[0]).toBe('Importing run 77 on main at c484883d, updated 2026-10-06T01:00:00Z.')
    Expect(fake.lines).toContain('Measured 3-way spread (node time per partition): 40–90 s, ratio 2.25.')
    Expect(fake.lines).toContain('  partition 1: 80 s of node time in 85 s wall, 2 nodes')
    Expect(fake.lines.at(-1)).toBe(
      'Folded 6 durations into .github/verify/durations.json (2 suite totals summed from their shards): 4 new, 2 updated, 1 kept without a CI measurement.',
    )
  })

  Test('takes the token from the gh login when the environment has none, and refuses without either', async () => {
    const root = await mkTestDir('tao-ci-durations-')
    const withGh = fakeDependencies(root, { ghToken: 'gho_login' })
    const result = await CiDurationsImport.run({ repositoryRoot: root }, withGh.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(withGh.authorizations.every(header => header === 'Bearer gho_login')).toBe(true)

    const without = fakeDependencies(root)
    await Expect(CiDurationsImport.run({ repositoryRoot: root }, without.dependencies)).rejects.toThrow(
      /needs GitHub authentication/u,
    )
    Expect(without.requested).toEqual([])
  })

  Test('unzip reads stored and deflated entries', () => {
    const entries = unzip(zip({ 'a/summary.json': '{"a":1}', 'log.txt': 'hello' }, true))
    Expect(new TextDecoder().decode(entries.get('a/summary.json'))).toBe('{"a":1}')
    Expect(new TextDecoder().decode(entries.get('log.txt'))).toBe('hello')
    Expect(new TextDecoder().decode(unzip(zip({ 'x': 'stored' }, false)).get('x'))).toBe('stored')
  })

  Test('fold reports a warning-free count and sorts the seed', () => {
    const folded = fold(
      { nodes: { b: { emaMs: 10, lastMs: 10, lastRunAt: 't', samples: 1 } }, version: 1 },
      new Map([['a', 5]]),
      'now',
    )
    Expect(folded.added).toBe(1)
    Expect(folded.updated).toBe(0)
    Expect(Object.keys(folded.store.nodes)).toEqual(['a', 'b'])
  })
})
