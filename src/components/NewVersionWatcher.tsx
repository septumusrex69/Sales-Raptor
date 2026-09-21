import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTheme } from '../store/ThemeContext'
import { nextVersionAction } from '../lib/versionCheck'

/** Quiet enough not to hammer the server, frequent enough that a fix lands the same day it ships. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * The bundle filename Vite gave this build. Every deploy produces a new content hash, so
 * comparing it against the one the server is currently serving is a reliable "is my tab
 * running old code?" test — no build-time version file to keep in step.
 */
function currentBundleUrl(): string | null {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[]
  return scripts.map((s) => s.getAttribute('src')).find((src) => src && src.includes('/assets/')) ?? null
}

async function deployedBundleUrl(): Promise<string | null> {
  const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  const html = await res.text()
  return html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1] ?? null
}

/**
 * Someone is mid-task if a modal is open or they're typing. Reloading then would throw away
 * a half-written email, so in that case the banner waits for them instead.
 */
function safeToReloadNow(): boolean {
  if (document.querySelector('[data-modal-open]')) return false
  const el = document.activeElement
  return !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable)
}

/** Remembers which deployed bundle this tab has already reloaded itself for. */
const RELOADED_FOR = 'crm.reloadedForBundle'

/**
 * Watches for a newly deployed version and gets the tab onto it.
 *
 * A long-lived tab keeps running whatever JavaScript it downloaded when it was opened, so a
 * fix could be live for hours while the person looking at the app still had the old code and
 * no way to know. This checks periodically and whenever the tab regains focus, reloads
 * silently when nothing would be lost, and otherwise offers a button rather than yanking the
 * page away mid-sentence.
 *
 * IT RELOADS AT MOST ONCE FOR A GIVEN BUNDLE, AND THAT GUARD IS THE WHOLE POINT.
 *
 * THE FIRM: "when I try to load it again, there's always some issue ... I can't even open the
 * app." Without the guard this is a loop, and a loop here looks exactly like an app that will
 * not open: reload, find the served bundle still different, reload again, for ever. It does not
 * need a bug of ours to happen — a deployment rolling out, a CDN node still holding the previous
 * index.html, or two builds alternating behind one alias are each enough. Nobody sees a version
 * banner in that state, because the page never lives long enough to draw one.
 *
 * So the target hash is written down BEFORE reloading. If the tab comes back up and the server
 * is still offering something else, that is not a new deploy — that is the loop — and the
 * banner is shown instead, which is the outcome somebody can act on.
 */
export function NewVersionWatcher() {
  const { theme } = useTheme()
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    const own = currentBundleUrl()
    // In dev there's no hashed bundle to compare against.
    if (!own) return
    let cancelled = false

    async function check() {
      if (cancelled || document.hidden) return
      try {
        const deployed = await deployedBundleUrl()
        if (cancelled) return
        /* Storage blocked (private browsing) reads as "we have already tried", which turns the
           automatic reload into the banner. Without somewhere to write the attempt down there is
           no reload here that is safe to make twice. */
        let reloadedFor: string | null = deployed
        try {
          reloadedFor = sessionStorage.getItem(RELOADED_FOR)
        } catch { /* keep the pessimistic value */ }

        const action = nextVersionAction({
          own, deployed, reloadedFor, safeToReload: safeToReloadNow(),
        })
        if (action === 'none') return
        if (action === 'banner') { setUpdateReady(true); return }
        /* 'reload' is only returned for a deployed bundle that exists; this narrows it. */
        if (!deployed) return
        try {
          sessionStorage.setItem(RELOADED_FOR, deployed)
        } catch {
          setUpdateReady(true)
          return
        }
        window.location.reload()
      } catch {
        // Offline or a blip — try again on the next tick rather than bothering anyone.
      }
    }

    const timer = setInterval(check, CHECK_INTERVAL_MS)
    function onVisible() {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  if (!updateReady) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-navy-950 text-white rounded-xl shadow-lg px-4 py-2.5">
      <span className="text-sm">A newer version of {theme.productName} is ready.</span>
      <button
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 text-sm font-medium bg-gold-400 text-navy-950 rounded-lg px-3 py-1.5 hover:bg-gold-300"
      >
        <RefreshCw size={13} /> Reload
      </button>
    </div>
  )
}
