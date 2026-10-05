import { Expect, Test } from '@shared/test'
import { devLoopRequest } from '../shared-src/DevLoopControl'

Test('managed transport refuses non-loopback origins before exposing its credential', async () => {
  await Expect(devLoopRequest({ origin: 'http://example.com:8080', token: 'private', session: 'session' }, '/status'))
    .rejects.toThrow('loopback interface')
  await Expect(
    devLoopRequest({ origin: 'http://127.0.0.1.example.com:8080', token: 'private', session: 'session' }, '/status'),
  )
    .rejects.toThrow('loopback interface')
})
