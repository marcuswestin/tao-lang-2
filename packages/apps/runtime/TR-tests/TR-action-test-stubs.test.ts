import TR from '@runtime/TR'
import { Expect, Test } from '@shared/test'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'

Test('a suspended action keeps its check failure stub when the next check starts', async () => {
  const Failure = TR.Enum(
    TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'StubRace', 'enum', 'Failure']),
    [
      'Offline',
      'TooLarge',
    ],
  )
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  let sidecarCalls = 0
  let firstCase: string | undefined
  let secondCase: string | undefined
  const foreign = TR.ForeignAction(
    () => {
      sidecarCalls += 1
    },
    'Export',
    [
      { case: Failure['Offline']!, sentence: 'Offline sentence.' },
      { case: Failure['TooLarge']!, sentence: 'Too large sentence.' },
    ],
    { testStubKey: 'export-stub-race' },
  )
  const first = TR.Action(async () => {
    const continuation = TR.ActionContinuation()
    await firstGate
    TR.ResumeActionContinuation(continuation)
    try {
      await TR.Do(foreign)
    } catch (error) {
      if (error instanceof TaoActionFailure) {
        firstCase = error.caseName
      }
    }
  })
  const second = TR.Action(async () => {
    try {
      await TR.Do(foreign)
    } catch (error) {
      if (error instanceof TaoActionFailure) {
        secondCase = error.caseName
      }
    }
  })

  TR.Navigation.beginTest()
  TR.TestActionStubs.beginTest([{ actionKey: 'export-stub-race', caseName: 'Offline' }])
  try {
    const pendingFirst = first.jsValue.invoke()
    TR.TestActionStubs.endTest()
    TR.Navigation.beginTest()
    TR.TestActionStubs.beginTest([{ actionKey: 'export-stub-race', caseName: 'TooLarge' }])

    releaseFirst()
    await pendingFirst
    await second.jsValue.invoke()

    Expect(firstCase).toBe('Offline')
    Expect(secondCase).toBe('TooLarge')
    Expect(sidecarCalls).toBe(0)
  } finally {
    TR.TestActionStubs.endTest()
    TR.Navigation.endTest()
  }
})
