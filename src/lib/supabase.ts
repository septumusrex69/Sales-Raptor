import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in your Supabase project values.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Hardcoded rather than derived from window.location.origin: invite/reset
 * emails encode this as the redirect target, so if an admin ever triggers
 * one while browsing a local dev server or preview deploy, the recipient
 * would get sent to a URL that only exists on the admin's machine. Update
 * this if the production domain ever changes.
 */
export const PRODUCTION_APP_URL = 'https://sales-raptor.vercel.app'
