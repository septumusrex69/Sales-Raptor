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
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider')
  return ctx
}
