import { Describe, Expect, Test } from '@shared/test'
import {
  dependencyCompatibilityIssues,
  type DependencyFacts,
  readDependencyFacts,
} from '../dev-src/repository-tests/DependencyCompatibility'

const PACKAGE_PATHS: Record<string, string> = {
  'tao-dev': 'packages/dev/package.json',
  'tao-runtime-toolchain': 'packages/runtime-toolchain/package.json',
  'tao-studio': 'packages/studio/package.json',
  'tao-workspace': 'packages/workspace/package.json',
}

const INSTALLED_WORKSPACE: Record<string, Record<string, string>> = {
  'tao-dev': { react: '19.2.8' },
  'tao-runtime-toolchain': {
    '@react-native-community/netinfo': '11.4.1',
    '@types/react': '19.1.17',
    react: '19.1.0',
    'react-dom': '19.1.0',
    'react-native-get-random-values': '1.11.0',
    'react-test-renderer': '19.1.0',
  },
  'tao-studio': { '@types/react': '19.1.17', react: '19.1.0' },
}

/**
 * Builds facts from one map of what each package resolves, so a fixture cannot accidentally
 * declare a dependency it does not install and report an unrelated issue.
 */
function facts(
  resolvedByPackage: Record<string, Record<string, string>> = INSTALLED_WORKSPACE,
  overrides: Partial<DependencyFacts> = {},
): DependencyFacts {
  return {
    expoBundledVersions: {
      '@react-native-community/netinfo': '11.4.1',
      react: '19.1.0',
      'react-dom': '19.1.0',
      'react-native-get-random-values': '~1.11.0',
    },
    manifests: Object.entries(resolvedByPackage).map(([name, resolved]) => ({
      dependencies: resolved,
      name,
      path: PACKAGE_PATHS[name] ?? `packages/${name}/package.json`,
    })),
    reactNativeTypesPeer: '^19.1.0',
    resolvedByPackage,
    satisfies: (version, range) => Bun.semver.satisfies(version, range),
    ...overrides,
  }
}

Describe('runtime dependency compatibility', () => {
  Test('accepts the Ink React that never reaches a bundle', () => {
    Expect(dependencyCompatibilityIssues(facts())).toEqual([])
  })

  Test('rejects a singleton anchor that drifts from the installed Expo SDK', () => {
    const issues = dependencyCompatibilityIssues(facts({
      'tao-runtime-toolchain': { react: '19.2.8', 'react-dom': '19.2.8', 'react-test-renderer': '19.2.8' },
      'tao-studio': { react: '19.2.8' },
    }))

    Expect(issues.length).toBe(2)
    Expect(issues[0]).toContain('tao-runtime-toolchain resolves react 19.2.8')
    Expect(issues[0]).toContain('Expo SDK is built against react 19.1.0')
    Expect(issues[0]).toContain('packages/runtime-toolchain/package.json')
    Expect(issues[1]).toContain('react-dom')
  })

  Test('rejects a second React reaching the Studio bundle', () => {
    const issues = dependencyCompatibilityIssues(facts({
      'tao-runtime-toolchain': { react: '19.1.0', 'react-dom': '19.1.0', 'react-test-renderer': '19.1.0' },
      'tao-studio': { react: '19.2.8' },
    }))

    Expect(issues.length).toBe(1)
    Expect(issues[0]).toContain('tao-studio resolves react 19.2.8')
    Expect(issues[0]).toContain('two React copies in one bundle render nothing')
    Expect(issues[0]).toContain('packages/studio/package.json')
  })

  Test('rejects an undocumented package carrying its own React', () => {
    const issues = dependencyCompatibilityIssues(facts({
      'tao-runtime-toolchain': { react: '19.1.0', 'react-dom': '19.1.0', 'react-test-renderer': '19.1.0' },
      'tao-workspace': { react: '18.3.1' },
    }))

    Expect(issues.length).toBe(1)
    Expect(issues[0]).toContain('tao-workspace resolves react 18.3.1')
    Expect(issues[0]).toContain('neither as bundled nor as a host tool')
  })

  Test('rejects a test renderer that does not match the React it renders', () => {
    const issues = dependencyCompatibilityIssues(facts({
      'tao-runtime-toolchain': { react: '19.1.0', 'react-dom': '19.1.0', 'react-test-renderer': '19.1.1' },
    }))

    Expect(issues.length).toBe(1)
    Expect(issues[0]).toContain('react-test-renderer 19.1.1 does not match react 19.1.0')
  })

  Test('rejects React types outside the installed React Native peer range', () => {
    const issues = dependencyCompatibilityIssues(facts({
      'tao-runtime-toolchain': {
        '@types/react': '18.3.1',
        react: '19.1.0',
        'react-dom': '19.1.0',
        'react-test-renderer': '19.1.0',
      },
    }))

    Expect(issues.length).toBe(1)
    Expect(issues[0]).toContain('@types/react 18.3.1')
    Expect(issues[0]).toContain('^19.1.0')
  })

  Test('rejects a native module the installed Expo SDK does not bundle', () => {
    const issues = dependencyCompatibilityIssues(facts({
      'tao-runtime-toolchain': {
        '@react-native-community/netinfo': '12.0.0',
        react: '19.1.0',
        'react-dom': '19.1.0',
        'react-native-get-random-values': '1.11.0',
      },
    }))

    Expect(issues.length).toBe(1)
    Expect(issues[0]).toContain('@react-native-community/netinfo')
    Expect(issues[0]).toContain('bundles @react-native-community/netinfo 11.4.1')
  })

  Test('reports a declared dependency the lockfile never installed', () => {
    const issues = dependencyCompatibilityIssues(facts(
      { 'tao-runtime-toolchain': { react: '19.1.0', 'react-dom': '19.1.0' } },
      {
        manifests: [{
          dependencies: { 'never-installed': '^1.0.0', 'tao-shared': 'workspace:*' },
          name: 'tao-runtime-toolchain',
          path: 'packages/runtime-toolchain/package.json',
        }],
      },
    ))

    Expect(issues.length).toBe(1)
    Expect(issues[0]).toContain('never-installed ^1.0.0, which is not installed')
    Expect(issues[0]).toContain('just deps')
  })

  Test('holds for the installed workspace', async () => {
    Expect(dependencyCompatibilityIssues(await readDependencyFacts())).toEqual([])
  })
})
