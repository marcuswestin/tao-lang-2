import { Expect, Test } from '@shared/test'
import {
  compileGenerationSchema,
  type EntityGenerationDeclaration,
  type JsonObject,
  startAppleFoundationModelsService,
} from '../generation-src/generation'

if (process.env['TAO_LIVE_APPLE_AI'] !== '1') {
  throw new Error('Set TAO_LIVE_APPLE_AI=1 to run live Apple Foundation Models checks.')
}

const workspace: EntityGenerationDeclaration = {
  collection: 'Workspaces',
  fields: [
    {
      guidance: 'Use a realistic name for a writing project.',
      name: 'Name',
      optional: false,
      secret: false,
      type: { kind: 'scalar', scalar: 'text' },
    },
    {
      defaultValue: { kind: 'now' },
      name: 'CreatedAt',
      optional: false,
      secret: false,
      type: { kind: 'scalar', scalar: 'time' },
    },
    {
      defaultValue: false,
      name: 'Pinned',
      optional: false,
      secret: false,
      type: { kind: 'scalar', scalar: 'boolean' },
    },
  ],
  kind: 'entity',
  name: 'Workspace',
}

Test(
  'live Swift helper supports availability, guided streaming, and realistic WordFlower entities',
  async () => {
    const service = await startAppleFoundationModelsService()
    try {
      Expect(await service.provider.availability()).toEqual({ status: 'available' })
      const compiled = compileGenerationSchema(workspace)
      const run = service.provider.generate<JsonObject>(
        compiled.schema,
        [{ name: 'scene', value: 'WorkspaceRow.novel' }],
        compiled.guide,
      )
      const partials = []
      for await (const partial of run.partials) {
        partials.push(partial)
      }
      const result = await run.final

      Expect(result.status).toBe('success')
      Expect(partials.length).toBeGreaterThan(0)
      if (result.status === 'success') {
        Expect((result.value['Name'] as string).length).toBeGreaterThan(2)
      }
    } finally {
      await service.stop()
    }
  },
  60_000,
)
