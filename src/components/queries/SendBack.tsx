import { useState } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'

/**
 * THE TEAM LEADER'S WAY BACK TO THE CLERK (R-9). A question the clerk never hears is a ticket that
 * never moves, so the question is required: it is filed on the ticket's thread and rings the
 * clerk's bell. The rules live in ticketThread.canSendBack.
 */
export function SendBack({ toName, busy, onSend }: {
  toName: string | null
  busy: boolean
  onSend: (question: string) => Promise<void>
}) {
  const [question, setQuestion] = useState('')
  const [working, setWorking] = useState(false)
  const who = toName?.trim() || 'the clerk'
  const ready = question.trim().length > 0 && !busy && !working

  async function send() {
    setWorking(true)
    try { await onSend(question); setQuestion('') } finally { setWorking(false) }
  }

  return (
    <div data-testid="send-back">
    <Card>
      <CardHeader
        title={`Send back to ${who}`}
        subtitle={`Ask what you need to know. It leaves your desk, goes back to ${who} and they are told.`}
      />
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        placeholder="What do you need to know or have clarified?"
        className="w-full text-sm border border-slate-200 rounded-md p-2"
        data-testid="send-back-question"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={!ready}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-40"
        data-testid="send-back-button"
      >
        {working ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
        Send back to {who}
      </button>
    </Card>
    </div>
  )
}
