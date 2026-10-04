import { Describe, Expect, Test } from '@shared/test'
import Compiler from '../compiler-src/compiler'

Describe('compiler: reusable sessions', () => {
  Test('isolates concurrent compilations that reuse the standalone source URI', async () => {
    const session = await Compiler.createSession()
    const results = await Promise.all([
      session.compileCode(appSource('FirstApp')),
      session.compileCode(appSource('SecondApp')),
      session.compileCode(appSource('ThirdApp')),
    ])

    Expect(results.map(result => result.appNames)).toEqual([
      ['FirstApp'],
      ['SecondApp'],
      ['ThirdApp'],
    ])
  })

  Test('continues after a queued compilation fails', async () => {
    const session = await Compiler.createSession()

    await Expect(session.compileCode('view Broken() { render }')).rejects.toThrow(
      'Cannot compile Tao source with validation errors',
    )
    Expect((await session.compileCode(appSource('RecoveredApp'))).appNames).toEqual(['RecoveredApp'])
  })
})

function appSource(appName: string): string {
  return `
    app ${appName} { id "com.tao.test.${appName.toLowerCase()}" version "1.0.0" name "${appName}" view MainView }
    view MainView() {
      render inject \`\`\`ts
        return null
      \`\`\`
    }
  `
}
