import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import {
  actionCancellationSignal,
  cancelActionContinuation,
  captureActionContinuation,
  deferDetached,
  deferTransactionCommit,
  markExternalEffect,
  registerDeferredAction,
  resumeActionContinuation,
  resumeSuspendedTransaction,
  runActionResult,
  runActionScope,
  runActionScopeUser,
  suspendActiveTransaction,
  type TaoActionContinuation,
} from '../TaoRuntime-src/TR-action-transactions'
import {
  actionExitOf,
  TaoActionFailure,
  type TaoActionFailureReport,
  UnexpectedBehaviorError,
} from '../TaoRuntime-src/TR-errors'
import { runMultiOutcome } from '../TaoRuntime-src/TR-multi-outcome'

function notes() {
  const saved: string[] = []
  const schema = TR.Data.Schema({
    name: 'LexicalCleanupNotes',
    entities: { Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } } },
  }, {
    load: () => undefined,
    save: snapshot => {
      saved.push(snapshot)
    },
  })
  return {
    add: (title: string) => TR.Data.Create(schema, 'Note', { Title: TR.Value(title) }),
    saved,
    schema,
    titles: () => schema.query({ entity: 'Note', filters: [] }).map(row => TR.Data.Read(row, 'Title')),
  }
}

async function root(body: () => unknown, allowFailure = false): Promise<readonly TaoActionFailureReport[]> {
  const reports: TaoActionFailureReport[] = []
  const stop = TR.Errors.onFailure(report => reports.push(report))
  try {
    await TR.Action(body, { name: 'CleanupRoot' }).jsValue.invoke()
  } finally {
    stop()
  }
  if (!allowFailure) {
    Expect(reports).toEqual([])
  }
  return reports
}

/** A cooperative test wait exercises the root signal without claiming the unpublished checked Wait leaf. */
function cooperativeWait(): { signal: AbortSignal | undefined; promise: Promise<void>; release: () => void } {
  const signal = actionCancellationSignal()
  let release!: () => void
  const promise = new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    release = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    if (signal?.aborted) {
      abort()
    } else {
      signal?.addEventListener('abort', abort, { once: true })
    }
  })
  return { signal, promise, release }
}

