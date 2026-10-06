import TR from '@runtime/TR'
import { wait } from '@runtime/TR-wait'
import { type Duration, types } from '../../../packages/apps/stdlib/@tao/core/Quantity.tao'

type WorkResource = Readonly<{ ID: number }>
type ResourceOwner = {
  controller: AbortController
  released: boolean
  handled: Promise<void>
  resolveHandled: () => void
}

const owners = new WeakMap<WorkResource, ResourceOwner>()
let currentResource: WorkResource | undefined
let nextResourceID = 1
let releasedResourceCount = 0

function ownerFor(resource: WorkResource): ResourceOwner {
  const owner = owners.get(resource)
  if (!owner) {
    return TR.Errors.failInput('This operation requires the original owned work resource.')
  }
  return owner
}

export function AcquireWorkResource(): WorkResource {
  const resource = Object.freeze({ ID: nextResourceID++ })
  let resolveHandled = () => {}
  const handled = new Promise<void>(resolve => {
    resolveHandled = resolve
  })
  owners.set(resource, {
    controller: new AbortController(),
    released: false,
    handled,
    resolveHandled,
  })
  currentResource = resource
  releasedResourceCount = 0
  return resource
}

export async function WaitCancelable(resource: WorkResource, duration: Duration): Promise<void> {
  await wait(types.Duration.Factory.read, duration, ownerFor(resource).controller.signal)
}

export async function CancelCurrentWork(): Promise<void> {
  if (!currentResource) {
    return TR.Errors.failInput('There is no owned work resource to cancel.')
  }
  const owner = ownerFor(currentResource)
  owner.controller.abort()
  await owner.handled
}

export function ReleaseWorkResource(resource: WorkResource): void {
  const owner = ownerFor(resource)
  if (owner.released) {
    return TR.Errors.failInput('This work resource has already been released.')
  }
  owner.released = true
  if (currentResource === resource) {
    currentResource = undefined
  }
  releasedResourceCount += 1
}

export function WorkOutcomeHandled(resource: WorkResource): void {
  const owner = ownerFor(resource)
  if (!owner.released) {
    return TR.Errors.failInput('Work outcome cannot complete before its resource is released.')
  }
  owner.resolveHandled()
}

export function ReleasedWorkResourceCount(): number {
  return releasedResourceCount
}
