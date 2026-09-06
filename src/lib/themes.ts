/**
 * The visual skins available to the application.
 *
 * A skin is purely cosmetic: it swaps design tokens and branding, never behaviour, wording or
 * structure. Adding another one means adding an entry here and a matching [data-theme] block
 * in the stylesheet — no component changes, which is the whole point of the arrangement.
 */

export type ThemeId = 'original' | 'raptor'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  /** What the product calls itself under this skin — a skin carries its own branding. */
  productName: string
  /** Logo lockup for dark surfaces (the sidebar). */
  lockupLight: string
  /** Three colours that stand for the skin on its preview tile: ground, surface, accent. */
  swatch: { ground: string; surface: string; accent: string }
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'original',
    name: 'Current',
    description: 'The original Bredell Ferreira appearance.',
    productName: 'Romulus',
    lockupLight: '/brand/wordmark-light.svg',
    swatch: { ground: '#0f161d', surface: '#f4f6fb', accent: '#c69f54' },
  },
  {
    id: 'raptor',
    name: 'Raptor',
    description: 'Deep navy, champagne gold and atmospheric imagery.',
    productName: 'Raptor',
    lockupLight: '/brand/raptor-lockup-light.png',
    swatch: { ground: '#0b1f3b', surface: '#f4f6f9', accent: '#d4a853' },
  },
]

export const DEFAULT_THEME: ThemeId = 'original'

const STORAGE_KEY = 'crm.theme'

export function themeById(id: ThemeId): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/**
 * Reads the saved choice. Storage can be unavailable (private windows, blocked site data) and
 * can hold a skin that no longer exists, so anything unrecognised falls back to the default
 * rather than leaving the app with no theme at all.
 */
export function readStoredTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeId
  } catch {
    // Storage unavailable — the default is a perfectly good answer.
  }
  return DEFAULT_THEME
}

export function storeTheme(id: ThemeId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Not being able to remember the choice shouldn't stop it applying for this session.
  }
}

/**
 * The default skin deliberately stamps nothing. Every themed rule is scoped to a
 * [data-theme] selector, so with no attribute present not one of them matches and the
 * application renders exactly as it did before skins existed.
 */
export function applyTheme(id: ThemeId) {
  const root = document.documentElement
  if (id === DEFAULT_THEME) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', id)
}
