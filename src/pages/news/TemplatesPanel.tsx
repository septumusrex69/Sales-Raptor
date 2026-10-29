import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, LayoutTemplate, Pencil, Send } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { CAMPAIGN_KIND_LABELS, SEND_FROM_LABELS, type SendFrom } from '../../lib/marketing.ts'
import { EMAIL_HTML_MARKER, isHtmlBody, storeHtmlBody, textToEmailHtml } from '../../lib/campaignHtml'
import {
  campaignFromTemplate, listSenders, listTemplates, updateTemplate, uploadEmailPicture, type ExtraSender, type TemplateRow,
} from '../../lib/marketingApi'
import { clockNow } from '../../lib/clock'
import { RichEditor } from './RichEditor'
import { Field, INPUT, errorText } from './shared'

/**
 * TEMPLATES (Ryno, 29 Oct): "I design a whole email template ... with the context and everything ... saved under
 * the templates", and "if I do a template for our newsletters and I want to send it now specifically from only
 * Nicole ... then I want that thing to have that template saved". A template keeps the words, the design and the
 * sender; a campaign started from it takes all three, and may still change the sender for that one send.
 *
 * Templates are archived, never deleted, so a campaign started from one can still say which.
 */
export function TemplatesPanel({ schemaReady }: { schemaReady: boolean }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TemplateRow[] | null>(null)
  const [senders, setSenders] = useState<ExtraSender[]>([])
  const [editing, setEditing] = useState<TemplateRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => listTemplates().then(setRows).catch((e: unknown) => { setRows([]); setError(errorText(e)) })
  useEffect(() => {
    if (!schemaReady) return
    void load()
    listSenders().then(setSenders).catch(() => setSenders([]))
  }, [schemaReady])

  if (!schemaReady) {
    return <Card><p className="text-sm text-slate-600" data-testid="news-templates-waiting">Templates need one database change first (campaign_compose). Until then a campaign can be copied by starting a new one and pasting.</p></Card>
  }
  const senderLabel = (t: TemplateRow) => t.send_from === 'address'
    ? senders.find((s) => s.id === t.sender_address_id)?.address ?? SEND_FROM_LABELS.address
    : t.kind === 'news' ? SEND_FROM_LABELS[t.send_from] : 'The marketer'
  const use = async (t: TemplateRow) => {
    try {
      const c = await campaignFromTemplate(t, `${t.name} ${clockNow().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`)
      navigate(`/news/${c.id}`)
    } catch (e) { setError(errorText(e)) }
  }

  return (
    <div className="space-y-4" data-testid="news-templates">
      <p className="text-sm text-slate-500">Save a campaign as a template from its Write step (“Save as template”). Each keeps its words, design and who it is sent from.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows === null ? <p className="text-sm text-slate-400">Loading…</p> : rows.length === 0 ? (
        <Card><div className="p-4 text-center text-sm text-slate-500"><LayoutTemplate className="mx-auto mb-2 text-slate-300" size={28} />No templates yet.</div></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <Card key={t.id}>
              <div data-testid="news-template">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-800 truncate">{t.name}</h3>
                    <p className="text-xs text-slate-500">{CAMPAIGN_KIND_LABELS[t.kind]} · from {senderLabel(t)}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-700 mt-2 truncate">{t.subject || <span className="text-slate-400">No subject yet</span>}</p>
                <p className="text-xs text-slate-400 truncate">{t.preheader}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => void use(t)} data-testid="news-template-use">Use it</Button>
                  <Button size="sm" icon={<Pencil size={13} />} onClick={() => setEditing(t)}>Edit</Button>
                  <Button size="sm" icon={<Archive size={13} />} onClick={() => void updateTemplate(t.id, { archived_at: clockNow().toISOString() }).then(load).catch((e: unknown) => setError(errorText(e)))}>Archive</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <TemplateModal template={editing} senders={senders} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

function TemplateModal({ template, senders, onClose, onSaved }: { template: TemplateRow; senders: ExtraSender[]; onClose: () => void; onSaved: () => void }) {
  const { currentUser } = useAuth()
  const [t, setT] = useState(template)
  const [error, setError] = useState<string | null>(null)
  const html = isHtmlBody(t.body) ? t.body.replace(EMAIL_HTML_MARKER, '') : textToEmailHtml(t.body)
  return (
    <Modal title={`Template · ${template.name}`} onClose={onClose} width={900}
      footer={(
        <div className="flex justify-end gap-2">
          {error && <span className="text-sm text-red-600 mr-auto">{error}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" data-testid="news-template-save" onClick={() => void updateTemplate(t.id, {
            name: t.name, subject: t.subject, preheader: t.preheader, body: t.body, send_from: t.send_from,
            sender_address_id: t.send_from === 'address' ? t.sender_address_id : null,
          }).then(onSaved).catch((e: unknown) => setError(errorText(e)))}>Save</Button>
        </div>
      )}>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><input className={INPUT} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
          {t.kind === 'news' && (
            <Field label="Sent from">
              <select className={INPUT} value={t.send_from === 'address' ? `address:${t.sender_address_id}` : t.send_from}
                onChange={(e) => {
                  const v = e.target.value
                  setT(v.startsWith('address:') ? { ...t, send_from: 'address', sender_address_id: v.slice(8) } : { ...t, send_from: v as SendFrom, sender_address_id: null })
                }}>
                {(['news', 'liaison', 'reports'] as SendFrom[]).map((k) => <option key={k} value={k}>{SEND_FROM_LABELS[k]}</option>)}
                {senders.filter((s) => s.active).map((s) => <option key={s.id} value={`address:${s.id}`}>{s.display_name} · {s.address}</option>)}
              </select>
            </Field>
          )}
          <Field label="Subject"><input className={INPUT} value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} /></Field>
          <Field label="Preview line"><input className={INPUT} value={t.preheader} onChange={(e) => setT({ ...t, preheader: e.target.value })} /></Field>
        </div>
        <RichEditor value={html} onChange={(h) => setT((x) => ({ ...x, body: storeHtmlBody(h) }))} minHeight="16rem" testid="news-template-editor"
          onPicture={currentUser ? (f) => uploadEmailPicture(currentUser.id, f) : undefined}
          fields={[{ token: 'first_name', label: 'First name' }, { token: 'company', label: 'Company' }, { token: 'signature', label: 'Signature' }]} />
      </div>
    </Modal>
  )
}
