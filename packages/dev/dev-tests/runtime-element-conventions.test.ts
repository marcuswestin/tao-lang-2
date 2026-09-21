import { Describe, Expect, Test } from '@shared/test'
import { runtimeElementConventionIssues } from '../dev-src/repository-tests/RuntimeElementConventions'

const runtimePath = 'packages/runtime/TaoRuntime-src/new-feature.tsx'
const helperPath = 'packages/runtime/TaoRuntime-src/TR-create-element.ts'

Describe('runtime element creation boundary', () => {
  Test('rejects React.createElement, the old createReactElement name, and JSX outside the helper', () => {
    const source = [
      'const a = React.createElement(RN.View, null)',
      'const b = createReactElement(RN.Text, null)',
      'function createReactElement() {}',
      'const c = <RN.View />',
      'const d = <RN.View>{children}</RN.View>',
      'const e = <>{children}</>',
    ].join('\n')
    const issues = runtimeElementConventionIssues([{ path: runtimePath, source }])
    Expect(issues).toHaveLength(6)
    Expect(issues.map(issue => issue.split(' ')[0])).toEqual([
      `${runtimePath}:1`,
      `${runtimePath}:2`,
      `${runtimePath}:3`,
      `${runtimePath}:4`,
      `${runtimePath}:5`,
      `${runtimePath}:6`,
    ])
    Expect(issues[0]).toContain('createElement` from `TR-create-element`')
    Expect(issues[3]).toContain('uses JSX')
  })

  Test('rejects importing, indexing, or destructuring createElement off React', () => {
    const source = [
      "import { createElement } from 'react'",
      "const a = React['createElement']",
      'const { createElement } = React',
    ].join('\n')
    const issues = runtimeElementConventionIssues([{ path: runtimePath, source }])
    Expect(issues).toHaveLength(3)
    Expect(issues.map(issue => issue.split(' ')[0])).toEqual([
      `${runtimePath}:1`,
      `${runtimePath}:2`,
      `${runtimePath}:3`,
    ])
  })

  Test('allows the create-element helper and does not flag generics as JSX', () => {
    Expect(runtimeElementConventionIssues([
      {
        path: helperPath,
        source: 'export const createElement: typeof React.createElement = (...args: any[]) => '
          + 'React.createElement.apply(React, args as any)',
      },
      {
        path: runtimePath,
        source: [
          'const [value, setValue] = useState<Foo>(initial)',
          'function identity<Bar>(value: Bar): Array<Bar> {',
          '  return [value]',
          '}',
          "import { createElement } from './TR-create-element'",
          'const element = createElement(RN.View, null)',
        ].join('\n'),
      },
      { path: 'packages/dev/tool.tsx', source: 'const el = <RN.View />' },
    ])).toEqual([])
  })
})
