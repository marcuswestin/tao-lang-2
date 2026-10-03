import { Assert, Errors } from '@shared/core'
import type { StudioTestStatus } from '../../StudioTestRunner'
import { StudioApiClient, type StudioHandshake } from '../StudioApiClient'
import {
  requestRuntimeCapture,
  type StudioFocusedPreview,
  StudioRuntimeData,
  type StudioRuntimeDataTable,
} from '../StudioMatrixView'
import type { StudioDrawerTab } from '../StudioProductPanels'
import { StudioDataFillCoordinator } from './StudioDataFillCoordinator'
import type { StudioDataPanelSnapshot, StudioTestPanelSnapshot } from './StudioProductHostState'

export type StudioDrawerPanelsDeps = Readonly<{
  focusedPreview: StudioFocusedPreview
  handshake: StudioHandshake
  /** Publishes the drawer's state; the Tao product host renders the panels. */
  render: () => void
  tabs: HTMLElement
}>

/**
 * The bottom drawer and the rail panel that mirrors its Data tab: which tab is showing, the live
 * data polled from the focused cell while a data view is visible, and the test run status.
 */
export class StudioDrawerPanels {
  readonly #deps: StudioDrawerPanelsDeps
  readonly #dataFill: StudioDataFillCoordinator
  #dataError: string | undefined
  #dataLoading = false
  #dataResult: readonly StudioRuntimeDataTable[] = []
  #dataTimer: ReturnType<typeof setInterval> | undefined
  #railPanel = 'files'
  #tab: StudioDrawerTab = 'Problems'
  #testError: string | undefined
  #testStatus: StudioTestStatus | undefined
  #testWatch = false

  constructor(deps: StudioDrawerPanelsDeps) {
    this.#deps = deps
    this.#dataFill = new StudioDataFillCoordinator(async isLatest => {
      this.#dataLoading = true
      this.#dataError = undefined
      deps.render()
      try {
        const preview = deps.focusedPreview.current()
        Assert.input(preview, 'Select a connected preview cell to inspect live app data.')
        const capture = await requestRuntimeCapture(preview, deps.handshake)
        if (isLatest() && preview === deps.focusedPreview.current()) {
          this.#dataResult = StudioRuntimeData.tables(capture)
          this.#dataLoading = false
          deps.render()
        }
      } catch (error) {
        if (isLatest()) {
          this.#dataLoading = false
          this.#dataError = Errors.messageOf(error)
          deps.render()
        }
      }
    })
  }

  tab(): StudioDrawerTab {
    return this.#tab
  }

  data(): StudioDataPanelSnapshot {
    return { error: this.#dataError, loading: this.#dataLoading, result: this.#dataResult }
  }

  tests(): StudioTestPanelSnapshot {
    return { error: this.#testError, status: this.#testStatus, watch: this.#testWatch }
  }

  testWatch(): boolean {
    return this.#testWatch
  }

  select(tab: StudioDrawerTab): void {
    this.#tab = tab
    for (const button of this.#deps.tabs.querySelectorAll<HTMLButtonElement>('[data-drawer-tab]')) {
      if (button.dataset['drawerTab'] === tab) {
        button.setAttribute('aria-current', 'true')
      } else {
        button.removeAttribute('aria-current')
      }
    }
    this.#deps.render()
    this.#synchronizeDataPolling()
  }

  /** The rail's Data panel shows the same live tables, so it keeps the poll alive too. */
  selectRail(panel: string | undefined): void {
    this.#railPanel = panel ?? this.#railPanel
    this.#synchronizeDataPolling()
  }

  dataPanelVisible(): boolean {
    return this.#tab === 'Data' || this.#railPanel === 'data'
  }

  async loadData(): Promise<void> {
    await this.#dataFill.request()
  }

  loadDataIfVisible(): void {
    if (this.dataPanelVisible()) {
      void this.loadData()
    }
  }

  /** The Logs tab reads straight from the focused preview, so it re-renders when that preview changes. */
  renderIfLogs(): void {
    if (this.#tab === 'Logs') {
      this.#deps.render()
    }
  }

  /** The focused cell changed: its predecessor's tables no longer apply. */
  resetData(): void {
    this.#dataResult = []
  }

  async loadTestStatus(): Promise<void> {
    try {
      this.#testStatus = await StudioApiClient.testStatus()
      this.#testError = undefined
    } catch (error) {
      this.#testError = Errors.messageOf(error)
    }
    this.#renderIfTests()
  }

  async runTests(): Promise<void> {
    if (this.#testStatus?.running === true) {
      return
    }
    this.#testError = undefined
    this.#testStatus = { ...(this.#testStatus ?? { available: true }), available: true, running: true }
    this.#renderIfTests()
    try {
      const lastRun = await StudioApiClient.testRun()
      this.#testStatus = { available: true, lastRun, running: false }
    } catch (error) {
      this.#testError = Errors.messageOf(error)
      this.#testStatus = { ...(this.#testStatus ?? { available: true }), running: false }
    }
    this.#renderIfTests()
  }

  async setTestWatch(watch: boolean): Promise<void> {
    this.#testWatch = watch
    this.#deps.render()
    if (watch) {
      await this.runTests()
    }
  }

  dispose(): void {
    if (this.#dataTimer !== undefined) {
      clearInterval(this.#dataTimer)
    }
  }

  #renderIfTests(): void {
    if (this.#tab === 'Tests') {
      this.#deps.render()
    }
  }

  #synchronizeDataPolling(): void {
    if (this.dataPanelVisible()) {
      void this.loadData()
      this.#dataTimer ??= setInterval(() => void this.loadData(), 2_000)
    } else if (this.#dataTimer !== undefined) {
      clearInterval(this.#dataTimer)
      this.#dataTimer = undefined
    }
  }
}
