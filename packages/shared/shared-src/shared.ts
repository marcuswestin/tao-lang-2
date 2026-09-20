import * as CLI from './CLI'
import {
  Arrays,
  Assert,
  Diagnostic,
  Diagnostics,
  Effects,
  Errors,
  Http,
  Json,
  Switch,
  Text,
  Time,
} from './core/shared-core'
import * as FS from './FS'
import * as HCI from './HCI'
import * as LocalSocket from './LocalSocket'
import * as Platform from './Platform'
import { ProcessTree } from './ProcessTree'
import * as Repo from './Repo'
import { TaoFiles } from './TaoFiles'
import { TaoStdlib } from './TaoStdlib'
import { TaoTestProtocol } from './TaoTestProtocol'

export type {
  DiagnosticRange,
  DiagnosticSeverity,
  DiagnosticSource,
} from './core/shared-core'

export type { ProcessSignalSeams, ProcessTableEntry, TrackedProcess } from './ProcessTree'

export {
  Arrays,
  Assert,
  CLI,
  Diagnostic,
  Diagnostics,
  Effects,
  Errors,
  FS,
  HCI,
  Http,
  Json,
  LocalSocket,
  Platform,
  ProcessTree,
  Repo,
  Switch,
  TaoFiles,
  TaoStdlib,
  TaoTestProtocol,
  Text,
  Time,
}
