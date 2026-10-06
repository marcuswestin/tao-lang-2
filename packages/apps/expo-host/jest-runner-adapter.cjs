const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Resolve through Jest's declared dependency graph, including isolated package installations.
const jestRoot = path.dirname(require.resolve('jest/package.json'))
const cliRoot = path.dirname(require.resolve('jest-cli', { paths: [jestRoot] }))
const circusRunner = require.resolve('jest-circus/runner', { paths: [cliRoot] })
const circusRoot = path.dirname(circusRunner)
const deadlineCallback = '() => reject(_makeTimeoutMessage(timeout, isHook, doneCallback))'

function disableCircusDeadlines(environment, runtime) {
  const utilsPath = path.join(circusRoot, 'build/utils.js')
  const source = fs.readFileSync(utilsPath, 'utf8')
  assert.equal(
    require(path.join(circusRoot, 'package.json')).version,
    '29.7.0',
    'Unlimited test deadlines require the verified Jest Circus 29.7.0 adapter seam.',
  )
  assert.ok(
    source.includes('const {setTimeout, clearTimeout} = globalThis;')
      && source.includes(deadlineCallback),
    'Jest Circus deadline capture changed; update its execution probe.',
  )

  const originalSetTimeout = environment.global.setTimeout
  const originalClearTimeout = environment.global.clearTimeout
  const originalSetInterval = environment.global.setInterval
  const originalClearInterval = environment.global.clearInterval
  const keepalives = new Set()
  // Circus captures this pair while loading utils. Other modules loaded by utils may also capture
  // them, so only its verified deadline callback is intercepted; all other timers pass through.
  environment.global.setTimeout = (callback, delay, ...args) => {
    if (typeof callback === 'function' && callback.toString() === deadlineCallback) {
      // A repeating, inert timer keeps an unresolved test alive indefinitely. Its cadence is not
      // a deadline: no callback fails or finishes the test, and Circus clears it on settlement.
      const handle = originalSetInterval(() => {}, 2_147_483_647)
      keepalives.add(handle)
      return handle
    }
    return originalSetTimeout(callback, delay, ...args)
  }
  environment.global.clearTimeout = handle => {
    if (keepalives.delete(handle)) {
      originalClearInterval(handle)
    } else {
      originalClearTimeout(handle)
    }
  }
  try {
    // Preserve Circus's own module load order: loading utils alone enters its state/utils cycle
    // before makeDescribe exists. The stock runner loads this same initializer first.
    runtime.requireInternalModule(path.join(circusRoot, 'build/legacy-code-todo-rewrite/jestAdapterInit.js'))
  } finally {
    // Restore before setup files and test/application code execute, including fake timer setup.
    environment.global.setTimeout = originalSetTimeout
    environment.global.clearTimeout = originalClearTimeout
  }
}

function fullName(item) {
  const names = []
  for (let current = item; current?.parent; current = current.parent) {
    names.unshift(current.name)
  }
  return names.join(' ')
}

function installProgress(environment, testPath) {
  const original = environment.handleTestEvent?.bind(environment)
  const started = new WeakMap()
  function write(phase, kind, item, status) {
    const name = kind === 'test' ? fullName(item) : `${item.type} ${fullName(item.parent)}`.trim()
    const elapsedMs = phase === 'START' ? undefined : Date.now() - started.get(item)
    if (phase === 'START') {
      started.set(item, Date.now())
    }
    process.stderr.write(`[tao-jest] ${JSON.stringify({ phase, kind, name, testPath, status, elapsedMs })}\n`)
  }
  environment.handleTestEvent = async (event, state) => {
    if (original) {
      await original(event, state)
    }
    if (event.name === 'run_start') {
      const wrapConcurrentBodies = block => {
        for (const child of block.children) {
          if (child.type === 'describeBlock') {
            wrapConcurrentBodies(child)
          } else if (child.concurrent && child.fn) {
            const body = child.fn
            // Circus schedules concurrent bodies before test_start, and reports test_done when
            // it later awaits them. Report the executing body now; its final verdict stays END.
            child.fn = async function(...bodyArgs) {
              write('START', 'test', child)
              try {
                const result = await body.apply(this, bodyArgs)
                write('BODY_END', 'test', child, 'completed')
                return result
              } catch (error) {
                write('BODY_END', 'test', child, 'failed')
                throw error
              }
            }
          }
        }
      }
      wrapConcurrentBodies(state.rootDescribeBlock)
    }
    if (event.name === 'test_start' && !started.has(event.test)) {
      write('START', 'test', event.test)
    }
    if (event.name === 'test_done') {
      write('END', 'test', event.test, event.test.errors.length ? 'failed' : 'passed')
    }
    if (event.name === 'test_skip') {
      write('END', 'test', event.test, 'skipped')
    }
    if (event.name === 'test_todo') {
      write('END', 'test', event.test, 'todo')
    }
    if (event.name === 'hook_start') {
      write('START', 'hook', event.hook)
    }
    if (event.name === 'hook_success') {
      write('END', 'hook', event.hook, 'passed')
    }
    if (event.name === 'hook_failure') {
      write('END', 'hook', event.hook, 'failed')
    }
  }
}

module.exports = async function runWithVerificationPolicy(...args) {
  const [, , environment, runtime, testPath] = args
  if (process.env.TAO_VERIFY_NO_TIMEOUTS === 'true') {
    disableCircusDeadlines(environment, runtime)
  }
  if (process.env.TAO_VERIFY_NO_TIMEOUTS === 'true' || process.env.TAO_VERIFY_LIVE_PROGRESS === 'true') {
    installProgress(environment, testPath)
  }
  return require(circusRunner)(...args)
}
