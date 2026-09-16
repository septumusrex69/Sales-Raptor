import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Building2, Check, FileUp, Loader2, Scale, User } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { pdfTokens } from '../../lib/pdfText.ts'
import {
  administrationReading, parseTrace, rankContacts, sameRegistration,
  type AdministrationReading, type TraceAddress, type TraceContact, type TraceDirector,
  type TraceEmployment, type TraceJudgment, type TraceProfile,
} from '../../lib/traceProfile.ts'
import { importTrace, type TraceTarget } from '../../lib/traceImport.ts'
import { uploadDocument } from '../../lib/accountWorkspace'
import type { AccountDirector, PractitionerKind } from '../../lib/accountStanding.ts'
import { formatDate } from '../../data/mockData'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * Uploading a trace, and saying who it is about.
 *
 * The firm's own description of the flow: "because it's a company, you can upload a trace. Then
 * the trace would ask you, is this for the company, or is this for a director? And then you would
 * choose that and upload it. And accordingly, it will store the data and the information."
 *
 * THREE STEPS, AND THE MIDDLE ONE IS THE POINT. The file is read in the browser (see pdfText),
 * the collector confirms who it is about, and then confirms what to keep. Nothing is stored until
 * the last button.
 *
 * WHY IT ASKS AT ALL WHEN IT CAN TELL. A commercial report is about a company and a consumer
 * report is about a person — the document says which on its first line, and the answer arrives
 * already chosen. But a person on a company account can be a director, a surety or the debtor's
 * spouse, and only the collector knows which. So the question is asked, with the work done.
 */