Describe('Tao lexical action cleanup', () => {
  Test('keeps joined multi-outcome bodies cancellable until deferred cleanup starts', async () => {
    const firstStarted = Deferred()
    const firstGate = Deferred()
    const secondStarted = Deferred()
    const cleanupStarted = Deferred()
    const cleanupGate = Deferred()
    const seen: string[] = []
    let continuation: TaoActionContinuation = {}
    let rootSignal: AbortSignal | undefined
    let firstResumedSignal: AbortSignal | undefined
    let secondWait: ReturnType<typeof cooperativeWait> | undefined
    let cleanupSignal: AbortSignal | undefined
    let cleanupResumedSignal: AbortSignal | undefined
    let cancellation: unknown
    let joined: unknown
    const running = root(() =>
      runActionScope(() => {
        continuation = captureActionContinuation()
        rootSignal = actionCancellationSignal()
        registerDeferredAction(() => {
          runActionScopeUser(async () => {
            cleanupSignal = actionCancellationSignal()
            seen.push('cleanup started')
            cleanupStarted.resolve()
            await cleanupGate.promise
            resumeActionContinuation(continuation)
            cleanupResumedSignal = actionCancellationSignal()
            seen.push('cleanup finished')
          })
        })
        joined = runMultiOutcome(() => undefined, () => ({ matched: true, payload: undefined }), [
          ['first', async () => {
            firstStarted.resolve()
            await firstGate.promise
            resumeActionContinuation(continuation)
            firstResumedSignal = actionCancellationSignal()
            seen.push('first body finished')
          }],
          ['second', async () => {
            secondWait = cooperativeWait()
            seen.push('second body started')
            secondStarted.resolve()
            try {
              await secondWait.promise
            } catch (error) {
              cancellation = error
            }
            resumeActionContinuation(continuation)
            seen.push('second body finished')
          }],
        ])
        seen.push('parent body finished')
      })
    )
    await firstStarted.promise
    try {
      Expect(seen).toEqual(['parent body finished'])
      Expect(rootSignal).toBeDefined()
      firstGate.resolve()
      await secondStarted.promise
      Expect(firstResumedSignal).toBe(rootSignal)
      Expect(secondWait?.signal).toBe(rootSignal)
      Expect(cancelActionContinuation(continuation)).toBe(true)
      await cleanupStarted.promise
      Expect(cancellation).toBe(rootSignal?.reason)
      Expect(rootSignal?.aborted).toBe(true)
      Expect(cleanupSignal).toBeUndefined()
      Expect(seen).toEqual([
        'parent body finished',
        'first body finished',
        'second body started',
        'second body finished',
        'cleanup started',
      ])
    } finally {
      firstGate.resolve()
      secondWait?.release()
      cleanupGate.resolve()
      await running
      await joined
    }
    Expect(cleanupResumedSignal).toBeUndefined()
    Expect(seen.at(-1)).toBe('cleanup finished')
  })

  Test('cancels a real cooperative root wait and shields nested asynchronous LIFO cleanup', async () => {
    const bodyStarted = Deferred()
    const cleanupStarted = Deferred()
    const seen: string[] = []
    const state = notes()
    const cleanupFault = new UnexpectedBehaviorError('cleanup fault')
    let continuation: TaoActionContinuation = {}
    let bodyWait: ReturnType<typeof cooperativeWait> | undefined
    let cleanupWait: ReturnType<typeof cooperativeWait> | undefined
    let caught: unknown
    let settled = false
    const running = root(async () => {
      try {
        await runActionScope(async () => {
          continuation = captureActionContinuation()
          state.add('Body')
          registerDeferredAction(() => {
            seen.push('older cleanup')
            throw cleanupFault
          })
          registerDeferredAction(() =>
            runActionScope(async () => {
              const nested = captureActionContinuation()
              registerDeferredAction(() => {
                Expect(actionCancellationSignal()).toBeUndefined()
                seen.push('nested cleanup')
              })
              cleanupWait = cooperativeWait()
              seen.push('cleanup start')
              cleanupStarted.resolve()
              await cleanupWait.promise
              resumeActionContinuation(nested)
              Expect(actionCancellationSignal()).toBeUndefined()
              state.add('Cleanup')
              seen.push('cleanup finished')
            })
          )
          bodyWait = cooperativeWait()
          bodyStarted.resolve()
          await bodyWait.promise
          seen.push('unexpected tail')
        })
      } catch (error) {
        caught = error
        throw error
      }
    }, true).then(reports => {
      settled = true
      return reports
    })
    await bodyStarted.promise
    try {
      Expect(bodyWait?.signal).toBeDefined()
      Expect(cancelActionContinuation(continuation)).toBe(true)
      Expect(cancelActionContinuation(continuation)).toBe(false)
      await cleanupStarted.promise
      Expect(bodyWait?.signal?.aborted).toBe(true)
      Expect(cleanupWait?.signal).toBeUndefined()
      Expect(settled).toBe(false)
      Expect(seen).toEqual(['cleanup start'])
    } finally {
      bodyWait?.release()
      cleanupWait?.release()
    }
    const reports = await running
    await TR.Data.Settle(state.schema)

    Expect(seen).toEqual(['cleanup start', 'cleanup finished', 'nested cleanup', 'older cleanup'])
    Expect(actionExitOf(caught)?.kind).toBe('cancelled')
    Expect(actionExitOf(caught)?.primary).toBe(bodyWait?.signal?.reason)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([cleanupFault])
    Expect(reports).toEqual([Expect['objectContaining']({ case: 'cancelled', message: 'Cancelled' })])
    Expect(state.titles()).toEqual([])
    Expect(state.saved).toEqual([])
    Expect(actionCancellationSignal()).toBeUndefined()
    Expect(() => cancelActionContinuation(continuation)).toThrow()
  })

  Test('preserves caught cancellation recovery while later cooperative waits see the same aborted signal', async () => {
    const started = Deferred()
    const state = notes()
    const failures: unknown[] = []
    let continuation: TaoActionContinuation = {}
    let wait: ReturnType<typeof cooperativeWait> | undefined
    const running = root(() =>
      runActionScope(async () => {
        continuation = captureActionContinuation()
        wait = cooperativeWait()
        started.resolve()
        try {
          await wait.promise
        } catch (error) {
          failures.push(error)
        }
        resumeActionContinuation(continuation)
        const later = cooperativeWait()
        Expect(later.signal).toBe(wait.signal)
        try {
          await later.promise
        } catch (error) {
          failures.push(error)
        }
        resumeActionContinuation(continuation)
        state.add('Recovered')
      })
    )
    await started.promise
    try {
      Expect(cancelActionContinuation(continuation)).toBe(true)
    } finally {
      wait?.release()
    }
    await running
    await TR.Data.Settle(state.schema)

    Expect(failures).toEqual([wait?.signal?.reason, wait?.signal?.reason])
    Expect(wait?.signal?.reason).toBeInstanceOf(TaoActionFailure)
    Expect(state.titles()).toEqual(['Recovered'])
    Expect(state.saved).toHaveLength(1)
  })

  Test('adopts a public WhenDo handler thenable once and drains cleanup after its work', async () => {
    for (const scoped of [false, true]) {
      const seen: string[] = []
      let calls = 0
      await root(() => {
        const body = async () => {
          if (scoped) {
            TR.Defer(() => seen.push('cleanup'))
          }
          const result = await TR.WhenDo(() => undefined, { name: 'LazyWork', declared: [] }, [
            ['saved', () => ({
              then(resolve: (value: string) => void) {
                calls++
                seen.push(`work ${calls}`)
                resolve('settled value')
              },
            })],
          ])
          Expect(result).toBe('settled value')
          seen.push('after-work')
        }
        return scoped ? TR.ActionScope(body) : body()
      })
      Expect(calls).toBe(1)
      Expect(seen).toEqual(scoped ? ['work 1', 'after-work', 'cleanup'] : ['work 1', 'after-work'])
    }
  })

  Test('keeps synchronous public WhenDo handler results synchronous and unchanged', async () => {
    const value = { saved: true }
    const seen: string[] = []
    await root(() => {
      const result = TR.ActionScope(() => {
        TR.Defer(() => seen.push('cleanup'))
        const handled = TR.WhenDo(() => undefined, { name: 'SyncWork', declared: [] }, [
          ['saved', () => value],
        ])
        Expect(handled).toBe(value)
        seen.push('after-work')
        return handled
      })
      Expect(result).toBe(value)
    })
    Expect(seen).toEqual(['after-work', 'cleanup'])
  })

  Test('joins unawaited public WhenDo work once even when its result is observed after scope exit', async () => {
    const gate = Deferred()
    const started = Deferred()
    const seen: string[] = []
    let calls = 0
    let pending: unknown
    const action = root(() =>
      runActionScope(() => {
        registerDeferredAction(() => seen.push('cleanup'))
        pending = TR.WhenDo(() => undefined, { name: 'JoinedLazyWork', declared: [] }, [
          ['saved', () => ({
            then(resolve: (value: string) => void) {
              calls++
              started.resolve()
              void gate.promise.then(() => {
                seen.push(`work ${calls}`)
                resolve('joined value')
              })
            },
          })],
        ])
        seen.push('body-end')
      })
    )
    await started.promise
    try {
      Expect(calls).toBe(1)
      Expect(seen).toEqual(['body-end'])
    } finally {
      gate.resolve()
    }
    await action
    Expect(seen).toEqual(['body-end', 'work 1', 'cleanup'])
    Expect(await pending).toBe('joined value')
    Expect(await pending).toBe('joined value')
    Expect(calls).toBe(1)
    Expect(seen).toEqual(['body-end', 'work 1', 'cleanup'])
  })

  Test('adopts a rejected public WhenDo handler once and preserves its primary through cleanup', async () => {
    const primary = Object.freeze(new TaoActionFailure('WorkFailed', 'Work failed'))
    const cleanup = new UnexpectedBehaviorError('cleanup failed')
    const seen: string[] = []
    let calls = 0
    let caught: unknown
    await root(async () => {
      try {
        await runActionScope(async () => {
          registerDeferredAction(() => {
            seen.push('cleanup')
            throw cleanup
          })
          await TR.WhenDo(() => undefined, { name: 'LazyFailure', declared: [] }, [
            ['saved', () => ({
              then(_resolve: unknown, reject: (error: unknown) => void) {
                calls++
                seen.push(`work ${calls}`)
                reject(primary)
              },
            })],
          ])
          seen.push('unexpected tail')
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(calls).toBe(1)
    Expect(seen).toEqual(['work 1', 'cleanup'])
    Expect(actionExitOf(caught)?.primary).toBe(primary)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([cleanup])
    Expect(actionExitOf(caught)?.stage).toBe('body')
  })

  Test('drains public WhenDo handler promise faults without replacing their original identity', async () => {
    for (const property of ['constructor', 'then']) {
      const fault = new UnexpectedBehaviorError(`handler promise ${property}`)
      const promise = Promise.resolve('handler result')
      if (property === 'constructor') {
        Object.defineProperty(promise, property, {
          get() {
            throw fault
          },
        })
      } else {
        Object.defineProperty(promise, property, {
          value() {
            throw fault
          },
        })
      }
      const seen: string[] = []
      let caught: unknown
      await root(async () => {
        try {
          await runActionScope(async () => {
            registerDeferredAction(() => seen.push('cleanup'))
            await TR.WhenDo(() => undefined, { name: 'PoisonedHandler', declared: [] }, [
              ['saved', () => promise],
            ])
            seen.push('unexpected tail')
          })
        } catch (error) {
          caught = error
        }
      })
      Expect(caught).toBe(fault)
      Expect(seen).toEqual(['cleanup'])
    }
  })

  Test('runs synchronous cleanup LIFO in the live overlay before one root commit', async () => {
    const state = notes()
    const seen: string[] = []
    const reports = await root(() => {
      const value = runActionScope(() => {
        state.add('Body')
        registerDeferredAction(() => {
          Expect(state.saved).toEqual([])
          Expect(state.titles()).toEqual(['Body', 'Second'])
          state.add('First')
          seen.push('first')
        })
        registerDeferredAction(() => {
          state.add('Second')
          seen.push('second')
        })
        return 42
      })
      Expect(value).toBe(42)
      seen.push('after-scope')
    })
    await TR.Data.Settle(state.schema)
    Expect(reports).toEqual([])
    Expect(seen).toEqual(['second', 'first', 'after-scope'])
    Expect(state.titles()).toEqual(['Body', 'Second', 'First'])
    Expect(state.saved).toHaveLength(1)
  })

  Test('uses the innermost lexical frame, ordinary late capture and early block return', async () => {
    const seen: string[] = []
    await root(() =>
      runActionScope(() => {
        let value = 'before'
        const snapshot = value
        registerDeferredAction(() => seen.push(`outer:${value}:${snapshot}`))
        const result = runActionScope(() => {
          registerDeferredAction(() => seen.push('inner'))
          return 'early'
        })
        Expect(result).toBe('early')
        registerDeferredAction(() => seen.push('outer-last'))
        value = 'after'
      })
    )
    Expect(seen).toEqual(['inner', 'outer-last', 'outer:after:before'])
  })

  Test('awaits serial cleanup and keeps following roots queued until cleanup commits', async () => {
    const state = notes()
    const wait = Deferred()
    const started = Deferred()
    const seen: string[] = []
    const action = TR.Action(() =>
      runActionScope(() => {
        state.add('Body')
        registerDeferredAction(() => {
          seen.push('older')
          state.add('Older')
        })
        registerDeferredAction(async () => {
          const continuation = captureActionContinuation()
          seen.push('newer-start')
          started.resolve()
          await wait.promise
          resumeActionContinuation(continuation)
          Expect(state.saved).toEqual([])
          state.add('Newer')
          seen.push('newer-end')
        })
      }), { name: 'ScopedSave' })
    const first = action.jsValue.invoke()
    await started.promise
    const second = TR.Action(() => seen.push('next-root'), { name: 'NextRoot' }).jsValue.invoke()
    try {
      Expect(seen).toEqual(['newer-start'])
      Expect(state.saved).toEqual([])
    } finally {
      wait.resolve()
    }
    await first
    await second
    await TR.Data.Settle(state.schema)
    Expect(seen).toEqual(['newer-start', 'newer-end', 'older', 'next-root'])
    Expect(state.titles()).toEqual(['Body', 'Newer', 'Older'])
    Expect(state.saved).toHaveLength(1)
  })

  Test('waits for real joined users and their late registrations before draining the parent', async () => {
    const wait = Deferred()
    const started = Deferred()
    const seen: string[] = []
    const child = TR.Action(async () => {
      const continuation = captureActionContinuation()
      seen.push('child-start')
      started.resolve()
      await wait.promise
      resumeActionContinuation(continuation)
      registerDeferredAction(() => seen.push('child-registered'))
      seen.push('child-end')
    }, { name: 'JoinedUser' })
    const pending = root(() =>
      runActionScope(() => {
        registerDeferredAction(() => seen.push('parent-cleanup'))
        void TR.Do(child)
        seen.push('body-end')
      })
    )
    await started.promise
    try {
      Expect(seen).toEqual(['child-start', 'body-end'])
    } finally {
      wait.resolve()
    }
    Expect(await pending).toEqual([])
    Expect(seen).toEqual(['child-start', 'body-end', 'child-end', 'child-registered', 'parent-cleanup'])
  })

  Test('joins asynchronous handled outcomes through the end of their resource use', async () => {
    const wait = Deferred()
    const started = Deferred()
    const state = notes()
    const seen: string[] = []
    const child = TR.Action(() => {
      state.add('Discarded')
      throw new TaoActionFailure('Offline', 'Offline')
    }, { name: 'ContainedUser' })
    const pending = root(() =>
      runActionScope(() => {
        state.add('Caller')
        registerDeferredAction(() => {
          Expect(state.titles()).toEqual(['Caller', 'Recovered'])
          seen.push('cleanup')
        })
        void TR.WhenDo(() => TR.Do(child), { declared: ['Offline'], name: 'ContainedUser' }, [[
          'Offline',
          async () => {
            const continuation = captureActionContinuation()
            seen.push('handler-start')
            started.resolve()
            await wait.promise
            resumeActionContinuation(continuation)
            state.add('Recovered')
            seen.push('handler-end')
          },
        ]])
      })
    )
    await started.promise
    try {
      Expect(seen).toEqual(['handler-start'])
    } finally {
      wait.resolve()
    }
    Expect(await pending).toEqual([])
    Expect(seen).toEqual(['handler-start', 'handler-end', 'cleanup'])
  })

  Test('awaits nested scopes and joined users started by a cleanup before the next cleanup', async () => {
    const wait = Deferred()
    const started = Deferred()
    const seen: string[] = []
    const child = TR.Action(async () => {
      const continuation = captureActionContinuation()
      started.resolve()
      await wait.promise
      resumeActionContinuation(continuation)
      seen.push('joined-cleanup-user')
    }, { name: 'CleanupUser' })
    const pending = root(() =>
      runActionScope(() => {
        registerDeferredAction(() => seen.push('older'))
        registerDeferredAction(() => {
          seen.push('newer-start')
          void runActionScope(() => {
            registerDeferredAction(() => seen.push('nested-cleanup'))
            void TR.Do(child)
          })
        })
      })
    )
    await started.promise
    try {
      Expect(seen).toEqual(['newer-start'])
    } finally {
      wait.resolve()
    }
    Expect(await pending).toEqual([])
    Expect(seen).toEqual(['newer-start', 'joined-cleanup-user', 'nested-cleanup', 'older'])
  })

  Test('restores scope identity after an interrupt root and debugger suspension', async () => {
    const wait = Deferred()
    const started = Deferred()
    const state = notes()
    const seen: string[] = []
    const asking = TR.Action(() =>
      runActionScope(async () => {
        const continuation = captureActionContinuation()
        registerDeferredAction(() => {
          state.add('Asking cleanup')
          seen.push('asking-cleanup')
        })
        const suspended = suspendActiveTransaction()
        resumeSuspendedTransaction(suspended)
        started.resolve()
        await wait.promise
        resumeActionContinuation(continuation)
        registerDeferredAction(() => seen.push('after-await'))
        state.add('Asking')
      }), { name: 'AskingRoot' })
    const pending = asking.jsValue.invoke()
    await started.promise
    const respond = TR.Action(() =>
      runActionScope(() => {
        state.add('Response')
        registerDeferredAction(() => seen.push('response-cleanup'))
        wait.resolve()
      }), { name: 'ResponseRoot', interrupt: true })
    await respond.jsValue.invoke()
    await pending
    await TR.Data.Settle(state.schema)
    Expect(seen).toEqual(['response-cleanup', 'after-await', 'asking-cleanup'])
    Expect(state.titles()).toEqual(['Response', 'Asking', 'Asking cleanup'])
    Expect(state.saved).toHaveLength(2)
  })

  Test('drains every asynchronous cleanup while retaining a frozen primary and all cleanup faults', async () => {
    const primary = Object.freeze({ problem: 'body' })
    const older = new UnexpectedBehaviorError('older cleanup')
    const newer = new UnexpectedBehaviorError('newer cleanup')
    const seen: string[] = []
    let caught: unknown
    await root(async () => {
      try {
        await runActionScope(() => {
          registerDeferredAction(() => {
            seen.push('older')
            throw older
          })
          registerDeferredAction(async () => {
            seen.push('newer-start')
            await Promise.resolve()
            seen.push('newer-end')
            throw newer
          })
          throw primary
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(seen).toEqual(['newer-start', 'newer-end', 'older'])
    Expect(actionExitOf(caught)).toEqual({
      kind: 'failure',
      primary,
      cleanupFailures: [newer, older],
      stage: 'body',
    })
    Expect(actionExitOf(caught)?.primary).toBe(primary)
    Expect(Object.keys(primary)).toEqual(['problem'])
  })

  Test('preserves a thrown undefined primary rather than mistaking it for body success', async () => {
    const cleanup = new UnexpectedBehaviorError('cleanup')
    let caught: unknown
    let escaped = false
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() => {
            throw cleanup
          })
          throw undefined
        })
      } catch (error) {
        escaped = true
        caught = error
      }
    })
    Expect(escaped).toBe(true)
    Expect(actionExitOf(caught)?.primary).toBeUndefined()
    Expect(actionExitOf(caught)?.stage).toBe('body')
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([cleanup])
  })

  Test('passes the exact body throw through when cleanup succeeds', async () => {
    const primary = new UnexpectedBehaviorError('original')
    let caught: unknown
    const seen: string[] = []
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() => seen.push('cleanup'))
          throw primary
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(caught).toBe(primary)
    Expect(actionExitOf(caught)).toBeUndefined()
    Expect(seen).toEqual(['cleanup'])
  })

  Test('flattens nested cleanup failures once without replacing the outer primary', async () => {
    const primary = 'outer body'
    const nestedBody = 'nested body'
    const nestedCleanup = 'nested cleanup'
    let caught: unknown
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() =>
            runActionScope(() => {
              registerDeferredAction(() => {
                throw nestedCleanup
              })
              throw nestedBody
            })
          )
          throw primary
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(actionExitOf(caught)?.primary).toBe(primary)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([nestedBody, nestedCleanup])
  })

  Test('retains an inner cleanup-only stage and sampled result through outer body scopes', async () => {
    const cleanup = new UnexpectedBehaviorError('cleanup failed')
    let caught: unknown
    await root(() => {
      try {
        runActionScope(() =>
          runActionScope(() => {
            registerDeferredAction(() => {
              throw cleanup
            })
            return 'sampled'
          })
        )
      } catch (error) {
        caught = error
      }
    })
    Expect(actionExitOf(caught)).toEqual({
      kind: 'failure',
      primary: cleanup,
      cleanupFailures: [cleanup],
      stage: 'cleanup',
      result: 'sampled',
    })
  })

  Test('runs cleanup for modeled cancellation and preserves cancellation when cleanup fails', async () => {
    const cancellation = new TaoActionFailure('cancelled', 'Cancelled')
    const cleanup = new UnexpectedBehaviorError('cleanup fault')
    const seen: string[] = []
    let caught: unknown
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() => seen.push('older'))
          registerDeferredAction(() => {
            throw cleanup
          })
          throw cancellation
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(seen).toEqual(['older'])
    Expect(actionExitOf(caught)?.kind).toBe('cancelled')
    Expect(actionExitOf(caught)?.primary).toBe(cancellation)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([cleanup])
  })

  Test('preserves primary typed/raw outcome routing and restores savepoints after cleanup', async () => {
    for (const primary of [new TaoActionFailure('Offline', 'offline body'), new UnexpectedBehaviorError('raw body')]) {
      const state = notes()
      const seen: string[] = []
      const child = TR.Action(() =>
        runActionScope(() => {
          state.add('Callee')
          registerDeferredAction(() => {
            Expect(state.titles()).toEqual(['Caller', 'Callee'])
            state.add('Cleanup')
            seen.push('cleanup')
            throw new TaoActionFailure('CleanupFault', 'cleanup fault')
          })
          throw primary
        }), { name: 'ContainedScopedAction' })
      const reports = await root(async () => {
        state.add('Caller')
        await TR.WhenDo(() => TR.Do(child), { declared: ['Offline'], open: true, name: 'Child' }, [
          ['rejected', message => {
            seen.push(`rejected:${message.evaluate().jsValue}`)
          }],
          ['error', message => {
            seen.push(`error:${message.evaluate().jsValue}`)
          }],
          ['saved', () => seen.push('saved')],
        ])
        state.add('Tail')
      })
      await TR.Data.Settle(state.schema)
      Expect(reports).toEqual([])
      Expect(seen).toEqual([
        'cleanup',
        primary instanceof TaoActionFailure ? 'rejected:offline body' : 'error:raw body',
      ])
      Expect(state.titles()).toEqual(['Caller', 'Tail'])
      Expect(state.saved).toHaveLength(1)
    }
  })

  Test('cleanup-only failure suppresses result use and preserves successful external work facts', async () => {
    const state = notes()
    const cleanup = new UnexpectedBehaviorError('closing failed')
    let external = 0
    let caught: unknown
    let tail = false
    const reports = await root(async () => {
      try {
        await runActionResult('ReadAndClose', [], () =>
          runActionScope(() => {
            markExternalEffect()
            external += 1
            state.add('Tentative')
            registerDeferredAction(() => {
              throw cleanup
            })
            return 'result already sampled'
          }))
        tail = true
      } catch (error) {
        caught = error
        throw error
      }
    }, true)
    Expect(external).toBe(1)
    Expect(tail).toBe(false)
    Expect(state.titles()).toEqual([])
    Expect(actionExitOf(caught)?.primary).toBe(cleanup)
    Expect(actionExitOf(caught)?.result).toBe('result already sampled')
    Expect(reports).toHaveLength(1)
    Expect(reports[0]?.retryEligible).toBe(false)
    Expect(reports[0]?.message).not.toContain('Nothing was changed')
  })

  Test('preserves deepest joined failure frames when cleanup creates a carrier', async () => {
    const primary = new TaoActionFailure('Offline', 'deep failure')
    const deepest = TR.Action(() => {
      throw primary
    }, { name: 'Deepest' })
    const middle = TR.Action(() =>
      runActionScope(async () => {
        registerDeferredAction(() => {
          throw new UnexpectedBehaviorError('closing')
        })
        await TR.Do(deepest)
      }), { name: 'Middle' })
    const reports = await root(async () => {
      await TR.Do(middle)
    }, true)
    Expect(reports).toHaveLength(1)
    Expect(reports[0]?.case).toBe('Offline')
    Expect(reports[0]?.message).toBe('deep failure')
    Expect(reports[0]?.frames).toEqual(['CleanupRoot', 'Middle', 'Deepest'])
  })

  Test('keeps detached work independent and leaves post-commit publication behavior intact', async () => {
    const wait = Deferred()
    const started = Deferred()
    const finished = Deferred()
    const seen: string[] = []
    Expect(
      await root(() =>
        runActionScope(() => {
          deferDetached(async () => {
            seen.push('detached-start')
            started.resolve()
            await wait.promise
            seen.push('detached-end')
            finished.resolve()
          })
          deferTransactionCommit(() => seen.push('published'))
          registerDeferredAction(() => seen.push('cleanup'))
        })
      ),
    ).toEqual([])
    await started.promise
    try {
      Expect(seen).toEqual(['cleanup', 'published', 'detached-start'])
    } finally {
      wait.resolve()
    }
    await finished.promise
    Expect(seen).toEqual(['cleanup', 'published', 'detached-start', 'detached-end'])
  })

  Test('rejects registration outside a lexical frame and rejects a resumed closed frame', async () => {
    Expect(() => registerDeferredAction(() => {})).toThrow()
    let continuation: ReturnType<typeof captureActionContinuation> | undefined
    await root(() => {
      runActionScope(() => {
        continuation = captureActionContinuation()
      })
      Expect(() => resumeActionContinuation(continuation!)).toThrow()
      Expect(() => registerDeferredAction(() => {})).toThrow()
    })
  })

  Test('records a nested cleanup-only primary once in an outer cleanup fault list', async () => {
    const cleanup = 'inner cleanup only'
    let caught: unknown
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() =>
            runActionScope(() => {
              registerDeferredAction(() => {
                throw cleanup
              })
              return 'inner result'
            })
          )
          throw 'outer primary'
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(actionExitOf(caught)?.primary).toBe('outer primary')
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([cleanup])
  })

  Test('does not complete a cancelled invocation before its already-started cleanup settles', async () => {
    const wait = Deferred()
    const started = Deferred()
    const cancellation = new TaoActionFailure('cancelled', 'Cancelled')
    const seen: string[] = []
    const pending = root(() =>
      runActionScope(() => {
        registerDeferredAction(() => seen.push('older cleanup'))
        registerDeferredAction(async () => {
          const continuation = captureActionContinuation()
          seen.push('cleanup started')
          started.resolve()
          await wait.promise
          resumeActionContinuation(continuation)
          seen.push('cleanup settled')
        })
        throw cancellation
      }), true)
    await started.promise
    try {
      Expect(seen).toEqual(['cleanup started'])
    } finally {
      wait.resolve()
    }
    const reports = await pending
    Expect(seen).toEqual(['cleanup started', 'cleanup settled', 'older cleanup'])
    Expect(reports[0]?.case).toBe('cancelled')
  })

  Test('reports cleanup stage without claiming irreversible work changed nothing', async () => {
    let external = 0
    const reports = await root(() =>
      runActionScope(() => {
        markExternalEffect()
        external += 1
        registerDeferredAction(() => {
          throw undefined
        })
        return 'sampled'
      }), true)
    Expect(external).toBe(1)
    Expect(reports).toHaveLength(1)
    Expect(reports[0]?.retryEligible).toBe(false)
    Expect(reports[0]?.message).toContain('cleanup')
    Expect(reports[0]?.message).not.toContain('Nothing was changed')
  })

  Test('keeps actual foreign raw and provider failures distinct after lexical cleanup fails', async () => {
    const raw = new UnexpectedBehaviorError('foreign raw')
    const provider = Object.assign(new UnexpectedBehaviorError('foreign provider'), { case: 'Offline' })
    for (const primary of [raw, provider]) {
      const seen: string[] = []
      const foreign = TR.ForeignAction(
        async () => {
          throw primary
        },
        'Foreign',
        [],
      )
      const wrapper = TR.Action(() =>
        runActionScope(async () => {
          registerDeferredAction(() => {
            throw new UnexpectedBehaviorError('cleanup')
          })
          await TR.Do(foreign)
        }), { name: 'ScopedForeign' })
      Expect(
        await root(async () => {
          await TR.WhenDo(() => TR.Do(wrapper), { declared: ['Offline'], open: true, name: 'Foreign' }, [
            ['rejected', message => {
              seen.push(`rejected:${message.evaluate().jsValue}`)
            }],
            ['error', message => {
              seen.push(`error:${message.evaluate().jsValue}`)
            }],
            ['saved', () => seen.push('saved')],
          ])
        }),
      ).toEqual([])
      Expect(seen).toEqual([primary === raw ? 'error:foreign raw' : 'rejected:foreign provider'])
    }
  })

  Test('rejects a frame belonging to another live transaction without stealing its registrations', async () => {
    const wait = Deferred()
    const started = Deferred()
    const seen: string[] = []
    let outer!: ReturnType<typeof captureActionContinuation>
    const first = TR.Action(() =>
      runActionScope(async () => {
        outer = captureActionContinuation()
        registerDeferredAction(() => seen.push('outer cleanup'))
        started.resolve()
        await wait.promise
        resumeActionContinuation(outer)
      }), { name: 'OuterScope' }).jsValue.invoke()
    await started.promise
    const response = TR.Action(() =>
      runActionScope(() => {
        const own = captureActionContinuation()
        Expect(() => resumeActionContinuation({ transaction: own.transaction, scope: outer.scope })).toThrow()
        registerDeferredAction(() => seen.push('response cleanup'))
        wait.resolve()
      }), { name: 'ResponseScope', interrupt: true })
    await response.jsValue.invoke()
    await first
    Expect(seen).toEqual(['response cleanup', 'outer cleanup'])
  })

  Test('drains a body whose returned promise-like value throws during inspection', async () => {
    const fault = new UnexpectedBehaviorError('body then getter')
    const seen: string[] = []
    let caught: unknown
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() => seen.push('cleanup'))
          return {
            get then(): never {
              throw fault
            },
          }
        })
      } catch (error) {
        caught = error
      }
      Expect(() => registerDeferredAction(() => {})).toThrow()
    })
    Expect(caught).toBe(fault)
    Expect(seen).toEqual(['cleanup'])
  })

  Test('keeps draining when a cleanup promise getter throws and retains the body primary', async () => {
    const primary = new TaoActionFailure('Offline', 'body primary')
    const fault = new UnexpectedBehaviorError('cleanup then getter')
    const seen: string[] = []
    let caught: unknown
    await root(() => {
      try {
        runActionScope(() => {
          registerDeferredAction(() => seen.push('older cleanup'))
          registerDeferredAction(() => ({
            get then(): never {
              throw fault
            },
          }))
          throw primary
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(seen).toEqual(['older cleanup'])
    Expect(actionExitOf(caught)?.primary).toBe(primary)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([fault])
  })

  Test('drains a body when returned promise normalization or handler attachment throws', async () => {
    for (const property of ['constructor', 'then'] as const) {
      const fault = new UnexpectedBehaviorError(`body promise ${property}`)
      const promise = Promise.resolve()
      Object.defineProperty(
        promise,
        property,
        property === 'constructor'
          ? {
            get: () => {
              throw fault
            },
          }
          : {
            value: () => {
              throw fault
            },
          },
      )
      const seen: string[] = []
      let caught: unknown
      await root(async () => {
        try {
          await runActionScope(() => {
            registerDeferredAction(() => seen.push('cleanup'))
            return promise
          })
        } catch (error) {
          caught = error
        }
        Expect(() => registerDeferredAction(() => {})).toThrow()
      })
      Expect(caught).toBe(fault)
      Expect(seen).toEqual(['cleanup'])
    }
  })

  Test('retains the primary and older cleanup when cleanup promise normalization or attachment throws', async () => {
    for (const property of ['constructor', 'then'] as const) {
      const primary = new TaoActionFailure('Offline', 'body primary')
      const fault = new UnexpectedBehaviorError(`cleanup promise ${property}`)
      const promise = Promise.resolve()
      Object.defineProperty(
        promise,
        property,
        property === 'constructor'
          ? {
            get: () => {
              throw fault
            },
          }
          : {
            value: () => {
              throw fault
            },
          },
      )
      const seen: string[] = []
      let caught: unknown
      await root(async () => {
        try {
          await runActionScope(() => {
            registerDeferredAction(() => seen.push('older cleanup'))
            registerDeferredAction(() => promise)
            throw primary
          })
        } catch (error) {
          caught = error
        }
      })
      Expect(seen).toEqual(['older cleanup'])
      Expect(actionExitOf(caught)?.primary).toBe(primary)
      Expect(actionExitOf(caught)?.cleanupFailures).toEqual([fault])
    }
  })

  Test('assimilates synchronous foreign settlement once before cleanup fails', async () => {
    const ignored = new UnexpectedBehaviorError('thrown after settlement')
    const cleanup = new UnexpectedBehaviorError('actual cleanup fault')
    const promise = Promise.resolve('original')
    Object.defineProperty(promise, 'then', {
      value: (resolve: (value: string) => void) => {
        resolve('sampled')
        throw ignored
      },
    })
    let cleaned = 0
    let caught: unknown
    await root(async () => {
      try {
        await runActionScope(() => {
          registerDeferredAction(() => {
            cleaned += 1
            throw cleanup
          })
          return promise
        })
      } catch (error) {
        caught = error
      }
    })
    Expect(cleaned).toBe(1)
    Expect(actionExitOf(caught)?.primary).toBe(cleanup)
    Expect(actionExitOf(caught)?.cleanupFailures).toEqual([cleanup])
    Expect(actionExitOf(caught)?.stage).toBe('cleanup')
    Expect(actionExitOf(caught)?.result).toBe('sampled')
  })
})
