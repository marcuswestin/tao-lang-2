import * as RenderApp from '@expo-host/testing/render-app'
import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { jest } from '@jest/globals'
import { Errors, FS } from '@shared'
import { AfterEach, Deferred, Describe, Expect, Test } from '@shared/test'
import { render } from '@testing-library/react-native'
import { createElement } from 'react'
import { Text } from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileFiles } from './test-compile-app'

const lifecycle = registerRuntimeE2ELifecycle()

AfterEach(() => jest.restoreAllMocks())

function fixtureCompiler() {
  const compile = jest.spyOn(RuntimeTesting.TestCompiler.Worker, 'compileApp')
    .mockImplementation(async appPath => ({ testAppPath: FS.basename(appPath) }))
  const mount = jest.spyOn(RenderApp, 'renderCompiledApp').mockImplementation(app =>
    render(createElement(Text, {}, app.testAppPath))
  )
  return { compile, mount }
}

Describe('runtime fixture lifetime', () => {
  Test('does not compile or publish a source factory after its test ends', async () => {
    const { compile, mount } = fixtureCompiler()
    const source = Deferred<Record<string, string>>()
    const assertions = jest.fn<() => void>()
    const expired = testCompileFiles('Old.tao', () => source.promise, assertions).catch(error => error)
    lifecycle.end()
    lifecycle.begin()
    source.resolve({ 'Old.tao': '' })
    const result = await expired
    Expect(assertions).not.toHaveBeenCalled()
    Expect(compile).not.toHaveBeenCalled()
    Expect(mount).not.toHaveBeenCalled()
    Expect(result).toMatchObject({ name: 'AbortError' })

    await testCompileFiles('Current.tao', { 'Current.tao': '' }, screen => {
      screen.getByText('Current.tao')
    })
    Expect(mount).toHaveBeenCalledTimes(1)
  })

  Test('does not mount a late compilation or disturb the next test', async () => {
    const { compile, mount } = fixtureCompiler()
    const compiled = Deferred<RuntimeTesting.CompiledApp>()
    const started = Deferred<void>()
    compile.mockImplementationOnce(async () => {
      started.resolve()
      return await compiled.promise
    })
    const assertions = jest.fn<() => void>()
    const expired = testCompileFiles('Old.tao', { 'Old.tao': '' }, assertions).catch(error => error)
    await started.promise
    lifecycle.end()
    lifecycle.begin()
    await testCompileFiles('Current.tao', { 'Current.tao': '' }, async screen => {
      compiled.resolve({ testAppPath: 'Old.tao' })
      Expect(await expired).toMatchObject({ name: 'AbortError' })
      screen.getByText('Current.tao')
      Expect(mount).toHaveBeenCalledTimes(1)
      Expect(assertions).not.toHaveBeenCalled()
    })
  })

  Test('aborting after a mount disposes only that render and leaves another owner live', async () => {
    fixtureCompiler()
    const previous = new AbortController()
    const current = new AbortController()
    const oldScreen = await RuntimeTesting.compileAndRenderApp('Old.tao', { signal: previous.signal })
    const currentScreen = await RuntimeTesting.compileAndRenderApp('Current.tao', { signal: current.signal })
    const oldUnmount = jest.spyOn(oldScreen, 'unmount')
    const currentUnmount = jest.spyOn(currentScreen, 'unmount')
    previous.abort(Errors.abortError('Previous test ended.'))
    Expect(oldUnmount).toHaveBeenCalledTimes(1)
    Expect(currentUnmount).not.toHaveBeenCalled()
    currentScreen.getByText('Current.tao')
    current.abort(Errors.abortError('Current test ended.'))
    Expect(currentUnmount).toHaveBeenCalledTimes(1)
  })

  Test('an abort during mounting disposes the acquired render before publishing it', async () => {
    const { mount } = fixtureCompiler()
    const lifetime = new AbortController()
    let unmountCalls = 0
    mount.mockImplementationOnce(app => {
      const screen = render(createElement(Text, {}, app.testAppPath))
      const unmount = screen.unmount
      screen.unmount = () => {
        unmountCalls += 1
        unmount()
      }
      lifetime.abort(Errors.abortError('The test ended during mounting.'))
      return screen
    })
    const result = await RuntimeTesting.compileAndRenderApp('Old.tao', { signal: lifetime.signal })
      .catch(error => error)
    Expect(result).toMatchObject({ name: 'AbortError' })
    Expect(unmountCalls).toBe(1)
  })
})
