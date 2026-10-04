import {
  onRuntimeFailure,
  TaoErrorBoundary,
  type TaoErrorBoundaryProps,
} from '@runtime/TR-error-containment'
import { warnContainedFailure, warnDesignDivergence } from '@runtime/TR-errors'
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
  Test('resolves the current frame for each newly caught failure', async () => {
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

Describe('Tao contained-failure warnings', () => {
  Test('reports a swallowed failure outside production only', () => {
    const calls: unknown[][] = []
    const warn = console.warn
    const environment = process.env.NODE_ENV
    console.warn = (...args: unknown[]) => calls.push(args)
    try {
      process.env.NODE_ENV = 'development'
      warnContainedFailure('Native navigation surfaces are unavailable.', new Error('no binary'))
      process.env.NODE_ENV = 'production'
      warnContainedFailure('Native navigation surfaces are unavailable.', new Error('no binary'))
    } finally {
      console.warn = warn
      if (environment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = environment
      }
    }

    Expect(calls).toHaveLength(1)
    Expect(calls[0]?.[0]).toBe('Native navigation surfaces are unavailable.')
    Expect((calls[0]?.[1] as Error).message).toBe('no binary')
  })
})

Describe('Tao design-divergence warnings', () => {
  Test('reports an unhonorable declaration outside production only, and without an error', () => {
    const calls: unknown[][] = []
    const warn = console.warn
    const environment = process.env.NODE_ENV
    console.warn = (...args: unknown[]) => calls.push(args)
    try {
      process.env.NODE_ENV = 'development'
      warnDesignDivergence('Tao: the platform-native Switch ignores styling clauses.')
      process.env.NODE_ENV = 'production'
      warnDesignDivergence('Tao: the platform-native Switch ignores styling clauses.')
    } finally {
      console.warn = warn
      if (environment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = environment
      }
    }

    Expect(calls).toEqual([['Tao: the platform-native Switch ignores styling clauses.']])
  })
})
