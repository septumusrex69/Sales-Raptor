import { useSearchParams } from 'react-router-dom'

/** The query parameter naming one message a page should open and scroll to. */
export const EMAIL_FOCUS_PARAM = 'email'

/**
 * Which message this page was sent here to show, if any.
 *
 * Read from the URL rather than passed through state so the link survives a refresh, a
 * bookmark, and being pasted to a colleague — all of which are how someone chases a message
 * they were told about.
 */
export function useFocusedEmailId(): string | null {
  const [params] = useSearchParams()
  return params.get(EMAIL_FOCUS_PARAM)
}
