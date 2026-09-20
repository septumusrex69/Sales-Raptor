import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary } from '../../lib/permissions'
import {
  EMAIL_FONTS, emailBodyStyle, fetchFirmSettings, saveFirmSettings, type FirmSettings,
} from '../../lib/firmSettings'

/**
 * THE FIRM'S OWN DETAILS.
 *
 * At the firm's question: "where are we going to store all the data, for example, the firm's
 * data, like bank account details, and that stuff." Here — beside the letterhead, for the same
 * reason the letterhead is not in Settings: this is content the firm maintains, not a switch
 * somebody flicks once, and it is what prints on the paper next door.
 *
 * WHAT EACH BOX ACTUALLY DOES IS SAID ON THE SCREEN, not left to be inferred from its label. The
 * trust account in particular: a firm has more than one bank account, and the one a DEBTOR pays
 * into is not the one a CLIENT is remitted from. Getting those the wrong way round puts a
 * debtor's money in a client's account and nobody finds out until month end, so the screen says
 * which one it is asking for.
 */
export function FirmSettingsPage() {
  const { currentUser } = useAuth()
  const mayEdit = canEditLibrary(currentUser?.role)
  const [row, setRow] = useState<FirmSettings | null>(null)
  const [draft, setDraft] = useState<FirmSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const s = await fetchFirmSettings()
    setRow(s)
    setDraft(s)
  }, [])
  useEffect(() => { void load() }, [load])

  if (!draft || !row) {
    return <Card><p className="text-sm text-slate-500">Reading the firm&rsquo;s details&hellip;</p></Card>
  }

  const set = <K extends keyof FirmSettings>(k: K, v: FirmSettings[K]) => {
    setDraft({ ...draft, [k]: v })
    setSaved(false)
  }
  const changed = JSON.stringify({ ...draft, updatedAt: '' }) !== JSON.stringify({ ...row, updatedAt: '' })

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await saveFirmSettings(draft)
      await load()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /* Every field: the column, what it is called on screen, and the sentence that says what it is
     for. Written as data so the three sections read the same and none of them quietly loses its
     explanation. */
  const text = (k: 'firmName' | 'trustBank' | 'trustAccountNumber' | 'signatoryName' | 'signatoryTitle',
    label: string, help: string, placeholder: string) => (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">{label}</span>
      <input className={inputClass} disabled={!mayEdit} placeholder={placeholder}
        value={(draft[k] as string | null) ?? ''}
        onChange={(e) => set(k, (e.target.value || null) as FirmSettings[typeof k])} />
      <span className="block text-[11px] text-slate-400 mt-1">{help}</span>
    </label>
  )

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-sm font-semibold text-navy-950">The firm</h3>
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          What a letter says about us. These fill the merge fields a notice needs and an SMS never
          did &mdash; the trust account, who signs, and the firm&rsquo;s own name.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('firmName', 'The firm', 'Printed wherever a template says {{firm_name}}.',
            'Bredell Ferreira')}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-navy-950">Where a debtor pays</h3>
        {/*
          SAID PLAINLY, because this is the one pair of boxes on the screen that costs money to
          get wrong. companies.banking_details is the OTHER direction — where a client is remitted
          — and the two are never the same account.
        */}
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          The firm&rsquo;s <strong>trust account</strong>, as it is printed at the foot of a
          section 129. This is money coming <em>in</em> from a debtor. It is not the account a
          client is remitted from &mdash; that one lives on the client, not here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('trustBank', 'Bank and branch code',
            'Written the way it should read on the page. Fills {{firm_bank}}.',
            'Standard Bank · 051001')}
          {text('trustAccountNumber', 'Account number',
            'Fills {{firm_bank_account}}.', '01 234 5678')}
        </div>
        {/*
          A WARNING THAT ONLY FIRES WHEN SOMETHING IS WRONG. CLAUDE.md: one that fires when
          nothing is wrong is worse than none, because people stop reading it.
        */}
        {(row.trustBank === null || row.trustAccountNumber === null) && (
          <p className="text-xs text-negative-700 mt-3">
            Until both of these are filled in, a section 129 prints &#123;&#123;firm_bank&#125;&#125;
            where the account should be &mdash; deliberately, so it is caught here rather than posted.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-navy-950">Who signs</h3>
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          The name and capacity under the signature line on a statutory demand.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('signatoryName', 'Name', 'Fills {{signatory_name}}.', 'J Bredell')}
          {text('signatoryTitle', 'Capacity', 'Fills {{signatory_title}}.',
            'Duly authorised legal representative')}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-navy-950">The font emails are sent in</h3>
        {/*
          THE FIRM ASKED WHICH FONT GOES INTO EMAILS. Until this existed the answer was none: the
          body and the signature were concatenated and sent as raw HTML with no wrapper, so every
          reader's mail client picked its own — Gmail Arial, Outlook Calibri, Apple Mail
          Helvetica. Their letters are Georgia and their emails were whatever the reader ran.
        */}
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          Applied to every message the firm sends. The list is short on purpose: a mail client
          cannot fetch a font, so anything the reader does not already have installed silently
          becomes Times New Roman.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Typeface</span>
            <select className={inputClass} disabled={!mayEdit} value={draft.emailFont}
              onChange={(e) => set('emailFont', e.target.value)}>
              {EMAIL_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Size</span>
            <select className={inputClass} disabled={!mayEdit} value={draft.emailSizePt}
              onChange={(e) => set('emailSizePt', Number(e.target.value))}>
              {[9, 10, 10.5, 11, 12, 13].map((n) => <option key={n} value={n}>{n} pt</option>)}
            </select>
          </label>
        </div>
        {/* Shown in the face itself, because a font named is a font nobody can picture. */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
            How a message will read
          </p>
          <div style={{ ...styleObject(emailBodyStyle(draft)) }}>
            Dear Mr Van Der Westhuizen,<br /><br />
            The balance outstanding on account GPS3/10103 is R&nbsp;48&nbsp;250.00. Please telephone
            this office to make an arrangement.
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-negative-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="button" disabled={!mayEdit || !changed || busy} onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm
            font-medium text-white disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />}
          Save
        </button>
        {saved && !changed && <span className="text-sm text-slate-500">Saved.</span>}
        {!mayEdit && <span className="text-sm text-slate-400">An administrator writes these.</span>}
      </div>
    </div>
  )
}

/**
 * The CSS string that goes out in the mail, as a React style object for the preview.
 *
 * ONE SOURCE, DELIBERATELY. Writing the preview's styles by hand would mean the sample on this
 * screen and the message that actually leaves could drift, and the whole reason the sample is
 * here is to answer "what will this look like".
 */
function styleObject(css: string): React.CSSProperties {
  const out: Record<string, string> = {}
  for (const rule of css.split(';')) {
    const at = rule.indexOf(':')
    if (at === -1) continue
    const prop = rule.slice(0, at).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    out[prop] = rule.slice(at + 1).trim()
  }
  return out as React.CSSProperties
}
