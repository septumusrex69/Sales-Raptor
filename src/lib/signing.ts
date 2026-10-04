/**
 * THE DATABASE HALF OF SIGNING. The rules, the token and the words are in signingRules.ts, which a
 * check can import; this file reaches Supabase and therefore cannot be imported by one.
 */
import { supabase } from './supabase'
import type { Block, PageSetup } from './letterDocument.ts'
import type { Blank } from './signingBlanks.ts'
import { newToken, type SigningRequest, type SigningState } from './signingRules.ts'

export * from './signingRules.ts'

/* ------------------------------------------------------------------ the database */

/** Create a request and return the token. The body is copied, never referenced -- see the header. */
export async function createSigningRequest(input: {
  accountId: string | null
  title: string
  body: Block[]
  /** The firm's own sheet, frozen with the body. Without it the signer gets bare white paper. */
  pageSetup?: PageSetup | null
  /** What the signer may fill in, where Raptor had nothing to print. See signingBlanks.ts. */
  blanks?: Blank[]
  signerName?: string | null
  signerEmail?: string | null
  createdBy?: string | null
}): Promise<string> {
  const token = newToken()
  const { error } = await supabase.from('signing_requests').insert({
    token,
    account_id: input.accountId,
    title: input.title,
    body: input.body,
    page_setup: input.pageSetup ?? null,
    blanks: input.blanks ?? [],
    signer_name: input.signerName ?? null,
    signer_email: input.signerEmail ?? null,
    created_by: input.createdBy ?? null,
  })
  if (error) throw new Error(error.message)
  return token
}

/** Open one by its token. Anonymous: this is the signer's side. */
export async function openSigningRequest(token: string): Promise<SigningRequest | null> {
  /* ONE jsonb, NOT A ROW OF COLUMNS. signing_open's OUT parameters could not grow to carry the
     sheet and the blanks without dropping it first, which this project's tooling cannot do. See
     the comment on signing_document. */
  const { data, error } = await supabase.rpc('signing_document', { p_token: token })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row) return null
  return {
    title: row.title as string,
    body: (row.body ?? []) as Block[],
    pageSetup: (row.page_setup ?? null) as PageSetup | null,
    blanks: (row.blanks ?? []) as Blank[],
    filled: (row.filled ?? {}) as Record<string, string>,
    signerName: (row.signer_name ?? null) as string | null,
    state: (row.state ?? 'sent') as SigningState,
    signedAt: (row.signed_at ?? null) as string | null,
    signaturePng: (row.signature_png ?? null) as string | null,
    initialsPng: (row.initials_png ?? null) as string | null,
    signedName: (row.signed_name ?? null) as string | null,
  }
}

/**
 * Sign it. False where the link was already used -- see signing_sign for why that is not an error.
 */
export async function signDocument(input: {
  token: string
  signaturePng: string
  initialsPng: string | null
  name: string
  /** What they typed into the document's blanks. Checked again in the database -- see the RPC. */
  filled?: Record<string, string>
}): Promise<boolean> {
  const { data, error } = await supabase.rpc('signing_sign', {
    p_token: input.token,
    p_signature: input.signaturePng,
    p_initials: input.initialsPng ?? '',
    p_name: input.name,
    p_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    p_filled: input.filled ?? {},
  })
  if (error) throw new Error(error.message)
  return data === true
}

/** The firm's own side: what has been sent out on this account, newest first. */
export async function listSigningRequests(accountId: string): Promise<{
  id: string; token: string; title: string; state: SigningState
  createdAt: string; signedAt: string | null; signedName: string | null
}[]> {
  const { data, error } = await supabase.from('signing_requests')
    .select('id, token, title, state, created_at, signed_at, signed_name')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => ({
    id: r.id,
    token: r.token,
    title: r.title,
    state: (r.state ?? 'sent') as SigningState,
    createdAt: r.created_at,
    signedAt: r.signed_at ?? null,
    signedName: r.signed_name ?? null,
  }))
}
