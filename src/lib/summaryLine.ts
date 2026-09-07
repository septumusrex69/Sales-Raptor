/**
 * Joins the parts of a one-line summary, dropping the ones that aren't there.
 *
 * Written because the record banners built their subtitles as literal template text —
 * `{industry} · {city}, {province}` — which reads correctly only when every field is filled
 * in. A client with none of them rendered as "· ,": punctuation with nothing to punctuate,
 * on every banner for every client nobody had filled in yet.
 *
 * Separators belong between things that exist, so they are applied here rather than typed
 * into the markup.
 */
export function summaryLine(parts: (string | null | undefined | false)[], separator = ' · '): string {
  return parts.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean).join(separator)
}
