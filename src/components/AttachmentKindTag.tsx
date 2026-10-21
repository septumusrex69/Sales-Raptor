import { CornerDownRight } from 'lucide-react'
import { attachmentKind, attachmentParts } from '../lib/attachmentKind'

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

/**
 * WHAT A CHIP SAYS: the kind, then the file's own name -- and, for a file inside an attached
 * email, a turn-down arrow so it reads as belonging to the email chip before it (the firm, 9 Oct:
 * Outlook showed 18 on "Email trails", Raptor 8, because the other ten were inside the emails).
 */
export function AttachmentLabel({ name }: { name: string }) {
  const { leaf, inside } = attachmentParts(name)
  return (
    <>
      {inside && <CornerDownRight size={11} className="shrink-0 text-slate-400" aria-label={`Inside ${inside}`} />}
      <AttachmentKindTag name={name} />
      <span className="truncate">{leaf}</span>
    </>
  )
}
