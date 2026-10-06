import { Errors, HCI } from '@shared'
import { GateCatalog } from './GateCatalog'

/** Scoped test-child consent, never a replacement for a public target-specific flag. */
const STUDIO_ENV_KEY = 'TAO_TEST_SHOW_STUDIO'
const studioWarnings = [
  'Native Studio tests open Electrobun windows. Native keyboard or Mac2 checks may take focus; external accessibility checks require macOS automation/accessibility consent.',
] as const

function requireStudio(showStudio: boolean | undefined): void {
  if (showStudio !== true) {
    Errors.throwUserInput(
      'This workflow opens native Studio windows. Obtain permission for visible testing, then pass --show-studio. No selected native checks were run.',
    )
  }
}

function preflightGates(gates: readonly string[], showStudio?: boolean): readonly string[] {
  const visible = gates.some(name => GateCatalog.metadata(name).visibleSurface === 'studio')
  if (visible) {
    requireStudio(showStudio)
  }
  return visible
      || (showStudio === true && gates.some(name => GateCatalog.metadata(name).optionalVisibleSurface === 'studio'))
    ? studioWarnings
    : []
}

function warn(warnings: readonly string[]): void {
  for (const warning of warnings) {
    HCI.writeErrorLine(`WARNING: ${warning}`)
  }
}

function selectsStudio(command: string, args: readonly string[]): boolean {
  return command === 'verify-repo'
    || ['studio-manual-checks', 'studio-host-control-smoke', 'studio-mac2-acceptance'].includes(command)
    || (command === 'studio-smoke' && smokeNeedsStudio(args, args.includes('--native')))
}

function smokeNeedsStudio(files: readonly string[], native = false): boolean {
  const tests = files.filter(file => file.endsWith('.test.ts'))
  if (
    tests.some(file =>
      /studio-(?:host-control|mac2-acceptance|mac2-source-probe|wda-registration-probe)\.test\.ts$/.test(file)
    )
  ) {
    return true
  }
  return native && (tests.length === 0
    || tests.some(file => !/(?:^|[\\/])studio-simulated-user\.test\.ts$/.test(file)))
}

function warningsForCommand(command: string, args: readonly string[]): readonly string[] {
  const warnings: string[] = []
  if (command === 'studio-native') {
    warnings.push(
      'Native Studio opens Electrobun windows, including Welcome with --no-browser. Keyboard interaction may take focus; external accessibility checks require macOS automation/accessibility consent.',
    )
  } else if (command === 'studio' && !args.includes('--no-browser')) {
    warnings.push(
      'Studio opens the configured browser. Its window may take focus; use --no-browser for a quiet server and review the served URL in the in-app browser.',
    )
  }
  if (
    args.includes('--show-studio') && (selectsStudio(command, args)
      || ['verify-full', 'land', 'merge-with-main', 'studio-canary'].includes(command))
  ) {
    warnings.push(...studioWarnings)
  }
  if (command === 'app-dev') {
    for (
      const [flag, surface] of [
        ['--show-browser', 'Google Chrome'],
        ['--show-simulator', 'iOS Simulator'],
        ['--show-emulator', 'Android Emulator'],
      ]
    ) {
      if (args.includes(flag!)) {
        warnings.push(
          `${surface} windows may appear. Background launch is preferred; native UI interaction may take focus.`,
        )
      }
    }
  }
  return warnings
}

function preflightCommand(command: string, args: readonly string[]): void {
  if (selectsStudio(command, args)) {
    requireStudio(args.includes('--show-studio'))
  }
}

/** Declaration-based visibility checks and warnings shared by CLI entrypoints and test launchers. */
export const UiVisibility = {
  preflightCommand,
  preflightGates,
  requireStudio,
  smokeNeedsStudio,
  STUDIO_ENV_KEY,
  studioWarnings,
  warn,
  warningsForCommand,
} as const
