import { Describe, Expect, Test } from '@shared/test'
import { StorageTesting } from '../dev-cli-src/git/Storage'

type Run = Parameters<typeof StorageTesting.qaCommitMessage>[0][number]
type Shot = Run['shots'][number]

function run(shots: readonly Shot[], overrides: Partial<Run> = {}): Run {
  return {
    appearances: ['light', 'dark'],
    apps: ['WordFlower', 'WordFlowerDark'],
    devices: ['phone', 'tablet', 'laptop'],
    runId: '2026-09-27T20-05-14Z',
    shots,
    source: { branch: 'feat/x', commit: '0123456789abcdef', dirty: false, subject: 'Tighten the toast' },
    ...overrides,
  }
}

const captured = (name: string, change: Shot['change']): Shot => ({ change, name: `${name}.png`, status: 'captured' })

Describe('storage QA commit messages', () => {
  Test('summarise a run by what changed, then list the run, its source, and each change', () => {
    const message = StorageTesting.qaCommitMessage([run([
      captured('A_one', 'changed'),
      captured('A_two', 'new'),
      captured('A_three', 'unchanged'),
      { error: 'The preview kept changing across 4 settled captures.', name: 'A_four.png', status: 'failed' },
    ], { note: 'After the toast redesign', selection: ['SavedToast'] })])
    Expect(message).toBe([
      'QA WordFlower, WordFlowerDark: 1 changed, 1 new, 1 failed of 4 screenshots',
      '',
      '- Run: 2026-09-27T20-05-14Z on phone, tablet, laptop in light, dark',
      '- Selection: SavedToast',
      '- Source: feat/x 01234567 Tighten the toast',
      '- Changed: A_one',
      '- New: A_two',
      '- Failed: A_four — The preview kept changing across 4 settled captures.',
      '- Note: After the toast redesign',
    ].join('\n'))
  })

  Test('say so when nothing changed, since the run still records that the screens held', () => {
    const message = StorageTesting.qaCommitMessage([run([captured('A_one', 'unchanged')], {
      apps: ['WordFlower'],
      source: { branch: 'main', commit: 'fedcba9876543210', dirty: true, subject: 'Refactor' },
    })])
    Expect(message.split('\n')).toEqual([
      'QA WordFlower: no changes across 1 screenshot',
      '',
      '- Run: 2026-09-27T20-05-14Z on phone, tablet, laptop in light, dark',
      '- Source: main fedcba98 Refactor (with uncommitted changes)',
    ])
  })

  Test('cap each list at ten names and count the rest', () => {
    const added = Array.from({ length: 12 }, (_, index) => captured(`S${index + 1}`, 'new'))
    const line = StorageTesting.qaCommitMessage([run(added)]).split('\n').find(text => text.startsWith('- New:'))
    Expect(line).toBe('- New: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, and 2 more')
  })

  Test("summarise several projects' runs as one capture, naming Studio when its shots rode along", () => {
    const source = { branch: 'feat/x', commit: '0123456789abcdef', dirty: false, subject: 'Tighten the toast' }
    const message = StorageTesting.qaCommitMessage([
      run([captured('WordFlower_a', 'new'), {
        app: 'Studio',
        change: 'new',
        name: 'Studio_run.png',
        status: 'captured',
      }], {
        project: 'Apps/WordFlower/1 - Current',
      }),
      run([captured('Pantry_a', 'unchanged')], {
        apps: ['Pantry'],
        project: 'Apps/Starters/Pantry',
        runId: '2026-09-27T20-09-02Z',
        source,
      }),
    ])
    Expect(message.split('\n')).toEqual([
      'QA WordFlower, WordFlowerDark, Studio, Pantry: 2 new of 3 screenshots',
      '',
      '- Run: 2026-09-27T20-05-14Z of Apps/WordFlower/1 - Current on phone, tablet, laptop in light, dark',
      '- Run: 2026-09-27T20-09-02Z of Apps/Starters/Pantry on phone, tablet, laptop in light, dark',
      '- Source: feat/x 01234567 Tighten the toast',
      '- New: WordFlower_a, Studio_run',
    ])
  })
})
