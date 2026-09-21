import { StudioDialog } from '../../studio-src/client/StudioDialog'

const productHost = document.querySelector<HTMLElement>('#product-host')!
const open = document.querySelector<HTMLButtonElement>('#open-confirm')!
const abort = document.querySelector<HTMLButtonElement>('#abort-dialog')!
const result = document.querySelector<HTMLOutputElement>('#dialog-result')!
const lifetime = new AbortController()

StudioDialog.mount({ container: productHost, signal: lifetime.signal })

open.addEventListener('click', () => {
  result.dataset['settled'] = 'false'
  result.textContent = 'pending'
  void StudioDialog.confirm({
    detail: 'The browser fixture aborts this pending decision through the mounted dialog scope.',
    title: 'Apply the proposed change?',
  }).then(answer => {
    result.dataset['answer'] = String(answer)
    result.dataset['settled'] = 'true'
    result.textContent = answer ? 'confirmed' : 'cancelled'
  })
})

abort.addEventListener('click', () => {
  document.documentElement.dataset['abortClicked'] = 'true'
  lifetime.abort()
})
document.documentElement.dataset['fixtureReady'] = 'true'
