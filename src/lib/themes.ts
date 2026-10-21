/**
 * The visual skins available to the application.
 *
 * A skin is purely cosmetic: it swaps design tokens and branding, never behaviour, wording or
 * structure. Adding another one means adding an entry here and a matching [data-theme] block
 * in the stylesheet — no component changes, which is the whole point of the arrangement.
 */

export type ThemeId = 'original' | 'raptor' | 'desert' | 'glass-mountain' | 'ocean'

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
  /**
   * THE BRAND LINE ACROSS THE COMPANY DASHBOARD'S PHOTOGRAPH, AND EVERY SKIN HAS ITS OWN.
   *
   * THE FIRM, having seen the desert line arrive on the mountain: "for the first theme, it should
   * say the sky thing about the sky, it's only the beginning. But the desert theme has something
   * else, another saying. So each place will have its own saying." The line was global for one
   * version, which put a sentence about a horizon over a photograph of a mountain at dawn -- the
   * words are written FOR the picture, so they belong to the skin that carries the picture.
   *
   * TWO HALVES RATHER THAN ONE STRING, because the hero sets the first in white and the second in
   * champagne across a hand-made break. A single sentence left to wrap would put the colour change
   * wherever the window happened to be wide.
   *
   * THE APOSTROPHE IS THE TYPOGRAPHIC ONE, written here rather than as an HTML entity: this is
   * data, and `&rsquo;` in a string is four characters a React text node would draw literally.
   */
  heroLine: { first: string; second: string }
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'original',
    name: 'Current',
    description: 'The original Bredell Ferreira appearance.',
    productName: 'Romulus',
    lockupLight: '/brand/wordmark-light.svg',
    swatch: { ground: '#0f161d', surface: '#f4f6fb', accent: '#c69f54' },
    heroLine: { first: 'The sky is only', second: 'the beginning.' },
  },
  {
    id: 'raptor',
    name: 'Raptor',
    description: 'Deep navy, champagne gold and atmospheric imagery.',
    productName: 'Raptor',
    lockupLight: '/brand/raptor-lockup-light.png',
    swatch: { ground: '#0b1f3b', surface: '#f4f6f9', accent: '#d4a853' },
    /* The line the firm wrote for the mountain at dawn, and the one they asked to have back the
       moment the desert's line turned up over it. */
    heroLine: { first: 'The sky is only', second: 'the beginning.' },
  },
  {
    id: 'desert',
    name: 'Desert',
    description: 'Warm sand, low sun and the dunes. The same Raptor, in another light.',
    /*
     * THE SAME PRODUCT NAME AS raptor, and that is not an oversight.
     *
     * A skin carries its own branding and this one is the same brand in another light -- the
     * firm asked for "a new skin with the desert theme", not a second product. Giving it a name
     * of its own would put a different word in the sidebar, in the page title and in the
     * Appearance tab's own subtitle, which is a rename rather than a skin.
     */
    productName: 'Raptor',
    lockupLight: '/brand/raptor-lockup-light.png',
    /* Ground, surface, accent -- the three the preview tile stands on. Read off the skin's own
       --color-navy-950, --color-surface and --c-gold, so the tile cannot drift from the skin. */
    swatch: { ground: '#12100b', surface: '#f7f4ee', accent: '#d99f3f' },
    /*
     * THE DESERT'S OWN SAYING, which is the one the firm sent with the photograph: "instead of
     * saying the sky is only the beginning, put the one that I put up there for you, which says
     * our world doesn't end at the horizon."
     *
     * The break falls after "end", so the champagne half is the phrase that names the horizon
     * rather than the last two words of it.
     */
    heroLine: { first: 'Our world doesn\u2019t end', second: 'at the horizon.' },
  },
  {
    id: 'glass-mountain',
    name: 'Glass Mountain',
    description: 'Cinematic alpine landscape with premium frosted glass surfaces.',
    productName: 'Raptor',
    lockupLight: '/brand/raptor-lockup-light.png',
    swatch: { ground: '#071722', surface: 'rgba(10,24,34,0.62)', accent: '#dcaf59' },
    /* A mountain under a sky, so it keeps the sky line. A skin with a photograph of its own may
       write its own saying; one that does not has no reason to borrow the desert's. */
    heroLine: { first: 'The sky is only', second: 'the beginning.' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep water, a broken sky and the light on the sea. The same Raptor, at depth.',
    /* The same product name as raptor, for the desert's reason: a skin is the same brand in
       another light, and a name of its own would be a rename rather than a skin. */
    productName: 'Raptor',
    lockupLight: '/brand/raptor-lockup-light.png',
    /* Ground, surface, accent -- read off ocean.css's own --color-navy-950, --color-surface and
       --c-gold, so the preview tile cannot drift from the skin. */
    swatch: { ground: '#06121e', surface: '#f2f5f8', accent: '#d2b57a' },
    /*
     * THE OCEAN'S OWN SAYING, which the firm gave with the photographs: "the new slogan is going to
     * be depth changes perspective."
     *
     * The break falls after "changes", so the champagne half is the word the line turns on.
     */
    heroLine: { first: 'Depth changes', second: 'perspective.' },
  },
]

/**
 * What someone gets before they've ever chosen a skin.
 *
 * Kept separate from BASE_THEME below, because the two answer different questions and the app
 * now gives them different answers: this one is a product decision, that one is a fact about
 * where the stylesheet keeps its tokens.
 */
export const DEFAULT_THEME: ThemeId = 'raptor'

/**
 * The skin the stylesheet renders with no attribute set.
 *
 * `:root` in index.css holds the original token values, and every skin overrides them from its
 * own [data-theme] block — so there is no [data-theme='original'] block to select, and the
 * original skin can only be expressed by the absence of the attribute. This is a property of
 * the CSS, not a preference, so it stays put even though the default has moved on.
 */
export const BASE_THEME: ThemeId = 'original'

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
 * The base skin deliberately stamps nothing. Every themed rule is scoped to a [data-theme]
 * selector, so with no attribute present not one of them matches and the application renders
 * exactly as it did before skins existed.
 *
 * Note this tests BASE_THEME, not DEFAULT_THEME. Stripping the attribute for whichever skin
 * happens to be the default would render that skin as the unstyled baseline — which is
 * precisely the wrong picture now that the default is a skin with rules of its own.
 *
 * index.html repeats the essentials of this before first paint. If the storage key or the set
 * of ids changes here, change it there too.
 */
export function applyTheme(id: ThemeId) {
  const root = document.documentElement
  if (id === BASE_THEME) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', id)
}
