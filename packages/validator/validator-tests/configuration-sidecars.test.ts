import { Describe, Expect, Test } from '@shared/test'
import { configurationValidationMessages } from '../validator-src/validators/configuration-validator'
import { validationErrorMessages, withValidatedFiles } from './test-validate'

const sidecarDeclaration = (path: string) => `
  public type SidecarNav is nav with {
    implement inject nav "${path}"
  }
`

async function validateSidecar(path: string, sidecarFiles: Record<string, string> = {}): Promise<string[]> {
  let errors: string[] = []
  await withValidatedFiles('Main.tao', {
    'Main.tao': sidecarDeclaration(path),
    ...sidecarFiles,
  }, result => {
    errors = validationErrorMessages(result)
  })
  return errors
}

Describe('validator: configuration implementation sidecars', () => {
  Test('accepts an existing sibling TypeScript sidecar with a default export', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'export default function SidecarNav() {}',
    })

    Expect(errors).toEqual([])
  })

  Test('accepts a default export list', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'const SidecarNav = () => undefined\nexport { SidecarNav as default }',
    })

    Expect(errors).toEqual([])
  })

  Test('rejects a missing sibling sidecar', async () => {
    const errors = await validateSidecar('./Missing.ts')

    Expect(errors).toContain(configurationValidationMessages.sidecarMissing('./Missing.ts'))
  })

  Test('rejects absolute, non-runtime-TypeScript, and nested sidecars', async () => {
    const absoluteErrors = await validateSidecar('/tmp/SidecarNav.ts')
    const javascriptErrors = await validateSidecar('./SidecarNav.js', {
      'SidecarNav.js': 'export default function SidecarNav() {}',
    })
    const declarationErrors = await validateSidecar('./SidecarNav.d.ts', {
      'SidecarNav.d.ts': 'export default function SidecarNav(): void',
    })
    const nestedErrors = await validateSidecar('./implementations/SidecarNav.ts', {
      'implementations/SidecarNav.ts': 'export default function SidecarNav() {}',
    })

    Expect(absoluteErrors).toContain(configurationValidationMessages.sidecarLocation('/tmp/SidecarNav.ts'))
    Expect(javascriptErrors).toContain(configurationValidationMessages.sidecarLocation('./SidecarNav.js'))
    Expect(declarationErrors).toContain(
      configurationValidationMessages.sidecarLocation('./SidecarNav.d.ts'),
    )
    Expect(nestedErrors).toContain(
      configurationValidationMessages.sidecarLocation('./implementations/SidecarNav.ts'),
    )
  })

  Test('rejects a sidecar without a default export', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'export function SidecarNav() {}',
    })

    Expect(errors).toContain(configurationValidationMessages.sidecarDefaultExport('./SidecarNav.ts'))
  })

  Test('does not mistake a commented default export for an implementation', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': '/*\nexport default function SidecarNav() {}\n*/\nexport const Name = "SidecarNav"',
    })

    Expect(errors).toContain(configurationValidationMessages.sidecarDefaultExport('./SidecarNav.ts'))
  })

  Test('does not mistake strings or type-only and redirected exports for a runtime default', async () => {
    const invalidSources = [
      'const Source = "export default function Fake() {}"\nexport const Name = Source',
      'interface Factory {}\nexport type { Factory as default }',
      'export default interface Factory {}',
      "export { default as Named } from './Factory'",
      "export { Factory as default } from './Factory'",
    ]

    for (const source of invalidSources) {
      const errors = await validateSidecar('./SidecarNav.ts', { 'SidecarNav.ts': source })
      Expect(errors).toContain(configurationValidationMessages.sidecarDefaultExport('./SidecarNav.ts'))
    }
  })
})
