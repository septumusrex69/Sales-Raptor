import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

interface TitleSlotValue {
  node: ReactNode
  setNode: (node: ReactNode) => void
}

const TitleSlotContext = createContext<TitleSlotValue | null>(null)

/**
 * Lets a page hang one control off the page title in the top bar.
 *
 * A control that switches what the whole page is showing belongs beside the page's name, not
 * buried among the filters inside it — but the title lives in the layout, which knows nothing
 * about any particular page. This is the seam between them, and it stays deliberately narrow:
 * one slot, one control, so it can't quietly become a second toolbar.
 */
export function TitleSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null)
  const value = useMemo(() => ({ node, setNode }), [node])
  return <TitleSlotContext.Provider value={value}>{children}</TitleSlotContext.Provider>
}

/** Read by the top bar. */
export function useTitleSlotNode(): ReactNode {
  return useContext(TitleSlotContext)?.node ?? null
}

/**
 * Called by a page to fill the slot. `deps` are the values the control actually depends on —
 * the element itself is rebuilt every render, so keying the effect on it would loop forever.
 */
export function useTitleSlot(node: ReactNode, deps: unknown[]) {
  const ctx = useContext(TitleSlotContext)
  const setNode = ctx?.setNode
  useEffect(() => {
    setNode?.(node)
    return () => setNode?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNode, ...deps])
}
