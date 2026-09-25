import { Describe, Expect, Test } from '@shared/test'
import { Share } from 'react-native'

// The app sidecar lives outside packages/, the package typecheck root. Resolve it at test runtime.
const { ExportDocument } = require('../../../../Apps/WordFlower/1 - Current/@ui/Export') as {
  ExportDocument: (document: { Title: string; Body: string }) => Promise<void>
}

Describe('WordFlower Markdown export sidecar', () => {
  Test('hands the saved document to the share sheet as Markdown', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: Share.sharedAction })
    try {
      await ExportDocument({ Title: 'Opening', Body: 'The first line.' })
      Expect(share).toHaveBeenCalledWith({
        title: 'Opening',
        message: '# Opening\n\nThe first line.\n',
      })
    } finally {
      share.mockRestore()
    }
  })

  Test('treats a dismissed share sheet as cancellation', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: Share.dismissedAction })
    try {
      await Expect(ExportDocument({ Title: 'Opening', Body: '' })).rejects.toMatchObject({
        caseName: 'Cancelled',
      })
    } finally {
      share.mockRestore()
    }
  })

  Test('rejects an oversized document before opening the share sheet', async () => {
    const share = jest.spyOn(Share, 'share')
    try {
      await Expect(ExportDocument({ Title: 'Opening', Body: 'x'.repeat(1_000_000) }))
        .rejects.toMatchObject({ caseName: 'TooLarge' })
      Expect(share).not.toHaveBeenCalled()
    } finally {
      share.mockRestore()
    }
  })

  Test('maps a native network error to the declared Offline case', async () => {
    const share = jest.spyOn(Share, 'share').mockRejectedValueOnce({ code: 'ENETUNREACH' })
    try {
      await Expect(ExportDocument({ Title: 'Opening', Body: '' })).rejects.toMatchObject({
        caseName: 'Offline',
      })
    } finally {
      share.mockRestore()
    }
  })
})
