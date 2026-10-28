import { useState } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'

/**
 * THE TEAM LEADER'S WAY BACK TO THE CLERK (R-9). A question the clerk never hears is a ticket that
 * never moves, so the question is required: it is filed on the ticket's thread and rings the
 * clerk's bell. The rules live in ticketThread.canSendBack.
 */
export function SendBack({ toName, busy, onSend, title, subtitle, placeholder, button, testId = 'send-back', choices, choice, onChoice }: {
  toName: string | null
  busy: boolean
  onSend: (question: string) => Promise<void>
  /*
   * THE SAME BOX FOR THREE HAND-OVERS (S15): back to the clerk who raised it (R-9), on to the agent who
   * holds the account with the reason for it, and back to the liaison with the agent's feedback. Each one
   * is a required sentence, filed on the thread, a new desk and a bell -- only the words differ.
   */
  title?: string
  subtitle?: string
  placeholder?: string
  button?: string
  testId?: string
  /** WHO, where there is a choice (S15: the agent, or their team leader). */
  choices?: { id: string; name: string; rung: string }[]
  choice?: string | null
  onChoice?: (id: string) => void
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
    <div data-testid={testId}>
    <Card>
      <CardHeader
        title={title ?? `Send back to ${who}`}
        subtitle={subtitle ?? `Ask what you need to know. It leaves your desk, goes back to ${who} and they are told.`}
      />
      {choices && choices.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-2" role="radiogroup" data-testid={`${testId}-choices`}>
          {choices.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={choice === c.id} onClick={() => onChoice?.(c.id)}
              className={`rounded-lg border px-3 py-1.5 text-left text-sm ${choice === c.id
                ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              <span className="block font-medium">{c.name}</span>
              <span className={`block text-[11px] ${choice === c.id ? 'text-white/70' : 'text-slate-500'}`}>{c.rung}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        placeholder={placeholder ?? 'What do you need to know or have clarified?'}
        className="w-full text-sm border border-slate-200 rounded-md p-2"
        data-testid={`${testId}-question`}
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={!ready}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-slate-900 text-white disabled:opacity-40"
        data-testid={`${testId}-button`}
      >
        {working ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
        {button ?? `Send back to ${who}`}
      </button>
    </Card>
    </div>
  )
}
