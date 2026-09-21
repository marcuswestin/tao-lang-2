import type {
  GenerationAvailability,
  GenerationProvider,
  GenerationRun,
  JsonValue,
} from './generation-contract'

/** UnavailableGenerationProvider declares a stable model-unavailable result. */
export class UnavailableGenerationProvider implements GenerationProvider {
  constructor(readonly reason: string) {}

  async availability(): Promise<GenerationAvailability> {
    return { status: 'unavailable', reason: this.reason }
  }

  generate<Value extends JsonValue>(): GenerationRun<Value> {
    return {
      partials: empty(),
      final: Promise.resolve({ status: 'failure', code: 'model_unavailable', message: this.reason }),
    }
  }
}

async function* empty(): AsyncIterable<never> {}
