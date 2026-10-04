import { Describe, Expect, Test } from '@shared/test'
import { openUrl } from '../TaoRuntime-src/TR-linking'

Describe('TR Linking', () => {
  Test('does not load React Native while NODE_ENV is test', async () => {
    const restore = setNodeEnv('test')
    let loads = 0
    try {
      await openUrl('https://example.com', {
        required<ModuleT>(): ModuleT {
          loads += 1
          return {} as ModuleT
        },
      })
    } finally {
      restore()
    }

    Expect(loads).toBe(0)
  })

  Test('skips an empty URL without loading React Native', async () => {
    const restore = setNodeEnv('development')
    let loads = 0
    try {
      await openUrl('', {
        required<ModuleT>(): ModuleT {
          loads += 1
          return {} as ModuleT
        },
      })
    } finally {
      restore()
    }

    Expect(loads).toBe(0)
  })

  Test('opens a URL with React Native Linking outside tests', async () => {
    const restore = setNodeEnv('development')
    const opened: string[] = []
    try {
      await openUrl('https://example.com/story', {
        required<ModuleT>(capability: string, moduleName: 'react-native'): ModuleT {
          Expect([capability, moduleName]).toEqual(['Linking', 'react-native'])
          return {
            Linking: {
              openURL: async (url: string) => {
                opened.push(url)
              },
            },
          } as ModuleT
        },
      })
    } finally {
      restore()
    }

    Expect(opened).toEqual(['https://example.com/story'])
  })

  Test('reports a friendly failure when React Native has no Linking module', async () => {
    const restore = setNodeEnv('development')
    try {
      await Expect(
        openUrl('https://example.com', {
          required<ModuleT>(): ModuleT {
            return {} as ModuleT
          },
        }),
      ).rejects.toThrow(
        'Tao Linking is unavailable because native module "react-native" does not expose Linking.',
      )
    } finally {
      restore()
    }
  })
})

function setNodeEnv(value: string): () => void {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = value
  return () => {
    if (previous === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previous
    }
  }
}
