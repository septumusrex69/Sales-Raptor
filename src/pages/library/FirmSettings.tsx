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
 * The keys that hold a line of text somebody types, derived rather than listed.
 *
 * `null extends FirmSettings[K]` is what does the work: it keeps every nullable string and drops
 * `emailFont` and `updatedAt`, which are a select and a timestamp, and `firmName`, which is the
 * one box that may not be emptied to null. A hand-kept union went stale the moment the firm asked
 * for more fields; this cannot.
 */
type TextKey = {
  [K in keyof FirmSettings]: FirmSettings[K] extends string | null
    ? (null extends FirmSettings[K] ? K : never)
    : never
}[keyof FirmSettings]

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
  /* Read off what is SAVED, not what is being typed: the warning describes the state a notice
     would be posted in, and a half-typed box is neither. */
  const trustGaps = missingTrust(row)

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
     for. Written as data so the sections read the same and none of them quietly loses its
     explanation.

     TYPED AGAINST THE KEYS THAT HOLD TEXT, rather than a hand-kept union of the five that existed
     when this was written. The union went stale the moment the firm asked for more fields, and a
     stale one fails as a type error on the field you just added -- which is survivable -- or, if
     somebody widens it to `keyof FirmSettings`, as a box that writes a string into emailSizePt. */
  const text = (k: TextKey, label: string, help: string, placeholder: string) => (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">{label}</span>
      <input className={inputClass} disabled={!mayEdit} placeholder={placeholder}
        value={draft[k] ?? ''}
        onChange={(e) => set(k, (e.target.value || null) as FirmSettings[typeof k])} />
      <span className="block text-[11px] text-slate-400 mt-1">{help}</span>
    </label>
  )

  /*
   * The firm's name, which is the one box that may NOT go null.
   *
   * saveFirmSettings falls back to the firm's own name on a blank and does it with `.trim()` --
   * so a null, which is what the nullable helper writes when somebody clears a box, threw there
   * rather than falling back. Kept as '' while it is being retyped; the fallback does the rest.
   */
  const requiredText = (label: string, help: string, placeholder: string) => (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">{label}</span>
      <input className={inputClass} disabled={!mayEdit} placeholder={placeholder}
        value={draft.firmName}
        onChange={(e) => set('firmName', e.target.value)} />
      <span className="block text-[11px] text-slate-400 mt-1">{help}</span>
    </label>
  )

  /* An address is written on its own lines and merged as typed, so it is typed on its own lines
     too. Flattening it to one box prints a street and a city in a single run. */
  const lines = (k: TextKey, label: string, help: string, placeholder: string) => (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">{label}</span>
      <textarea className={`${inputClass} min-h-[5.5rem]`} disabled={!mayEdit} rows={3}
        placeholder={placeholder} value={draft[k] ?? ''}
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
          did.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {requiredText('The firm', 'Printed wherever a template says {{firm_name}}.',
            'Bredell Ferreira')}
        </div>
        {/*
          NOTHING READS THESE THREE. They are printed and nothing else — no validation, no lookup,
          no behaviour hangs off them. They are here because a letterhead and an invoice carry them
          and the firm was retyping them into every template that needed one.
        */}
        <div className="grid gap-4 sm:grid-cols-3 mt-4">
          {text('registrationNumber', 'Registration number',
            'Company or CK number, if the firm shows one.', '2014/123456/21')}
          {text('vatNumber', 'VAT number', 'Shown on what the firm invoices.', '4123456789')}
          {text('councilNumber', 'Council for Debt Collectors',
            'Where the firm shows its registration on correspondence.', 'Reg. 0001234/56')}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-navy-950">How to reach the firm</h3>
        {/*
          THE OFFICE, WHICH IS NOT THE COLLECTOR. {{agent_phone}} is whoever is dealing with the
          account and it changes the day the account is handed out. "Please telephone this office"
          needed a number that does not, and until now Raptor held none.
        */}
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          The switchboard, not the collector. A letter that says &ldquo;telephone this
          office&rdquo; means these, wherever the account goes next.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('phone', 'Telephone', 'Fills {{firm_phone}}.', '015 291 1234')}
          {text('phoneAlt', 'Second number', 'Not merged on its own \u2014 kept here so it is in one place.',
            '015 291 5678')}
          {text('email', 'Email address', 'Fills {{firm_email}}.', 'info@bredellferreira.co.za')}
          {lines('physicalAddress', 'Physical address',
            'Fills {{firm_address}}, on the lines you type it in.',
            '25 Kerk Street\nPolokwane\n0699')}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-navy-950">Where a debtor pays</h3>
        {/*
          SAID PLAINLY, because these are the boxes on the screen that cost money to get wrong.
          THREE DIRECTIONS OF MONEY: a debtor pays IN here; a client pays the firm IN to the
          business account below; a client is remitted OUT from companies.banking_details, which
          is not on this screen at all. No two of them are the same account.
        */}
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          The firm&rsquo;s <strong>trust account</strong>, as it is printed at the foot of a
          section 129. This is money coming <em>in</em> from a debtor. It is not the account a
          client is remitted from &mdash; that one lives on the client, not here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('trustBank', 'Bank', 'Fills {{firm_bank_name}}.', 'Standard Bank')}
          {/* Apart from the bank at the firm's own correction: a branch code is a separate thing
              a person copies into a separate box in a banking app. */}
          {text('trustBranchCode', 'Branch code',
            'Fills {{firm_bank_branch}}. {{firm_bank}} still prints both together.', '051001')}
          {text('trustAccountName', 'Account name',
            'The name the payment must reach. Fills {{firm_bank_holder}}.',
            'Bredell Ferreira Trust')}
          {text('trustAccountNumber', 'Account number',
            'Fills {{firm_bank_account}}.', '01 234 5678')}
        </div>
        {/*
          A WARNING THAT ONLY FIRES WHEN SOMETHING IS WRONG, and that NAMES what is missing rather
          than saying something is. CLAUDE.md: one that fires when nothing is wrong is worse than
          none, because people stop reading it — and one that fires without saying what to do
          about it is read once and then skipped.
        */}
        {trustGaps.length > 0 && (
          <p className="text-xs text-negative-700 mt-3">
            A section 129 cannot be posted without {trustGaps.join(', ')}. Until
            {' '}{trustGaps.length === 1 ? 'it is' : 'they are'} filled in, the notice
            prints the merge field standing on the page &mdash; deliberately, so it is caught here
            rather than posted.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-navy-950">Where a client pays the firm</h3>
        {/*
          THE FIRM'S OWN WORDS: "there's also an account that is still outstanding with our
          client." That is commission owed TO the firm, and it is paid into the business account —
          never the trust account above.

          NO DEBTOR NOTICE CAN NAME THIS. These merge fields exist only in the sales vocabulary,
          and templateProblems refuses a field that is not in the template's scope, so a section
          129 asking for {{firm_business_bank}} does not save. That is the protection: a debtor
          paying into the business account is trust money in the wrong place, found at month end.
        */}
        <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
          The firm&rsquo;s <strong>business account</strong>, for what a client still owes us.
          Offered to templates on the sales side only &mdash; a debtor notice has no field that
          can name it, on purpose.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('businessBank', 'Bank', 'Fills {{firm_business_bank_name}}.', 'Standard Bank')}
          {text('businessBranchCode', 'Branch code', 'Fills {{firm_business_bank_branch}}.',
            '051001')}
          {text('businessAccountName', 'Account name',
            'Fills {{firm_business_bank_holder}}.', 'Bredell Ferreira')}
          {text('businessAccountNumber', 'Account number',
            'Fills {{firm_business_bank_account}}.', '02 345 6789')}
        </div>
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

/**
 * What the trust account is still short of, in the firm's own words rather than column names.
 *
 * THE ACCOUNT NAME IS IN THE LIST because an EFT without it reaches the right number under the
 * wrong name and the receiving bank may send it back — which looks, from the debtor's side, like
 * the firm refusing their payment. The branch code is in it because a debtor has to type it into
 * a separate box; a notice naming the bank and not the code is a telephone call, not a payment.
 *
 * Returns [] when nothing is missing, and the screen shows nothing at all then.
 */
function missingTrust(s: FirmSettings): string[] {
  const gaps: string[] = []
  if (s.trustBank === null) gaps.push('the bank')
  if (s.trustBranchCode === null) gaps.push('the branch code')
  if (s.trustAccountName === null) gaps.push('the account name')
  if (s.trustAccountNumber === null) gaps.push('the account number')
  return gaps
}
