import React from 'react'
import type { TaoActionFailureReport } from './TR-errors'
import { runtimeRevisionStore } from './TR-listeners'

export type TaoActionFailureSink = (failure: TaoActionFailureReport) => boolean

/** One host occurrence owns its failure latch; app definitions may be mounted more than once. */
export class MountedActionBoundary {
  private readonly changes = runtimeRevisionStore()
  private generation = 0
  private mountGeneration = 0
  private active = false
  failure: TaoActionFailureReport | undefined
  readonly subscribe = this.changes.subscribe
  readonly snapshot = this.changes.snapshot

  mount(): () => void {
    const mount = ++this.mountGeneration
    this.generation += 1
    this.active = true
    return () => {
      if (this.mountGeneration === mount) {
        this.active = false
        this.generation += 1
      }
    }
  }

  capture(): TaoActionFailureSink | undefined {
    if (!this.active) {
      return undefined
    }
    const generation = this.generation
    return failure => {
      if (!this.active || this.generation !== generation) {
        return false
      }
      if (!this.failure) {
        this.failure = failure
        this.changes.changed()
      }
      return true
    }
  }

  recover(): void {
    this.generation += 1
    this.failure = undefined
    this.changes.changed()
  }
}

export const ActionBoundaryContext = React.createContext<MountedActionBoundary | undefined>(undefined)
