/** The install fixture's minimal macOS plutil JSON-extraction contract. */
import { Assert, FS, HCI, Platform } from '@shared'

const args = Platform.runtimeProcess.argv.slice(2)
Assert(
  args.length === 6 && args[0] === '-extract' && args[2] === 'raw' && args[3] === '-o' && args[4] === '-',
  'The installer fixture only supports plutil -extract KEY raw -o - FILE.',
)
const match = /^(\d+)\.(tag_name|draft|prerelease)$/.exec(args[1] ?? '')
Assert.defined(match, 'The installer fixture requires a supported release field.')
const file = args[5]
Assert.defined(file, 'The installer fixture requires a JSON file path.')
const listing = await FS.readJson<Record<string, unknown>[]>(file)
const value = listing[Number(match[1])]?.[match[2]!]
if (value === undefined) {
  Platform.runtimeProcess.exit(1)
}
Assert(typeof value === 'string' || typeof value === 'boolean', 'A release field must be text or boolean.')
HCI.writeLine(String(value))
