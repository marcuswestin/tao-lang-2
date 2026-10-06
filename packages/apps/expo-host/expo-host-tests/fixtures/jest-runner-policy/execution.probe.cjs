const wait = () => new Promise(resolve => setTimeout(resolve, 25))

if (process.env.TAO_JEST_PROBE_PENDING === 'true') {
  test('pending work stays alive', async () => {
    process.stderr.write('PROBE_PENDING\n')
    await new Promise(() => {})
  }, 1)
} else {
  describe('explicit hook budgets', () => {
    beforeAll(wait, 1)
    beforeEach(done => {
      setTimeout(done, 25)
    }, 1)
    afterEach(wait, 1)
    afterAll(done => {
      setTimeout(done, 25)
    }, 1)
    test('hooks completed', () => expect(true).toBe(true))
  })
  test('configured default and jest override budgets', async () => {
    jest.setTimeout(1)
    await wait()
    expect(typeof document).toBe(process.env.TAO_JEST_PROBE_ENVIRONMENT === 'jsdom' ? 'object' : 'undefined')
  })
  test('explicit promise budget', async () => {
    await wait()
    expect(process.env.TAO_JEST_PROBE_FAIL).not.toBe('true')
  }, 1)
  test('explicit callback budget', done => {
    setTimeout(() => {
      expect(1 + 1).toBe(2)
      done()
    }, 25)
  }, 1)
  test.concurrent('explicit concurrent budget', async () => {
    await wait()
    expect(true).toBe(true)
  }, 1)
  test('application fake timers remain usable and cancellable', () => {
    jest.useFakeTimers()
    const callbacks = []
    const cancelled = setTimeout(() => callbacks.push('cancelled'), 25)
    clearTimeout(cancelled)
    setTimeout(() => callbacks.push('fired'), 25)
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(25)
    expect(callbacks).toEqual(['fired'])
    jest.useRealTimers()
  }, 1)
  test.skip('skipped probe', () => {})
  test.todo('future probe')
}
