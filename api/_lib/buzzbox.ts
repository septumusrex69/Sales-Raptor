/**
 * Thin client for the BuzzBox Cloud "Conductor" REST API (the PABX side of BuzzBox).
 *
 * The API is documented as Swagger UI at https://buzzboxcloud.co.za/buzzbox-conductor/docs/
 * with the OpenAPI spec at https://buzzboxcloud.co.za/openapi. Every route under
 * `/rest/v1/...` in that spec is served from the `/buzzbox-conductor` prefix in production
 * (probed: POST /buzzbox-conductor/rest/v1/login answers a structured 401; the bare
 * /rest/v1/login is the WordPress site's 404 page).
 *
 * What this module wraps:
 *   POST /rest/v1/login                                     -> a JWT (header name + value)
 *   GET  /rest/v1/pabx-organisations                         -> which organisation the login sees
 *   GET  /rest/v1/pabx-organisations/{id}/pabx-contacts      -> the organisation's extensions
 *   POST /rest/v1/pabx-organisations/{id}/calls              -> click to dial
 *
 * Only ever used by server-side routes under api/buzzbox/ — the BuzzBox password lives
 * encrypted in Postgres and never reaches the browser.
 */

export const BUZZBOX_BASE_URL = (process.env.BUZZBOX_BASE_URL ?? 'https://buzzboxcloud.co.za/buzzbox-conductor').replace(/\/+$/, '')

/** Shape of every BuzzBox error body: an array of ExceptionData. */
interface ExceptionData {
  code?: string
  description?: string
  severity?: string
  type?: string
  traceId?: string
}

export interface BuzzBoxJwt {
  headerName: string
  headerValue: string
  expiresEpochSecs?: number
  expires?: string
  tenantId?: number
  roles?: string[]
}

export interface PabxOrganisation {
  organisationId: number
  name?: string
  hostName?: string
  sipDomain?: string
}

export interface PabxContact {
  extension?: number
  name?: string
  email?: string
  uuid?: string
  userId?: number
  organisationId?: number
  outboundCallerIdNumber?: string
}

export interface CallSetup {
  from: string
  to: string
  reference?: string
  webhookUrl?: string
}

export class BuzzBoxError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'BuzzBoxError'
    this.status = status
    this.code = code
  }
}

async function readError(res: Response, fallback: string): Promise<BuzzBoxError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Not JSON (e.g. an HTML error page from the front proxy) — fall through to the generic message.
  }
  const first = Array.isArray(body) ? (body[0] as ExceptionData | undefined) : undefined
  return new BuzzBoxError(res.status, first?.description ?? fallback, first?.code)
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

/**
 * Exchange a BuzzBox identity + password for a JWT.
 *
 * The spec says the token tells you which header to send it in (`headerName`) and when it
 * expires — "best practice is to store the expiry date and renew before the token expires",
 * which is what {@link getToken} does.
 */
