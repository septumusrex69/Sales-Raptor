/**
 * Bytes as somebody reads them.
 *
 * ONE DEFINITION BECAUSE TWO SCREENS SHOW IT. It began inside ComposeEmailModal, where the size of
 * an attachment decides whether a message can be sent at all; the Add a debtor box shows the same
 * figure for the case files coming in with an account. Two copies would drift, and the drift is
 * silent -- one screen saying 1 MB where the other says 1.0 MB is the kind of difference somebody
 * reports as a bug in whichever screen they saw second.
 *
 * en-ZA groups thousands with a non-breaking space (see CLAUDE.md, where it costs real money in an
 * SMS); a file size does not need grouping at all, so this formats by hand rather than by locale.
 */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
