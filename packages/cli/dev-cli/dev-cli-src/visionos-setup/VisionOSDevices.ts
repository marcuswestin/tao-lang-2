type ObjectValue = Record<string, unknown>

export type VisionOSDevice = {
  id: string
  udid: string
  name: string
  connected: boolean
  paired: boolean
  developerMode: boolean
}

export function object(value: unknown): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Normalize both Device Hub and older CoreDevice records; simulator records are never headset evidence. */
export function visionOSDevices(value: unknown): VisionOSDevice[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(item => {
    const row = object(item)
    const properties = object(row['properties'])
    const hardware = object(properties['hardware'] ?? row['hardwareProperties'])
    const connection = object(properties['connection'] ?? row['connectionProperties'])
    const device = object(properties['device'] ?? row['deviceProperties'])
    const reality = text(hardware['reality']).toLowerCase()
    const transport = text(connection['transportType']).toLowerCase()
    const provider = text(device['provider'] ?? row['provider'] ?? properties['provider'])
    if (reality === 'simulated' || transport === 'samemachine' || provider.includes('SimulatorCoreDevicePlugin')) {
      return []
    }
    const physical = reality === 'physical'
      || (!reality && !!text(hardware['serialNumber'])
        && ['wired', 'network', 'usb', 'localnetwork'].includes(transport))
    const platform = text(hardware['platform']).toLowerCase()
    const id = text(row['identifier'])
    const udid = text(hardware['udid'])
    if (!physical || !['visionos', 'xros'].includes(platform) || !id || !udid) {
      return []
    }
    return [{
      id,
      udid,
      name: text(device['name'] ?? object(properties['state'])['name'] ?? properties['name'] ?? row['name']) || id,
      connected: text(connection['state']).toLowerCase() === 'connected'
        || text(connection['tunnelState']).toLowerCase() === 'connected',
      paired: text(connection['pairingState']).toLowerCase() === 'paired',
      developerMode: developerModeEnabled(row),
    }]
  })
}

export function developerModeEnabled(value: unknown): boolean {
  const row = object(value)
  const properties = object(row['properties'])
  const device = object(properties['device'] ?? row['deviceProperties'])
  const status = device['developerModeStatus'] ?? object(properties['state'])['developerModeStatus']
    ?? properties['developerModeStatus'] ?? row['developerModeStatus']
  return status === 'enabled'
}