export function TraceUploadModal({
  accountId, debtorKind, registrationNumber, directors, hasPractitioner, actor,
  onClose, onDone, onAddPractitioner,
}: {
  accountId: string
  debtorKind: 'individual' | 'company'
  /** The account's own registration number, to warn when the trace is for a different company. */
  registrationNumber: string | null
  /** Who is already on the account, so a re-trace attaches to the person instead of adding them. */
  directors: AccountDirector[]
  /** Whether somebody is already recorded, so the offer to add one is not made over the top. */
  hasPractitioner: boolean
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: () => Promise<void>
  /** Hands over to the practitioner form, carrying the office the status implies. */
  onAddPractitioner: (kind: PractitionerKind | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [profile, setProfile] = useState<TraceProfile | null>(null)
  const [about, setAbout] = useState<'debtor' | 'director'>('debtor')
  const [directorId, setDirectorId] = useState<string | null>(null)
  const [keepFile, setKeepFile] = useState(true)
  /*
   * PROPOSED, TICKED, AND STILL A TICK. The firm asked for the upload to propose the rung under a
   * liquidation rather than to apply it — so this starts on, because the document is usually
   * right, and stays a thing a person can turn off, because sometimes it is not.
   */
  const [moveRung, setMoveRung] = useState(true)
  const [done, setDone] = useState<string | null>(null)
  /** Set when the PDF is on the machine but nothing could be read out of it. See fileUnread. */
  const [unreadable, setUnreadable] = useState<string | null>(null)
  /** Offered after filing, not before: the name is not on the PDF and has to be looked up. */
  const [askPractitioner, setAskPractitioner] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* What is ticked. Keyed by a stable string per row so a re-render cannot shuffle the ticks. */
  const [off, setOff] = useState<Set<string>>(new Set())
  const isOn = (key: string) => !off.has(key)
  const toggle = (key: string) => setOff((s) => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const read = useCallback(async (f: File) => {
    setError(null); setProfile(null); setDone(null); setUnreadable(null)
    setReading(true)
    try {
      const parsed = parseTrace(await pdfTokens(f))
      if (!parsed) {
        setFile(f)
        setUnreadable('That does not look like a credit bureau profile — there is no report header in it. If it is a scan or a photograph of one, the words are a picture and nothing can be read out of them.')
        return
      }
      setFile(f)
      setProfile(parsed)
      /*
       * The document's own kind chooses the answer. On an INDIVIDUAL account there is no second
       * option — the person is the debtor — so the question is not asked at all.
       */
      const guess = debtorKind === 'individual' ? 'debtor' : parsed.kind === 'commercial' ? 'debtor' : 'director'
      setAbout(guess)
      /*
       * MATCHED ON THE ID NUMBER, NEVER ON THE NAME. A bureau spells a name as the register
       * captured it, so the same person carries all three of their names on the company's profile
       * and two of them on their own — and matching on that files one person twice.
       */
      const match = parsed.idNumber
        ? directors.find((d) => d.idNumber === parsed.idNumber)
        : undefined
      setDirectorId(match?.id ?? null)
      /*
       * Everything starts ticked EXCEPT the numbers, addresses and jobs the bureau has not seen
       * recently — see rankContacts. Directors and judgments are facts about the company that do
       * not decay; a phone number from 2011 is not a phone number.
       */
      const keepContacts = new Set(rankContacts(parsed.contacts, TODAY).map((c) => `c:${c.kind}:${c.value}`))
      const drop = new Set<string>()
      for (const c of parsed.contacts) {
        const key = `c:${c.kind}:${c.value}`
        if (!keepContacts.has(key)) drop.add(key)
      }
      parsed.addresses.slice(3).forEach((a) => drop.add(`a:${a.value}`))
      parsed.employment.slice(2).forEach((e) => drop.add(`e:${e.employer}:${e.designation ?? ''}`))
      /*
       * A RESIGNED DIRECTORSHIP IS NOT TICKED BUT IT IS STORED IF YOU TICK IT.
       *
       * The firm's instruction was to mention the active ones and let the rest be a small sign
       * that they exist. One real profile carries thirty; ticked by default they would bury the
       * account under somebody's CV.
       */
      parsed.directorships.filter((c) => c.status !== 'Active').forEach((c) => drop.add(`k:${c.name}`))
      setOff(drop)
      setMoveRung(true)
    } catch (e) {
      /*
       * THE COLLECTOR IS NOT LEFT HOLDING A PDF.
       *
       * Reading it can fail for reasons that are nothing to do with them — an iPad on a Safari
       * that pdf.js cannot run on, a damaged download, a PDF that is really a scan. Whatever the
       * reason, the firm paid for that search and the document still belongs on the account, so
       * the failure offers to file it unread rather than ending the job.
       *
       * The technical detail is kept and shown small. It is no use to a collector, and it is the
       * only thing that will identify the next browser that does this.
       */
      setFile(f)
      setUnreadable('This browser could not read the PDF.')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }, [debtorKind, directors])

  /*
   * Filing it without reading it. Charges nothing, same as filing one that was read — the search
   * is charged on the Trace button where it is run.
   */
  async function fileUnread() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      await uploadDocument({ accountId, file, kind: 'Trace', uploadedBy: actor.id, uploadedByName: actor.name })
      await onDone()
      setDone('Filed under Documents. Nothing was read out of it.')
      setUnreadable(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const target: TraceTarget = useMemo(() => {
    if (about === 'debtor') return { of: 'debtor' }
    const existing = directors.find((d) => d.id === directorId)
    return {
      of: 'director',
      directorId: existing?.id ?? null,
      idNumber: existing?.idNumber ?? profile?.idNumber ?? null,
      fullName: existing?.fullName ?? profile?.subjectName ?? 'Unnamed director',
    }
  }, [about, directorId, directors, profile])

  /*
   * A WARNING THAT FIRES ONLY WHEN SOMETHING IS WRONG: a commercial report for a different
   * company than the one on the account. It happens — a collector with six tabs open uploads the
   * wrong PDF — and it is invisible afterwards, because the directors simply look unfamiliar.
   *
   * The bureau prefixes a letter to the registration number and the client's own system does not,
   * so the two are compared normalised. Compared literally this would fire on every single
   * upload, which is the same as not warning at all.
   */
  /*
   * WHAT THE STATUS LINE MEANS, where it means anything at all.
   *
   * Null for "In Business", which is nearly every profile — so nearly every upload shows no
   * proposal and costs nothing. See administrationReading.
   */
  const administration: AdministrationReading | null = about === 'debtor'
    ? administrationReading(profile?.companyStatus)
    /*
     * NOT FROM A DIRECTOR'S PROFILE. A director being under debt review says nothing about
     * whether the company can be collected from, and moving the account's rung on that basis
     * would report a solvent company to its client as under administration.
     */
    : null

  const wrongCompany = profile?.kind === 'commercial'
    && registrationNumber !== null && profile.registrationNumber !== null
    && !sameRegistration(registrationNumber, profile.registrationNumber)

  async function save() {
    if (!profile || !file) return
    setBusy(true); setError(null)
    try {
      const chosen = {
        directors: profile.directors.filter((d) => isOn(`d:${d.idNumber ?? d.fullName}`)),
        judgments: profile.judgments.filter((j) => isOn(`j:${j.caseNumber}`)),
        contacts: profile.contacts.filter((c) => isOn(`c:${c.kind}:${c.value}`)),
        addresses: profile.addresses.filter((a) => isOn(`a:${a.value}`)),
        employment: profile.employment.filter((e) => isOn(`e:${e.employer}:${e.designation ?? ''}`)),
        directorships: profile.directorships.filter((c) => isOn(`k:${c.name}`)),
        administration: administration !== null && moveRung ? administration : null,
      }
      const r = await importTrace({ accountId, profile, target, chosen, actor })
      /*
       * The PDF itself goes to Documents afterwards, and its failure does not undo the import.
       * The firm paid for the search; the facts are the thing worth keeping, and a storage bucket
       * that refuses a 4MB file should not lose them.
       */
      if (keepFile) {
        try {
          await uploadDocument({
            accountId, file, kind: 'Trace',
            uploadedBy: actor.id, uploadedByName: actor.name,
          })
        } catch { /* filed or not, the data is in. */ }
      }
      const bits = [
        r.directors > 0 ? `${r.directors} director${r.directors === 1 ? '' : 's'}` : null,
        r.directorsUpdated > 0 ? `${r.directorsUpdated} updated` : null,
        r.judgments > 0 ? `${r.judgments} judgment${r.judgments === 1 ? '' : 's'}` : null,
        r.contacts > 0 ? `${r.contacts} contact${r.contacts === 1 ? '' : 's'}` : null,
        r.directorships > 0 ? `${r.directorships} directorship${r.directorships === 1 ? '' : 's'}` : null,
        r.movedTo ? `moved to ${r.movedTo}` : null,
      ].filter(Boolean)
      setDone(bits.length ? `Filed: ${bits.join(', ')}.` : 'Filed. Nothing new to add — it was all already on the account.')
      /*
       * AND NOW THE QUESTION THE DOCUMENT CANNOT ANSWER. A profile says a company is in final
       * liquidation and never names the liquidator — checked end to end on a real report. So the
       * offer to record one is made here, once the rung has moved, and only when the account does
       * not already have somebody on file.
       */
      if (r.movedTo !== null && !hasPractitioner) setAskPractitioner(true)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Upload a trace" onClose={onClose} width={680}>
      {!profile && (
        <>
          <p className="text-sm text-slate-500">
            The PDF the bureau gives you. It is read here, in this tab &mdash; nothing is sent anywhere
            and nothing is stored until you say so.
          </p>
          <label className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-10 cursor-pointer hover:border-gold-400 hover:bg-gold-50/40">
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
            {reading
              ? <><Loader2 size={22} className="animate-spin text-slate-400" /><span className="text-sm text-slate-500">Reading it&hellip;</span></>
              : <><FileUp size={22} className="text-slate-400" /><span className="text-sm font-medium text-slate-600">Choose the trace PDF</span></>}
          </label>
          {unreadable && (
            <div className="mt-3 rounded-lg border border-gold-300 bg-gold-50 px-3 py-2.5">
              <p className="text-sm font-medium text-navy-900 inline-flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-gold-600 shrink-0" /> {unreadable}
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                You paid for the search, so the document still belongs on the account. File it and
                a collector can open it by hand.
              </p>
              <button type="button" onClick={() => void fileUnread()} disabled={busy}
                className="mt-2 text-sm font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
                File it under Documents anyway
              </button>
              {error && <p className="text-[11px] text-slate-400 mt-2 break-words">{error}</p>}
            </div>
          )}
          {done && <p className="text-sm text-[var(--c-green)] mt-3 inline-flex items-center gap-1.5"><Check size={14} /> {done}</p>}
          {error && !unreadable && <p className="text-sm text-negative-700 mt-3">{error}</p>}
        </>
      )}

      {profile && (
        <div className="space-y-4">
          {/* ---------- what it is ---------- */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-sm font-semibold text-navy-900">
              {profile.subjectName ?? 'Unnamed'}
              <span className="ml-2 text-[11px] font-medium text-slate-500">
                {profile.kind === 'commercial' ? 'Company profile' : 'Consumer profile'}
              </span>
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {[
                profile.registrationNumber, profile.idNumber,
                profile.companyStatus,
                profile.contactScore ? `Contact score ${profile.contactScore}` : null,
                profile.riskScore,
                profile.enquiredOn ? `pulled ${formatDate(profile.enquiredOn)}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>

          {wrongCompany && (
            <div className="rounded-lg border border-gold-300 bg-gold-50 px-3 py-2">
              <p className="text-xs font-medium text-navy-900 inline-flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-gold-600 shrink-0" /> This profile is for a different company
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                The account is {registrationNumber}; the profile is {profile.registrationNumber}. Check you
                have the right PDF before you file it.
              </p>
            </div>
          )}

          {/*
            THE PROPOSAL. Under a liquidation the profile is saying the debt is still owed and the
            company can no longer be collected from — the claim goes to an estate instead. That is
            the single most consequential line on a commercial profile, and until now it was read
            out and then thrown away.

            Proposed, not applied: it changes what the client is told about this account, and the
            person filing it is the one who can say whether the PDF is the right one.
          */}
          {administration !== null && (
            <div className="rounded-xl border border-gold-300 bg-gold-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-navy-900 inline-flex items-center gap-1.5">
                <Scale size={14} className="text-gold-600 shrink-0" />
                This company is in {administration.status.toLowerCase()}
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                The debt is still owed, but it can no longer be collected from the company &mdash; the
                claim goes to the estate.
              </p>
              <label className="flex items-start gap-2 mt-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={moveRung} onChange={(e) => setMoveRung(e.target.checked)}
                  className="mt-1 accent-[var(--c-gold-dark)] shrink-0" />
                <span>
                  Put the account on <strong>{administration.subStatus}</strong>
                  <span className="block text-[11px] text-slate-500">
                    It will report to the client as Under administration.
                    {administration.practitionerKind && !hasPractitioner
                      && ' You will be asked for the ' + (administration.practitionerKind === 'business_rescue'
                        ? 'business rescue practitioner' : administration.practitionerKind) + ' afterwards.'}
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* ---------- who it is about ---------- */}
          {debtorKind === 'company' && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Who is this trace for?</p>
              <div className="grid grid-cols-2 gap-2">
                <Choice icon={<Building2 size={15} />} label="The company"
                  hint="Directors and judgments go on the account"
                  on={about === 'debtor'} onClick={() => setAbout('debtor')} />
                <Choice icon={<User size={15} />} label="A director"
                  hint="Their numbers are filed under their name"
                  on={about === 'director'} onClick={() => setAbout('director')} />
              </div>
              {about === 'director' && (
                <select value={directorId ?? ''} onChange={(e) => setDirectorId(e.target.value || null)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                  <option value="">
                    {profile.subjectName ?? 'This person'}{profile.idNumber ? ` · ${profile.idNumber}` : ''} — not on the account yet
                  </option>
                  {directors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}{d.status ? ` · ${d.status}` : ''}{d.tracedAt ? ' · already traced' : ''}
                    </option>
                  ))}
                </select>
              )}
              {about === 'director' && directorId === null && profile.kind === 'commercial' && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  This is a company profile. Filing it against a person will store the company&rsquo;s
                  directors and judgments under their name.
                </p>
              )}
            </div>
          )}

          {/* ---------- what it found ---------- */}
          {/*
            ACTIVE FIRST, as everywhere else. The bureau prints them in the order the register was
            captured, which on one real profile puts four resigned directors above the two people
            worth ringing -- and this list scrolls, so those two start off the bottom of it.
          */}
          <Found title="Directors" count={profile.directors.length}>
            {[...profile.directors].sort((x, y) => {
              const xa = x.status === 'Active', ya = y.status === 'Active'
              if (xa !== ya) return xa ? -1 : 1
              return x.fullName.localeCompare(y.fullName)
            }).map((d: TraceDirector) => {
              const key = `d:${d.idNumber ?? d.fullName}`
              return (
                <Row key={key} on={isOn(key)} onToggle={() => toggle(key)}
                  main={d.fullName}
                  side={d.status ?? 'Status unknown'}
                  note={[d.idNumber, d.appointedOn ? `appointed ${formatDate(d.appointedOn)}` : null].filter(Boolean).join(' · ')} />
              )
            })}
          </Found>

          <Found title={about === 'director' ? 'Judgments against this person' : 'Judgments'} count={profile.judgments.length}>
            {profile.judgments.map((j: TraceJudgment) => {
              const key = `j:${j.caseNumber}`
              /*
                A ROW WHOSE COLUMNS COULD NOT BE SPLIT IS STILL OFFERED, in the bureau's own words.
                It used to be shown and then dropped, which threw away the part a collector most
                wants — who sued. The firm's view was plain: "the plaintiff is important to mention
                as well, it's not a lot of data."
                What is NOT done is guessing: the case type, the reason and the plaintiff stay
                empty, and the line says it is quoting rather than reporting.
              */
              return (
                <Row key={key} on={isOn(key)} onToggle={() => toggle(key)}
                  main={j.plaintiff ?? (j.unread !== null ? `As printed: “${j.unread}”` : 'Plaintiff not named')}
                  side={j.filedOn ? formatDate(j.filedOn) : '—'}
                  note={[
                    j.caseReason, j.caseType, `case ${j.caseNumber}`,
                    j.unread !== null ? 'columns could not be read — kept as printed' : null,
                  ].filter(Boolean).join(' · ')} />
              )
            })}
          </Found>

          <Found title="Numbers and email" count={profile.contacts.length}>
            {profile.contacts.map((c: TraceContact) => {
              const key = `c:${c.kind}:${c.value}`
              return (
                <Row key={key} on={isOn(key)} onToggle={() => toggle(key)}
                  main={c.value}
                  side={c.kind === 'mobile' ? 'Mobile' : c.kind === 'work' ? 'Work' : c.kind === 'email' ? 'Email' : 'Home'}
                  note={[
                    c.updatedOn ? `last seen ${formatDate(c.updatedOn)}` : 'never dated',
                    /* The number a bureau holds against ten people is not this debtor's phone. */
                    c.peopleLinked !== null && c.peopleLinked > 1 ? `linked to ${c.peopleLinked} people` : null,
                  ].filter(Boolean).join(' · ')} />
              )
            })}
          </Found>

          <Found title="Addresses" count={profile.addresses.length}>
            {profile.addresses.map((a: TraceAddress) => {
              const key = `a:${a.value}`
              return (
                <Row key={key} on={isOn(key)} onToggle={() => toggle(key)}
                  main={a.value} side={a.province ?? ''}
                  note={a.updatedOn ? `last seen ${formatDate(a.updatedOn)}` : 'never dated'} />
              )
            })}
          </Found>

          <Found title="Employment" count={profile.employment.length}>
            {profile.employment.map((e: TraceEmployment) => {
              const key = `e:${e.employer}:${e.designation ?? ''}`
              return (
                <Row key={key} on={isOn(key)} onToggle={() => toggle(key)}
                  main={e.employer} side={e.designation ?? ''}
                  note={e.updatedOn ? `last seen ${formatDate(e.updatedOn)}` : 'never dated'} />
              )
            })}
          </Found>

          {/*
            THE OTHER COMPANIES THEY SIT ON, at the firm's instruction: "We could mention the
            active directorships. But if there are other directorships where he's not active,
            there can be a little sign that says there are other directors that he's not active
            anymore."

            So the active ones are ticked and the resigned ones are not — they are still here to
            be ticked by anyone who wants them, but they do not arrive as thirty rows of somebody's
            CV. Only stored against a person: a directorship belongs to the director, not to the
            account.
          */}
          {about === 'director' && (
            <Found title="Other companies they direct" count={profile.directorships.length}>
              {[...profile.directorships].sort((x, y) => {
                const xa = x.status === 'Active', ya = y.status === 'Active'
                if (xa !== ya) return xa ? -1 : 1
                return (y.appointedOn ?? '').localeCompare(x.appointedOn ?? '')
              }).map((c) => {
                const key = `k:${c.name}`
                return (
                  <Row key={key} on={isOn(key)} onToggle={() => toggle(key)}
                    main={c.name}
                    side={c.status ?? ''}
                    note={c.appointedOn ? `appointed ${formatDate(c.appointedOn)}` : ''} />
                )
              })}
            </Found>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={keepFile} onChange={(e) => setKeepFile(e.target.checked)}
              className="accent-[var(--c-gold-dark)]" />
            Keep the PDF on the account under Documents
          </label>

          {error && <p className="text-sm text-negative-700">{error}</p>}
          {done && <p className="text-sm text-[var(--c-green)] inline-flex items-center gap-1.5"><Check size={14} /> {done}</p>}

          {/*
            THE ONE THING THE DOCUMENT CANNOT TELL YOU. A profile that says "Final Liquidation"
            does not name the liquidator — that is published in the Gazette and held by the
            Master's office, and somebody has to go and look. Offered here rather than left as a
            task, because this is the moment it is obvious that it is missing.
          */}
          {askPractitioner && (
            <div className="rounded-lg border border-gold-300 bg-gold-50 px-3 py-2.5">
              <p className="text-xs font-medium text-navy-900">Nobody is recorded to claim from</p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                The trace does not carry the appointment &mdash; it is not on a bureau profile. Add
                whoever was appointed, or leave it and the account will keep saying it is missing.
              </p>
              <button type="button"
                onClick={() => { setAskPractitioner(false); onClose(); onAddPractitioner(administration?.practitionerKind ?? null) }}
                className="mt-2 text-sm font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
                Add the practitioner
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
            <button type="button" onClick={onClose} disabled={busy}
              className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              {done ? 'Close' : 'Cancel'}
            </button>
            {!done && (
              <button type="button" onClick={() => void save()} disabled={busy}
                className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
                File what is ticked
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Filing a trace charges nothing. The search itself is Annexure B item 4(c) and is charged
            on the Trace button, where it is run.
          </p>
        </div>
      )}
    </Modal>
  )
}

function Choice({ icon, label, hint, on, onClick }: {
  icon: React.ReactNode; label: string; hint: string; on: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left rounded-xl border px-3 py-2.5 ${
        on ? 'border-gold-500 bg-gold-50' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-900">{icon}{label}</span>
      <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>
    </button>
  )
}

/** A block of findings, absent entirely when the report has none of that kind. */
function Found({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">{title} <span className="text-slate-300">({count})</span></p>
      {/*
        Scrolls at about six rows. One real profile carries twenty-six numbers and eleven
        addresses; shown in full the buttons at the bottom of this modal are off the screen and
        the collector cannot file anything without scrolling past all of it.
      */}
      <div className="max-h-44 overflow-y-auto pr-1 divide-y divide-slate-50">{children}</div>
    </div>
  )
}

function Row({ on, onToggle, main, side, note }: {
  on: boolean; onToggle: () => void; main: string; side: string; note: string
}) {
  return (
    <label className="flex items-start gap-2 py-1.5 cursor-pointer">
      <input type="checkbox" checked={on} onChange={onToggle} className="mt-1 accent-[var(--c-gold-dark)] shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className={`text-sm ${on ? 'text-slate-800' : 'text-slate-400'} break-words min-w-0`}>{main}</span>
          {side && <span className="text-[11px] text-slate-500 shrink-0">{side}</span>}
        </span>
        {note && <span className="block text-[11px] text-slate-400">{note}</span>}
      </span>
    </label>
  )
}
