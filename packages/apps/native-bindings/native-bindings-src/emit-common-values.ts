/** Shared foreign actions expose checked dynamic inspection without erasing nominal resources. */
export function emitCommonValues(
  required: boolean,
  implementationImport = './Bindings.ts',
): { tao: string[]; sidecar: string[] } {
  if (!required) {
    return { tao: [], sidecar: [] }
  }
  const actions = [
    { name: 'NativeValueKind', parameters: '', arguments: '', method: 'kind', result: 'text', typescript: 'string' },
    {
      name: 'NativeValueKeys',
      parameters: '',
      arguments: '',
      method: 'keys',
      result: 'list of text',
      typescript: 'string[]',
    },
    {
      name: 'NativeValueReadKey',
      parameters: ', Key text',
      arguments: ', key: string',
      method: 'readKey',
      result: 'NativeValue?',
      typescript: 'TR.NativeReference<unknown> | null',
      invoke: ', key',
    },
    {
      name: 'NativeValueLength',
      parameters: '',
      arguments: '',
      method: 'length',
      result: 'number',
      typescript: 'number',
    },
    {
      name: 'NativeValueReadIndex',
      parameters: ', Index number',
      arguments: ', index: number',
      method: 'readIndex',
      result: 'NativeValue?',
      typescript: 'TR.NativeReference<unknown> | null',
      invoke: ', index',
    },
    { name: 'NativeValueText', parameters: '', arguments: '', method: 'text', result: 'text', typescript: 'string' },
    {
      name: 'NativeValueNumber',
      parameters: '',
      arguments: '',
      method: 'number',
      result: 'number',
      typescript: 'number',
    },
    {
      name: 'NativeValueBoolean',
      parameters: '',
      arguments: '',
      method: 'boolean',
      result: 'boolean',
      typescript: 'boolean',
    },
  ]
  const tao = ['public type NativeValue is item', '']
  const sidecar: string[] = []
  for (const action of actions) {
    tao.push(
      `public action ${action.name}(Value NativeValue${action.parameters}) returns ${action.result} from ${implementationImport}`,
      '',
    )
    sidecar.push(
      `export function ${action.name}(value: unknown${action.arguments}): ${action.typescript} {`,
      `  return TR.NativeValues.${action.method}(value as TR.NativeReference<unknown>${action.invoke ?? ''})`,
      '}',
      '',
    )
  }
  tao.push(`public action ReleaseNativeValue(Value NativeValue) from ${implementationImport}`, '')
  sidecar.push('export function ReleaseNativeValue(value: unknown): void { TR.NativeValues.release(value) }', '')
  return { tao, sidecar }
}
