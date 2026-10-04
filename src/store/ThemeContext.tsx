import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, readStoredTheme, storeTheme, themeById, type ThemeDefinition, type ThemeId } from '../lib/themes'

interface ThemeContextValue {
  themeId: ThemeId
  theme: ThemeDefinition
  setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Read straight out of storage on the first render rather than in an effect: applying the
  // skin a frame later would show everyone a flash of the other theme on every page load.
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = readStoredTheme()
    applyTheme(saved)
    return saved
  })

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id)
    applyTheme(id)
    storeTheme(id)
  }, [])

  // A skin carries its own branding, and the browser tab is part of that. index.html sets the
  // default before boot; this keeps it honest when someone switches to a skin that calls the
  // product something else.
  useEffect(() => {
    document.title = themeById(themeId).productName
  }, [themeId])

  // A second tab is the same person: changing the skin in one should carry to the others
  // rather than leaving them looking like a different product.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== 'crm.theme') return
      const next = readStoredTheme()
      setThemeId(next)
      applyTheme(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo(() => ({ themeId, theme: themeById(themeId), setTheme }), [themeId, setTheme])
  return (
    <ThemeContext.Provider value={value}>
      {/*
       * GLASS MOUNTAIN: a real DOM node, not a CSS pseudo-element or a background on html.
       *
       * backdrop-filter blurs the GPU compositor layer BEHIND the element. A z-index:-1
       * pseudo-element or background-attachment:fixed on html both end up below the root paint
       * layer and are unreachable by any child's backdrop-filter. A position:fixed div that is a
       * DOM sibling rendered BEFORE the app content is a separate compositor layer at z-index 0;
       * every backdrop-filter element above it in the DOM (sidebar, topbar, cards) can blur it.
       */}
      {themeId === 'glass-mountain' && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 0,
            backgroundImage: "linear-gradient(rgba(5,18,27,0.24), rgba(5,18,27,0.42)), url('/brand/glass-mountain-bg.jpg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            pointerEvents: 'none',
          }}
        />
      )}
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider')
  return ctx
}
