import { Describe, Expect, Test } from '@shared/test'
import { configurationValidationMessages } from '../validator-src/validators/configuration-validator'
import { validationErrorMessages, withValidatedFiles } from './test-validate'

const sidecarDeclaration = (path: string, exportName = 'SidecarNav') => `
  public type SidecarNav is nav with {
    nav ${exportName} from ${path}
  }
`

async function validateSidecar(
  path: string,
  sidecarFiles: Record<string, string> = {},
  exportName = 'SidecarNav',
): Promise<string[]> {
  let errors: string[] = []
  await withValidatedFiles('Main.tao', {
    'Main.tao': sidecarDeclaration(path, exportName),
    ...sidecarFiles,
  }, result => {
    errors = validationErrorMessages(result)
  })
  return errors
}

Describe('validator: configuration implementation sidecars', () => {
  Test('accepts an existing sibling TypeScript sidecar exporting the named implementation', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'export function SidecarNav() {}',
    })

    Expect(errors).toEqual([])
  })

  Test('accepts a const declaration and a renaming export list', async () => {
    const constErrors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'export const SidecarNav = () => undefined',
    })
    const listErrors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'const Kind = () => undefined\nexport { Kind as SidecarNav }',
    })

    Expect(constErrors).toEqual([])
    Expect(listErrors).toEqual([])
  })

  Test('rejects a missing sibling sidecar', async () => {
    const errors = await validateSidecar('./Missing.ts')

    Expect(errors).toContain(configurationValidationMessages.sidecarMissing('./Missing.ts'))
  })

  // An absolute path is no longer expressible: the path is a bare path token, not a quoted
  // string, and its terminal matches only package, relative, and sibling forms.
  Test('rejects non-runtime-TypeScript and nested sidecars', async () => {
    const javascriptErrors = await validateSidecar('./SidecarNav.js', {
      'SidecarNav.js': 'export function SidecarNav() {}',
    })
    const declarationErrors = await validateSidecar('./SidecarNav.d.ts', {
      'SidecarNav.d.ts': 'export function SidecarNav(): void',
    })
    const nestedErrors = await validateSidecar('./implementations/SidecarNav.ts', {
      'implementations/SidecarNav.ts': 'export function SidecarNav() {}',
    })

    Expect(javascriptErrors).toContain(configurationValidationMessages.sidecarLocation('./SidecarNav.js'))
    Expect(declarationErrors).toContain(
      configurationValidationMessages.sidecarLocation('./SidecarNav.d.ts'),
    )
    Expect(nestedErrors).toContain(
      configurationValidationMessages.sidecarLocation('./implementations/SidecarNav.ts'),
    )
  })

  Test('rejects a sidecar that exports a different name', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'export function SomethingElse() {}',
    })

    Expect(errors).toContain(
      configurationValidationMessages.sidecarNamedExport('./SidecarNav.ts', 'SidecarNav'),
    )
  })

  Test('rejects a default export, which the boundary no longer accepts', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': 'export default function SidecarNav() {}',
    })

    Expect(errors).toContain(
      configurationValidationMessages.sidecarNamedExport('./SidecarNav.ts', 'SidecarNav'),
    )
  })

  Test('does not mistake a commented export for an implementation', async () => {
    const errors = await validateSidecar('./SidecarNav.ts', {
      'SidecarNav.ts': '/*\nexport function SidecarNav() {}\n*/\nexport const Name = "SidecarNav"',
    })

    Expect(errors).toContain(
      configurationValidationMessages.sidecarNamedExport('./SidecarNav.ts', 'SidecarNav'),
    )
  })

  Test('does not mistake strings or type-only exports for a runtime implementation', async () => {
    const invalidSources = [
      'const Source = "export function SidecarNav() {}"\nexport const Name = Source',
      'interface SidecarNav {}\nexport type { SidecarNav }',
      'export type SidecarNav = () => void',
    ]

    for (const source of invalidSources) {
      const errors = await validateSidecar('./SidecarNav.ts', { 'SidecarNav.ts': source })
      Expect(errors).toContain(
        configurationValidationMessages.sidecarNamedExport('./SidecarNav.ts', 'SidecarNav'),
      )
    }
  })
})
