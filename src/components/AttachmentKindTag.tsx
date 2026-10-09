import { attachmentKind } from '../lib/attachmentKind'

/** The word on an attachment chip that says what the file is -- PDF, Email, Excel. See attachmentKind. */
export function AttachmentKindTag({ name }: { name: string }) {
  const kind = attachmentKind(name)
  if (!kind) return null
  return (
    <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500"
      data-testid="attachment-kind">
      {kind}
    </span>
  )
}
