import handler from '../_lib/portal.js'

/**
 * THE CLIENT PORTAL (S14, Raptor H13): its own function rather than another action on api/email, because
 * it is a different kind of caller -- a client, never staff -- and keeping its door separate keeps its
 * rules in one file (api/_lib/portal.ts). The Pro plan lifts the 12-function cap; this is the eighth.
 */
export default handler
