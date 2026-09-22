import { Errors } from '@shared/core'
import type { StudioPreviewCell, StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import { StudioProtocol, type StudioRuntimeCaptureArtifact } from '../StudioProtocol'
import { studioReplayConfiguration } from './matrix/StudioRuntimeCapture'

/** A downloaded runtime capture carries the identity needed to avoid replaying another app's state. */
export type StudioSavedDeviceCapture = Readonly<{
  appName: string
  capture: StudioRuntimeCaptureArtifact
  project: string
  scenarioId: string
  version: 1
}>

export const StudioDeviceCapture = {
  save(manifest: StudioPreviewManifestV2, cell: StudioPreviewCell, value: unknown): StudioSavedDeviceCapture {
    const capture = StudioProtocol.parseRuntimeCapture(value)
    if (capture === undefined) {
      Errors.throwHostEnvironment('The device returned an unsupported runtime capture.')
    }
    return {
      appName: manifest.project.appName,
      capture,
      project: manifest.project.root,
      scenarioId: cell.scenarioId,
      version: 1,
    }
  },
  parse(value: unknown): StudioSavedDeviceCapture {
    if (typeof value !== 'object' || value === null) {
      Errors.throwUserInput('This is not a saved Tao device capture.')
    }
    const record = value as Record<string, unknown>
    const capture = StudioProtocol.parseRuntimeCapture(record['capture'])
    if (
      record['version'] !== 1 || typeof record['appName'] !== 'string'
      || typeof record['project'] !== 'string' || typeof record['scenarioId'] !== 'string'
      || capture === undefined
    ) {
      Errors.throwUserInput('This is not a supported Tao device capture.')
    }
    return {
      appName: record['appName'],
      capture,
      project: record['project'],
      scenarioId: record['scenarioId'],
      version: 1,
    }
  },
  restore(manifest: StudioPreviewManifestV2, cell: StudioPreviewCell, saved: StudioSavedDeviceCapture) {
    if (
      saved.project !== manifest.project.root || saved.appName !== manifest.project.appName
      || saved.scenarioId !== cell.scenarioId
    ) {
      Errors.throwUserInput('Choose a device cell from the same app and scenario as this capture.')
    }
    return studioReplayConfiguration(saved.capture, cell.environment)
  },
} as const
