export type FieldErrors = Record<string, string>

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!error || typeof error !== 'object') return {}

  const err = error as any

  if (err.response?.data && typeof err.response.data === 'object') {
    const errors: FieldErrors = {}
    for (const [field, detail] of Object.entries(err.response.data)) {
      if (
        detail &&
        typeof detail === 'object' &&
        'message' in (detail as any) &&
        typeof (detail as any).message === 'string'
      ) {
        errors[field] = (detail as any).message
      }
    }
    return errors
  }

  if (err.message) {
    return { _general: err.message }
  }

  return {}
}

export function getErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred.'

  if (error instanceof Error) return error.message

  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : 'An unexpected error occurred.'
}
