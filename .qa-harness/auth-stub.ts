/** Stands in for src/store/AuthContext during the offline layout render. */
export function useAuth() {
  return {
    currentUser: { id: 'u1', name: 'Stephan', role: 'Administrator', status: 'Active' },
    session: { access_token: 'offline' },
    signOut: () => {},
  }
}
