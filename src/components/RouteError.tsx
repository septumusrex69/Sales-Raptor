import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { isStaleChunkError, reloadOnceForStaleChunk } from '../lib/staleChunk'

/**
 * WHAT A SCREEN THAT FAILED SHOWS, in Raptor's words rather than the router's developer notice.
 *
 * The commonest cause by far is a tab that outlived a deploy (staleChunk.ts): that one reloads
 * itself once and, if it is still here after that, says Raptor was updated and offers the button.
 * Anything else says something went wrong and shows the message, because "it broke" with nothing
 * to read out is useless on the phone to whoever has to fix it.
 */
export function RouteError() {
  const error = useRouteError()
  const stale = isStaleChunkError(error)

  useEffect(() => {
    if (stale) reloadOnceForStaleChunk()
  }, [stale])

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : null
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#f7f8fa] px-4" data-testid="route-error">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800">
          {stale ? 'Raptor has been updated' : 'Something went wrong on this screen'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {stale
            ? 'This tab was opened on the previous version. Reload to carry on — you stay signed in.'
            : 'Reload to try again. If it keeps happening, tell your administrator what it says below.'}
        </p>
        {!stale && message && <p className="mt-3 text-xs text-slate-400 break-words">{message}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-[#142433] text-white hover:bg-[#1c3149]">
            <RefreshCw size={15} /> Reload
          </button>
          {!stale && (
            <a href="/" className="text-sm font-medium px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
              Go to the dashboard
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
