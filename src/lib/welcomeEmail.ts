/**
 * THE WELCOME EMAIL A NEW CLIENT GETS FROM ITS LIAISON (S8, 18 Oct).
 *
 * The firm: "it sends an automatic email to the client like, hi, my name is Bonita ... welcome to
 * Bredell Ferreira ... a nice picture at the top ... the contact details." Sent by the welcome route
 * the moment Sales assigns the liaison (api/_lib/email/welcome.ts), from the liaison's own mailbox,
 * so the client's first reply lands with the person who will look after them.
 *
 * Pure, so check-welcome can read the words. The liaison's signature block is added by sendAsUser
 * like every other email they send; the details here are said in the body as well, because a
 * signature is optional and a welcome that does not say how to reach anybody has missed its point.
 *
 * WHAT IT DOES NOT SAY: no commission, no fee, no terms -- the client has just signed those and has
 * a signed copy; a welcome that restates them invites a second negotiation. And no promise of a
 * result: a collections firm does not tell a new client what it will recover.
 */
import { emailBodyHtml } from './emailStyle.js'

export interface WelcomeInput {
  clientName: string
  /** The person at the client the email is addressed to; null for "Good day". */
  contactName: string | null
  liaison: { name: string; email: string | null; phone: string | null; whatsapp: string | null }
  /** The closer who signed them, named so the client knows the hand-over is deliberate. */
  closerName: string | null
  /** Absolute URL of the banner (public/brand/email/welcome.jpg on the deployed site). */
  bannerUrl: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function welcomeEmail(w: WelcomeInput): { subject: string; text: string; html: string } {
  const first = w.liaison.name.split(' ')[0]
  const greeting = w.contactName ? `Dear ${w.contactName.split(' ')[0]}` : 'Good day'
  const reach = [
    w.liaison.phone ? `Phone: ${w.liaison.phone}` : null,
    w.liaison.whatsapp && w.liaison.whatsapp !== w.liaison.phone ? `WhatsApp: ${w.liaison.whatsapp}` : null,
    w.liaison.email ? `Email: ${w.liaison.email}` : null,
  ].filter(Boolean) as string[]
  const text = `${greeting}\n\n`
    + `Welcome to Bredell Ferreira, and thank you for trusting us with ${w.clientName}'s collections.\n\n`
    + `My name is ${w.liaison.name} and I will be your client liaison${w.closerName ? `, taking over from ${w.closerName.split(' ')[0]} now that the agreement is signed` : ''}. `
    + `I am your first point of contact for anything to do with your accounts: sending us new handovers, questions about a debtor, payments and our reports to you.\n\n`
    + `I will give you a call shortly to introduce myself and to talk through how you would like to send us your first handover.\n\n`
    + (reach.length ? `You can reach me directly:\n${reach.join('\n')}\n\n` : '')
    + `We look forward to working with you.\n\n`
    + `Kind regards\n${first}`
  const banner = `<div style="margin:0 0 18px 0"><img src="${esc(w.bannerUrl)}" alt="Welcome to Bredell Ferreira" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:6px" /></div>`
  return { subject: `Welcome to Bredell Ferreira - ${w.clientName}`, text, html: banner + emailBodyHtml(text) }
}
