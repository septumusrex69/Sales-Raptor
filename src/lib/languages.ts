/**
 * South Africa's twelve official languages, plus Other.
 *
 * The language a lead or client would rather be spoken to in. Stored as the name shown here, so
 * a row reads the same in the database as on screen, and a value typed before this list existed
 * (or imported as written) still shows rather than vanishing from the dropdown.
 */
export const SA_LANGUAGES = [
  'English',
  'Afrikaans',
  'isiZulu',
  'isiXhosa',
  'isiNdebele',
  'Sepedi',
  'Sesotho',
  'Setswana',
  'siSwati',
  'Tshivenda',
  'Xitsonga',
  'South African Sign Language',
  'Other',
] as const

/** Other names people write for the same languages, all lower-case. */
const ALIASES: Record<string, (typeof SA_LANGUAGES)[number]> = {
  eng: 'English', engels: 'English',
  afr: 'Afrikaans', afrikaans: 'Afrikaans',
  zulu: 'isiZulu', xhosa: 'isiXhosa', ndebele: 'isiNdebele',
  pedi: 'Sepedi', 'northern sotho': 'Sepedi', 'sesotho sa leboa': 'Sepedi',
  sotho: 'Sesotho', 'southern sotho': 'Sesotho',
  tswana: 'Setswana', swati: 'siSwati', swazi: 'siSwati',
  venda: 'Tshivenda', tsonga: 'Xitsonga', shangaan: 'Xitsonga',
  sasl: 'South African Sign Language', 'sign language': 'South African Sign Language',
}

/** "zulu", "IsiZulu", "Afr" → the name in the list. Anything unrecognised comes back as written. */
export function normaliseLanguage(v: string | undefined | null): string | undefined {
  const s = (v ?? '').replace(/\s+/g, ' ').trim()
  if (!s || s === '-') return undefined
  const lower = s.toLowerCase()
  const listed = SA_LANGUAGES.find((l) => l.toLowerCase() === lower)
  return listed ?? ALIASES[lower] ?? s
}
