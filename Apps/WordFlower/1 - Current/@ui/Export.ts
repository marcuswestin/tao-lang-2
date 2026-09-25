import { Share } from 'react-native'
import type { ExportDocument as ExportDocumentContract } from './Documents.tao'

class ExportFailure extends Error {
  constructor(readonly caseName: 'TooLarge' | 'Offline' | 'Cancelled', message: string) {
    super(message)
  }
}

const MAX_MARKDOWN_LENGTH = 1_000_000

/** Share the saved document as Markdown after checking the platform message size. */
export const ExportDocument: ExportDocumentContract = async document => {
  const markdown = `# ${document.Title}\n\n${document.Body}\n`
  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    throw new ExportFailure('TooLarge', 'This document is too long to export.')
  }

  try {
    const result = await Share.share({ title: document.Title, message: markdown })
    if (result.action === Share.dismissedAction) {
      throw new ExportFailure('Cancelled', '')
    }
  } catch (error) {
    if (isOfflineError(error)) {
      throw new ExportFailure('Offline', 'Exporting needs a connection.')
    }
    throw error
  }
}

function isOfflineError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  return ['ENETDOWN', 'ENETUNREACH', 'ENOTCONN'].includes(String(error.code))
}
