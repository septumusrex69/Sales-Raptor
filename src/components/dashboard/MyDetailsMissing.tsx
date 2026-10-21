import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PhoneOff } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { fetchFirmSettings } from '../../lib/firmSettings'

/**
 * "YOU ARE MISSING YOUR PHONE NUMBER" — said to the one person who can fix it.
 *
 * THE FIRM, TOLD THAT NOT ONE OF THE FIFTY LIVE PROFILES CARRIES A NUMBER: "if someone doesn't
 * have a phone number entered, it should be on their dashboard as a warning. Like you're missing
 * data... but then what it should do is it should give the company's default details as contact,
 * for example, Peter on 012 348 2156."
 *
 * SO IT IS TWO HALVES AND BOTH ARE HERE. The notice still goes out — {{collector_phone}} is an
 * optional field now and its line drops, leaving the firm's number on the line below, which is
 * what every one of the fifteen templates that quote the direct line also quotes. And the person
 * is told, once, on the screen they land on, because the fallback is correct and their own number
 * is better.
 *
 * IT SAYS WHICH NUMBER IS GOING OUT INSTEAD, by name, which is why it asks the firm's settings
 * for it rather than saying "the firm's number" in the abstract. A warning a debtor's experience
 * depends on should be readable as a fact about today.
 *
 * AND IT IS ABSENT WHERE NOTHING IS WRONG. CLAUDE.md on the house style: a warning that fires
 * when nothing is wrong is worse than no warning, because people stop reading it. A person with
 * a phone number and no WhatsApp sees only the WhatsApp half; a person with both sees nothing at
 * all, and the dashboard is one card shorter.
 */
export function MyDetailsMissing() {
  const { currentUser } = useAuth()
  const [firmPhone, setFirmPhone] = useState<string | null>(null)

  const missingPhone = !(currentUser?.phone ?? '').trim()
  const missingWhatsapp = !(currentUser?.whatsapp ?? '').trim()
  const anything = Boolean(currentUser) && (missingPhone || missingWhatsapp)

  /* Asked for ONLY where there is something to say -- the landing screen already makes one
     round trip for the book, and a second one to fill in a card nobody is going to see is a
     cost paid by every person who has their details in order. */
  useEffect(() => {
    if (!missingPhone) return
    let cancelled = false
    void fetchFirmSettings()
      .then((f) => { if (!cancelled) setFirmPhone((f.phone ?? '').trim() || null) })
      /* A warning that cannot name the fallback is still a warning worth showing. */
      .catch(() => { if (!cancelled) setFirmPhone(null) })
    return () => { cancelled = true }
  }, [missingPhone])

  if (!anything) return null

  return (
    <div className="card border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <PhoneOff size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {missingPhone && missingWhatsapp
              ? 'Raptor has no phone or WhatsApp number for you'
              : missingPhone ? 'Raptor has no phone number for you' : 'Raptor has no WhatsApp number for you'}
          </p>
          {missingPhone && (
            <p className="mt-1 text-sm text-amber-800">
              Notices on your accounts leave your direct line off and give
              {' '}
              {firmPhone
                ? <span className="font-medium">the office on {firmPhone}</span>
                : <span className="font-medium">the firm's own number</span>}
              {' '}instead, so nothing is held up. A debtor who rings it reaches reception rather
              than you.
            </p>
          )}
          {missingWhatsapp && (
            <p className="mt-1 text-sm text-amber-800">
              {missingPhone ? 'Your WhatsApp number is missing too, so that line' : 'Your WhatsApp number is missing, so that line'}
              {' '}is left off a notice altogether. Add it only if it differs from your phone number.
            </p>
          )}
          <Link to="/settings?tab=Profile"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700">
            Add it on your profile <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}
