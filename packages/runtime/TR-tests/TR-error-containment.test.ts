import {
  onRuntimeFailure,
  TaoErrorBoundary,
  type TaoErrorBoundaryProps,
} from '@runtime/TR-error-containment'
import { Describe, Expect, Test } from '@shared/test'

function boundary(props: TaoErrorBoundaryProps): TaoErrorBoundary {
  const instance = new TaoErrorBoundary(props)
  ;(instance as any).setState = (update: unknown) => {
    const resolved = typeof update === 'function'
      ? (update as (state: unknown, props: unknown) => unknown)(instance.state, instance.props)
      : update
    instance.state = { ...instance.state, ...(resolved as object) }
  }
  return instance
}

async function reportFailure(instance: TaoErrorBoundary, error: Error): Promise<void> {
  instance.state = { error, phase: 'diagnostic', revision: instance.state.revision }
  instance.componentDidCatch(error, { componentStack: '' })
  const diagnostic = instance.render() as { props: { onRecovered(): void } }
  diagnostic.props.onRecovered()
  await new Promise(resolve => setTimeout(resolve, 0))
}

Describe('Tao error containment diagnostics', () => {
  Test('resolves current frame and state key for each newly caught failure', async () => {
    const reports: any[] = []
    const stop = onRuntimeFailure(artifact => reports.push(artifact.failure))
    const instance = boundary({
      boundaryId: 'workspace',
      frame: { boundary: 'screen', declaration: 'FirstScreen' },
      stateKey: 'first-state',
    })
    const warn = console.warn
    console.warn = () => {}
    try {
      await reportFailure(instance, new Error('first failure'))
      ;(instance as any).props = {
        boundaryId: 'workspace',
        frame: { boundary: 'screen', declaration: 'SecondScreen' },
        stateKey: 'second-state',
      }
      await reportFailure(instance, new Error('second failure'))

      Expect(reports).toHaveLength(2)
      Expect(reports[0]?.frame.declaration).toBe('FirstScreen')
      Expect(reports[1]?.frame.declaration).toBe('SecondScreen')
      Expect(reports[1]?.stopper).toBe(false)
    } finally {
      console.warn = warn
      stop()
    }
  })
})
