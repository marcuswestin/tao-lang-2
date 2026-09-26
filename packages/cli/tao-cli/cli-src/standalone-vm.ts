import { CLI, Errors, FS, HCI, Platform } from '@shared'

/** Host-side operations for the disposable VM gate; binary output must stay on inherited stdout. */
type Entity = { 'dev-entry'?: string; 'mount-point'?: string }
type Attachment = { 'image-path': string; 'system-entities': Entity[] }

try {
  const [operation, name, argument, ...args] = Platform.runtimeProcess.argv.slice(2)
  if (name === undefined || !/^tao-acceptance-[0-9]+-[0-9]+$/.test(name)) {
    Errors.throwUserInput('Expected an owned standalone acceptance VM name.')
  }
  if (operation === 'exec' && argument !== undefined && args.length > 0) {
    const timeoutMs = Number(argument)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      Errors.throwUserInput('Expected a positive VM command timeout in milliseconds.')
    }
    const result = await CLI.run('tart', {
      args: ['exec', name, ...args],
      processPolicy: 'test',
      timeoutMs,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    if (result.stderr) {
      HCI.writeErrorLine(result.stderr.trimEnd())
    }
    if (result.error) {
      HCI.writeErrorLine(Errors.formatForUser(result.error))
    }
    Platform.runtimeProcess.exit(result.exitCode ?? 1)
  } else if ((operation === 'provision' || operation === 'collect') && argument !== undefined && args.length === 0) {
    await withDisk(name, FS.resolvePath(argument), operation)
  } else {
    Errors.throwUserInput(
      'Usage: standalone-vm.ts provision|collect <vm> <run-root> | exec <vm> <timeout-ms> <command> [args...]',
    )
  }
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

async function command(executable: string, args: string[]): Promise<string> {
  const result = await CLI.run(executable, { args, processPolicy: 'test', timeoutMs: 120_000 })
  if (result.exitCode !== 0) {
    Errors.throwHostEnvironment(`${executable} failed: ${result.stderr || result.stdout || result.error?.message}`)
  }
  return result.stdout
}

async function plist<T>(executable: string, args: string[]): Promise<T> {
  const output = await command(executable, args)
  const converted = await CLI.run('/usr/bin/plutil', {
    args: ['-convert', 'json', '-o', '-', '-'],
    stdin: output,
  })
  if (converted.exitCode !== 0) {
    Errors.throwHostEnvironment(`Cannot decode ${executable} plist: ${converted.stderr}`)
  }
  return JSON.parse(converted.stdout) as T
}

async function withDisk(name: string, root: string, operation: 'provision' | 'collect'): Promise<void> {
  const state = JSON.parse(await command('tart', ['get', name, '--format', 'json'])) as {
    Running: boolean
    State: string
  }
  if (state.Running !== false || state.State !== 'stopped') {
    Errors.throwHostEnvironment(`Refusing to mount ${name}: expected a stopped VM, got ${JSON.stringify(state)}.`)
  }
  const tartHome = Platform.runtimeProcess.env['TART_HOME'] ?? FS.resolvePath('.tart', FS.homeDir())
  const vm = FS.resolvePath(`vms/${name}`, tartHome)
  const config = await FS.readJson<{ diskFormat: string }>(FS.resolvePath('config.json', vm))
  if (config.diskFormat !== 'raw') {
    Errors.throwHostEnvironment('Offline vanilla VM provisioning requires a raw disk.')
  }
  const disk = await FS.realPath(FS.resolvePath('disk.img', vm))
  const mountRoot = FS.resolvePath('mounts', root)
  const marker = FS.resolvePath('disk-attached', root)
  if (await FS.exists(marker)) {
    Errors.throwHostEnvironment(`A prior attachment may still own this disk; inspect ${marker} before recovery.`)
  }
  await FS.mkdir(mountRoot)
  // The shell must retain the clone if interruption or a failed detach leaves this marker behind.
  await FS.writeText(marker, disk)
  try {
    const attached = await plist<{ 'system-entities': Entity[] }>('/usr/bin/hdiutil', [
      'attach',
      '-imagekey',
      'diskimage-class=CRawDiskImage',
      '-readwrite',
      '-owners',
      'on',
      '-nobrowse',
      '-plist',
      '-mountroot',
      mountRoot,
      disk,
    ])
    await FS.writeJson(FS.resolvePath('logs/disk-attach.json', root), attached)
    const apfs = await plist<{ Containers: Array<{ Volumes: Array<{ DeviceIdentifier: string; Roles: string[] }> }> }>(
      '/usr/sbin/diskutil',
      ['apfs', 'list', '-plist'],
    )
    const dataDevices = apfs.Containers.flatMap(container => container.Volumes)
      .filter(volume => volume.Roles.includes('Data')).map(volume => `/dev/${volume.DeviceIdentifier}`)
    const candidates: string[] = []
    const boundary = await FS.realPath(mountRoot)
    for (const entity of attached['system-entities']) {
      const mount = entity['mount-point']
      if (!mount) {
        continue
      }
      const actual = await FS.realPath(mount)
      if (!FS.pathIsWithin(actual, boundary)) {
        Errors.throwHostEnvironment(`Unexpected VM mount outside ${boundary}.`)
      }
      if (
        dataDevices.includes(entity['dev-entry'] ?? '') && await FS.isDirectory(FS.resolvePath('Users/admin', actual))
      ) {
        candidates.push(actual)
      }
    }
    if (candidates.length !== 1) {
      Errors.throwHostEnvironment(
        `Cannot identify a unique guest Data volume with Users/admin (${candidates.join(', ')}); see disk-attach.json.`,
      )
    }
    const home = FS.resolvePath('Users/admin', candidates[0]!)
    const owner = await FS.entryMetadata(home)
    const hostOwner = await FS.entryMetadata(root)
    if (owner.uid !== hostOwner.uid || owner.gid !== hostOwner.gid) {
      Errors.throwHostEnvironment(
        `Guest admin ownership ${owner.uid}:${owner.gid} differs from host ${hostOwner.uid}:${hostOwner.gid}.`,
      )
    }
    const harness = FS.resolvePath('tao-harness', home)
    if (operation === 'provision') {
      await provision(root, home, harness)
    } else {
      await FS.copyDirectory(FS.resolvePath('logs', harness), FS.resolvePath('logs/guest', root))
    }
    HCI.writeLine(
      `Clean-machine: recording the ${operation === 'provision' ? 'before' : 'after'} snapshot on the stopped disk...`,
    )
    const snapshot = await command(Platform.runtimeProcess.execPath, [
      'run',
      'packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts',
      'snapshot',
      candidates[0]!,
      FS.resolvePath(`logs/filesystem-${operation === 'provision' ? 'before' : 'after'}.json`, root),
      '/System/Volumes/Data',
    ])
    HCI.writeLine(snapshot.trimEnd())
  } finally {
    // Query even after attach fails: hdiutil can attach the device before reporting a mount error.
    const info = await plist<{ images: Attachment[] }>('/usr/bin/hdiutil', ['info', '-plist'])
    for (const attachment of info.images) {
      let imagePath: string
      try {
        imagePath = await FS.realPath(attachment['image-path'])
      } catch {
        // Unrelated mounted images can outlive their renamed or deleted backing files.
        if (FS.resolvePath(attachment['image-path']) !== disk) {
          continue
        }
        imagePath = disk
      }
      if (imagePath !== disk) {
        continue
      }
      const device = attachment['system-entities'].map(entity => entity['dev-entry'])
        .find(value => value !== undefined && /^\/dev\/disk[0-9]+$/.test(value))
      if (!device) {
        Errors.throwHostEnvironment(`Cannot identify the attached device for ${disk}; retain the VM.`)
      }
      await command('/usr/bin/hdiutil', ['detach', device])
    }
    await FS.remove(marker)
  }
}

async function provision(root: string, home: string, harness: string): Promise<void> {
  await FS.copyDirectory(FS.resolvePath('input', root), FS.resolvePath('input', harness))
  await FS.mkdir(FS.resolvePath('logs/steps', harness))
  const agent = FS.resolvePath('input/tart-guest-agent', harness)
  await FS.chmod(agent, 0o755)
  const browser = FS.resolvePath('Applications/Google Chrome.app', home)
  await FS.mkdir(browser)
  await command('/usr/bin/tar', ['-xf', FS.resolvePath('input/browser.tar', root), '-C', browser])
  await FS.writeText(
    FS.resolvePath('Library/LaunchAgents/org.cirruslabs.tart-guest-agent.plist', home),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.cirruslabs.tart-guest-agent</string>
<key>ProgramArguments</key><array><string>/Users/admin/tao-harness/input/tart-guest-agent</string><string>--run-rpc</string></array>
<key>WorkingDirectory</key><string>/Users/admin</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>/Users/admin</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/Users/admin/tao-harness/logs/guest-agent.log</string>
<key>StandardErrorPath</key><string>/Users/admin/tao-harness/logs/guest-agent.log</string>
</dict></plist>
`,
  )
}