export async function login(identity: string, password: string): Promise<BuzzBoxJwt> {
  const res = await fetch(`${BUZZBOX_BASE_URL}/rest/v1/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ identity, password }),
  })
  if (!res.ok) throw await readError(res, res.status === 401 ? 'BuzzBox rejected that identity/password.' : `BuzzBox login failed (HTTP ${res.status}).`)
  const jwt = (await res.json()) as BuzzBoxJwt
  if (!jwt.headerName || !jwt.headerValue) throw new BuzzBoxError(502, 'BuzzBox login succeeded but returned no token.')
  return jwt
}

/**
 * Per-instance token cache keyed by identity. A Vercel function instance stays warm between
 * invocations, so a rep placing three calls in a row logs in once, not three times. Renewed
 * a minute before BuzzBox says it expires rather than on a 401, per the API's own advice.
 */
const tokenCache = new Map<string, { jwt: BuzzBoxJwt; renewAtMs: number }>()

export async function getToken(identity: string, password: string): Promise<BuzzBoxJwt> {
  const cached = tokenCache.get(identity)
  if (cached && Date.now() < cached.renewAtMs) return cached.jwt
  const jwt = await login(identity, password)
  const expiresMs = jwt.expiresEpochSecs ? jwt.expiresEpochSecs * 1000 : jwt.expires ? Date.parse(jwt.expires) : Date.now() + 10 * 60 * 1000
  tokenCache.set(identity, { jwt, renewAtMs: expiresMs - 60 * 1000 })
  return jwt
}

export function forgetToken(identity: string): void {
  tokenCache.delete(identity)
}

async function authed<T>(jwt: BuzzBoxJwt, path: string, init: RequestInit = {}, fallback = 'BuzzBox request failed.'): Promise<T> {
  const res = await fetch(`${BUZZBOX_BASE_URL}${path}`, {
    ...init,
    headers: { ...JSON_HEADERS, [jwt.headerName]: jwt.headerValue, ...(init.headers ?? {}) },
  })
  if (!res.ok) throw await readError(res, `${fallback} (HTTP ${res.status})`)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function listOrganisations(jwt: BuzzBoxJwt): Promise<PabxOrganisation[]> {
  return authed<PabxOrganisation[]>(jwt, '/rest/v1/pabx-organisations?limit=100&offset=0', {}, 'Could not list BuzzBox organisations.')
}

export function getOrganisation(jwt: BuzzBoxJwt, organisationId: number): Promise<PabxOrganisation> {
  return authed<PabxOrganisation>(jwt, `/rest/v1/pabx-organisations/${organisationId}`, {}, 'Could not load that BuzzBox organisation.')
}

export function listExtensions(jwt: BuzzBoxJwt, organisationId: number): Promise<PabxContact[]> {
  return authed<PabxContact[]>(jwt, `/rest/v1/pabx-organisations/${organisationId}/pabx-contacts?limit=500&offset=0`, {}, 'Could not list BuzzBox extensions.')
}

/** Click to dial: BuzzBox rings `from` (an extension) first, then bridges it to `to`. */
export function initiateCall(jwt: BuzzBoxJwt, organisationId: number, setup: CallSetup): Promise<CallSetup> {
  return authed<CallSetup>(jwt, `/rest/v1/pabx-organisations/${organisationId}/calls`, { method: 'POST', body: JSON.stringify(setup) }, 'BuzzBox could not start the call.')
}

/**
 * Turn whatever a rep typed into a phone field ("082 123 4567", "+27 (0)82-123-4567",
 * "0027821234567") into something the PABX can dial.
 *
 * Default is E.164 digits without the plus (27821234567), which is how the API itself
 * addresses numbers (its PSTN contacts are keyed by `{e164}`). BUZZBOX_DIAL_FORMAT=local
 * switches to the 0-prefixed national form (0821234567) for a dial plan that wants numbers
 * exactly as a handset would dial them. Extensions (short, no prefix) are passed through.
 */
export function normaliseDialNumber(raw: string, format: 'e164' | 'local' = (process.env.BUZZBOX_DIAL_FORMAT as 'local' | undefined) ?? 'e164'): string | null {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  // "+27 (0)82 ..." — a trunk zero written inside the international form.
  if (hasPlus && digits.startsWith('270') && digits.length === 12) digits = '27' + digits.slice(3)

  if (digits.length <= 6) return digits // an internal extension
  const national = digits.startsWith('0') && digits.length === 10 ? digits : digits.startsWith('27') && digits.length === 11 ? '0' + digits.slice(2) : null
  if (format === 'local') return national ?? digits
  if (national) return '27' + national.slice(1)
  return digits
}

/**
 * Pull the organisation ids BuzzBox names as this login's own positions out of a refusal.
 *
 * A DomainAdmin can *see* every organisation in the domain but may only read the ones it
 * holds a position in, so `GET /pabx-organisations` fails outright instead of returning a
 * filtered list. The refusal names both the organisation it stopped on and the caller's real
 * positions:
 *
 *     User at IP 35.181.5.208 with identity camille@example.co.za and user Id 9269 is not
 *     allowed READ access to PabxOrganisation with id 2583. Users roles are [DomainAdmin]
 *     Users positions are [Administrator in org 2741]
 *
 * Those positions are the answer to the question the failed call was asking. This is parsing
 * an error string, so nothing is trusted on its say-so: every id it returns is fetched
 * normally afterwards, and only an organisation BuzzBox actually serves is ever used. Only
 * the text inside `positions are [...]` is read, so the id that was *refused* can't be
 * mistaken for one that was granted.
 */
export function organisationsFromPermissionError(message: string): number[] {
  const positions = /positions are \[([^\]]*)\]/i.exec(message)
  if (!positions) return []
  const ids = [...positions[1].matchAll(/\bin org (\d+)/gi)].map((m) => Number(m[1]))
  return [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0)
}

/**
 * The organisations this login can actually work with.
 *
 * Normally that is just what `/pabx-organisations` returns. When BuzzBox refuses to list at
 * all because the login outranks its own positions (see above), fall back to fetching the
 * organisations it named — which turns a dead end into the ordinary "here are your
 * organisations" answer the caller was after.
 */
export async function listReadableOrganisations(jwt: BuzzBoxJwt): Promise<PabxOrganisation[]> {
  try {
    return await listOrganisations(jwt)
  } catch (err) {
    if (!(err instanceof BuzzBoxError)) throw err
    const own = organisationsFromPermissionError(err.message)
    if (own.length === 0) throw err
    const fetched = await Promise.all(
      own.map((id) =>
        getOrganisation(jwt, id)
          .then((org) => ({ ...org, organisationId: org.organisationId ?? id }))
          .catch(() => null),
      ),
    )
    const readable = fetched.filter((o): o is PabxOrganisation => o !== null)
    // Nothing readable means the positions were a red herring; the original refusal is the
    // more honest thing to show.
    if (readable.length === 0) throw err
    return readable
  }
}
