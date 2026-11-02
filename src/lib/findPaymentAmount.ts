/**
 * READ AN AMOUNT THE WAY IT ARRIVES ON A PROOF OF PAYMENT (request #18).
 *
 * Camille types what the POP says, and a POP says it any of four ways: "R 1 500,00" (the firm's own
 * en-ZA, with a non-breaking space a copy out of Raptor carries), "1,500.00" (a bank's app), "1500.00",
 * "1500". The search is an EXACT match on the amount, so reading "1,500" as one rand fifty would find
 * nothing and say so, which reads as "the payment is not in Raptor" -- the one wrong answer this page
 * exists to stop.
 *
 * THE RULE: the LAST comma or point is the decimal mark when one or two digits follow it; every other
 * comma, point and space is a thousands separator. Three digits after a lone separator are thousands
 * ("1.500" is fifteen hundred), because no rand amount has three decimals. Null when there is no amount
 * or it is not a positive number -- the caller says so rather than searching for it.
 *
 * Its own file, with no Supabase import, so a check can run it.
 */
export function parseRandAmount(input: string): number | null {
  const s = input.replace(/^\s*R\s*/i, '').replace(/[\s  ']/g, '')
  if (!s) return null
  if (!/^[0-9.,]+$/.test(s)) return null
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
  let whole = s
  let cents = ''
  if (last >= 0 && /^[0-9]{1,2}$/.test(s.slice(last + 1))) {
    whole = s.slice(0, last)
    cents = s.slice(last + 1)
  }
  whole = whole.replace(/[.,]/g, '')
  if (!/^[0-9]+$/.test(whole)) return null
  const n = Number(`${whole}.${cents || '0'}`)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}
