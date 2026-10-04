import { Expect, Test } from '@shared/test'
import { hostCommandTarget } from '../agent-cli-src/agent-config/HostCommandTargets'
import { parseManagedLoopAcceptanceArgs } from '../agent-cli-src/agent-config/ManagedLoopAcceptanceArgs'
import { validStudioProofArgs } from '../agent-cli-src/agent-config/StudioProofArgs'

const session = '0fe7bb54-bbc8-4133-897f-e9d0b2d6b37a'

Test('combined proofs are fixed owned cases without caller target or failure selectors', () => {
  for (const selected of ['combined-lifecycle', 'combined-target-failure']) {
    Expect(parseManagedLoopAcceptanceArgs(['--case', selected]).case).toBe(selected)
    for (
      const extra of [['--session', session], ['--target', 'web'], ['--simulator', session], ['--fault', 'ios'], [
        '--command',
        'external',
      ]]
    ) {
      Expect(() => parseManagedLoopAcceptanceArgs(['--case', selected, ...extra])).toThrow()
    }
  }
})

Test('visible cases select fixed owned targets and refuse caller sessions or generic visibility flags', () => {
  for (const selected of ['chrome-visible', 'ios-visible', 'android-visible']) {
    Expect(parseManagedLoopAcceptanceArgs(['--case', selected]).case).toBe(selected)
    for (
      const extra of [['--session', session], ['--target', 'android'], ['--show', 'true'], ['--show-emulator', 'true']]
    ) {
      Expect(() => parseManagedLoopAcceptanceArgs(['--case', selected, ...extra])).toThrow()
    }
  }
})

Test('managed fault cases cannot target an existing session or an arbitrary host operation', () => {
  Expect(parseManagedLoopAcceptanceArgs(['--case', 'lifecycle-faults']).case).toBe('lifecycle-faults')
  for (
    const args of [
      ['--case', 'lifecycle-faults', '--session', session],
      ['--case', 'android-abrupt-exit', '--session', session],
      ['--case', 'lifecycle', '--pid', '1'],
      ['--case', 'lifecycle', '--endpoint', 'http://127.0.0.1:1'],
      ['--case', 'lifecycle', '--fault'],
      ['--case', 'lifecycle', '--case', 'chrome'],
      ['--case', 'unknown'],
    ]
  ) {
    Expect(() => parseManagedLoopAcceptanceArgs(args)).toThrow()
  }
})

Test('managed interaction selects only recorded sessions and a supported mobile target', () => {
  Expect(parseManagedLoopAcceptanceArgs(['--case', 'mobile-interaction', '--session', session, '--target', 'ios']))
    .toEqual({ case: 'mobile-interaction', session, target: 'ios' })
  Expect(parseManagedLoopAcceptanceArgs(['--case', 'chrome', '--session', session])).toEqual({
    case: 'chrome',
    session,
    target: undefined,
  })
  for (
    const args of [
      ['--case', 'mobile-interaction'],
      ['--case', 'mobile-interaction', '--session', session, '--target', 'desktop'],
      ['--case', 'mobile-interaction', '--session', 'not-a-session', '--target', 'ios'],
      ['--case', 'chrome', '--target', 'ios'],
      ['--case', 'lifecycle', '--app', 'hnreader'],
    ]
  ) {
    Expect(() => parseManagedLoopAcceptanceArgs(args)).toThrow()
  }
})

Test('isolated native host routes cannot substitute an executable or process selector', () => {
  Expect(hostCommandTarget(['studio-canary'])).toEqual({
    command: './dev',
    fixedArgs: ['studio-canary'],
    argsPolicy: 'studio-proof',
  })
  Expect(validStudioProofArgs([])).toBe(true)
  Expect(validStudioProofArgs(['--show-studio'])).toBe(true)
  Expect(validStudioProofArgs(['--project', 'owned project', '--app', 'Fixture'])).toBe(true)
  for (
    const args of [
      ['--hutch', '/tmp/unowned'],
      ['--launch', 'user-launch'],
      ['--all'],
      ['--artifact-root', '/tmp/unowned'],
      ['--show-studio', '--show-studio'],
      ['--project'],
    ]
  ) {
    Expect(validStudioProofArgs(args)).toBe(false)
  }
})
