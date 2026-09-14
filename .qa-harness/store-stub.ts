/** Stands in for src/store/AppStore during the offline layout render. */
export function useAppStore() {
  return {
    companies: [
      { id: 'c1', name: 'Standard Bank Home Loans' },
      { id: 'c2', name: 'Mzansi Micro-Lending (Pty) Ltd' },
    ],
    users: [],
    addActivity: () => {},
  }
}
