import handler from '../_lib/debtorPortal.js'

/**
 * THE DEBTOR PORTAL (Raptor H16): its own function, apart from the client portal's, because it is a different kind
 * of caller -- a debtor, signed in by their case number -- and keeping the door separate keeps its rules in one
 * file (api/_lib/debtorPortal.ts). The Pro plan lifts the 12-function cap.
 */
export default handler
