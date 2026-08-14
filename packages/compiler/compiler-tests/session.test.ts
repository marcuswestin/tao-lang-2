import { Describe, Expect, Test } from '@shared/test'
import Compiler from '../compiler-src/compiler'

Describe('compiler: reusable sessions', () => {
  Test('shares one-shot services until explicitly invalidated', async () => {
    Compiler.invalidateSharedSession()
    const firstSession = await Compiler.sharedSession()

    Expect(await Compiler.sharedSession()).toBe(firstSession)
    Expect((await Compiler.compileCode(appSource('SharedApp'))).appNames).toEqual(['SharedApp'])
    Expect(await Compiler.sharedSession()).toBe(firstSession)

    Compiler.invalidateSharedSession()
    const replacementSession = await Compiler.sharedSession()

    Expect(replacementSession).not.toBe(firstSession)
    Expect((await firstSession.compileCode(appSource('DetachedApp'))).appNames).toEqual(['DetachedApp'])
  })

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

    await Expect(session.compileCode('view Broken { render }')).rejects.toThrow(
      'Cannot compile Tao source with validation errors',
    )
    Expect((await session.compileCode(appSource('RecoveredApp'))).appNames).toEqual(['RecoveredApp'])
  })
})

function appSource(appName: string): string {
  return `
    app ${appName} { view MainView }
    view MainView {
      render inject \`\`\`ts
        return null
      \`\`\`
    }
  `
}
