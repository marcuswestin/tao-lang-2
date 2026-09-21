import { CLI } from '@shared'

const EXCLUDED_INTERFACE_PREFIXES = ['lo', 'awdl', 'llw', 'utun', 'bridge', 'gif', 'stf']

/** InterfaceAddress is one IPv4 assignment from ifconfig. */
export type InterfaceAddress = {
  active: boolean
  address: string
  iface: string
}

/** preferredLanIPv4 picks the host a cabled or Wi-Fi phone can reach. */
export function preferredLanIPv4(
  interfaces: readonly InterfaceAddress[],
  defaultInterfaceAddress?: string,
): string {
  const linkLocal = interfaces.find(entry =>
    entry.active && isLinkLocal(entry.address) && !isExcludedInterface(entry.iface)
  )
  if (linkLocal !== undefined) {
    return linkLocal.address
  }
  if (defaultInterfaceAddress !== undefined && defaultInterfaceAddress !== '127.0.0.1') {
    return defaultInterfaceAddress
  }
  return interfaces.find(entry => entry.address !== '127.0.0.1' && !isExcludedInterface(entry.iface))
    ?.address ?? 'localhost'
}

/** parseIfconfigIPv4 reads Darwin/Linux ifconfig inet lines. */
export function parseIfconfigIPv4(text: string): InterfaceAddress[] {
  const interfaces: InterfaceAddress[] = []
  let iface = ''
  let address = ''
  let active = false
  const flush = () => {
    if (iface !== '' && address !== '') {
      interfaces.push({ active, address, iface })
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^([\w.-]+): flags=/)
    if (header?.[1] !== undefined) {
      flush()
      iface = header[1]
      address = ''
      active = false
      continue
    }
    const inet = line.match(/^\s+inet (\d+\.\d+\.\d+\.\d+)/)
    if (inet?.[1] !== undefined && inet[1] !== '127.0.0.1') {
      address = inet[1]
    }
    if (/^\s+status: active/.test(line)) {
      active = true
    }
  }
  flush()
  return interfaces
}

/** detectLanIPv4 returns this machine's phone-reachable IPv4 address. */
export async function detectLanIPv4(): Promise<string> {
  const ifconfig = await CLI.run('ifconfig', {})
  const interfaces = parseIfconfigIPv4(ifconfig.stdout)
  return preferredLanIPv4(interfaces, await defaultRouteIPv4())
}

async function defaultRouteIPv4(): Promise<string | undefined> {
  const route = await CLI.run('route', { args: ['-n', 'get', 'default'] })
  const iface = route.stdout.match(/interface: (\S+)/)?.[1]
  if (iface === undefined) {
    return undefined
  }
  const address = await CLI.run('ipconfig', { args: ['getifaddr', iface] })
  const value = address.stdout.trim()
  return value.length > 0 ? value : undefined
}

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.')
}

function isExcludedInterface(iface: string): boolean {
  return EXCLUDED_INTERFACE_PREFIXES.some(prefix => iface === prefix || iface.startsWith(`${prefix}`))
}
