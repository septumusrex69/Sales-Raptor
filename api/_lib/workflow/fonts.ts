import { readFile } from 'node:fs/promises'
import { CHARTER_TTF, type CharterBytes } from '../../../src/lib/charter.js'

/**
 * CHARTER'S FOUR FACES, FETCHED FROM THE DEPLOYMENT'S OWN ORIGIN.
 *
 * `fetchCharter` in charter.ts asks for `/fonts/charter/...`, which is right in a browser and
 * resolves to nothing in Node -- a serverless function has no page it is relative to. The files
 * are static assets of this same deployment, so the origin is the deployment's own.
 *
 * CACHED FOR THE LIFE OF THE FUNCTION INSTANCE. The morning run draws up to two hundred notices
 * and the four files together are about 140 kB; fetched per notice that is 28 MB of pointless
 * traffic and four round trips added to every send.
 *
 * A FAILURE RETURNS NULL AND THE NOTICE PRINTS IN TIMES, which is the fallback Charter's own font
 * stack names anyway. CLAUDE.md's rule, and the reason for it: a notice in the wrong serif went
 * out; a notice that would not attach did not.
 *
 * AND THAT FALLBACK IS A LAST RESORT, NOT A ROUTINE ONE. The firm sent back a section 129 set in
 * Times, which is what the fallback looks like from the outside -- it is meant for the deployment
 * that has somehow lost its own files, not for every notice the morning run sends.
 */
let cached: CharterBytes | null | undefined

export async function charterFor(): Promise<CharterBytes | null> {
  if (cached !== undefined) return cached
  cached = await load()
  return cached
}

function originOf(): string | null {
  /* VERCEL_PROJECT_PRODUCTION_URL is the stable one -- VERCEL_URL is the per-deployment host,
     which is behind deployment protection on a preview and answers 401 to its own function. */
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  return host ? `https://${host}` : null
}

const FACES = [
  CHARTER_TTF.regular, CHARTER_TTF.bold, CHARTER_TTF.italic, CHARTER_TTF.boldItalic,
] as const

/**
 * OFF THE DISK FIRST, OVER THE WIRE SECOND.
 *
 * THE HTTP FETCH ALONE WAS NOT ENOUGH, and the firm found what that costs: a section 129 came out
 * of the morning run set in TIMES. The origin it asks is the project's PRODUCTION host, which is
 * the right guess and not always a reachable one -- a preview deployment fetching production gets
 * whatever production happens to be, a deployment behind Vercel's protection answers 401 to its
 * own function, and a function running anywhere else has no origin at all.
 *
 * THE FILES ARE IN THIS DEPLOYMENT. `public/fonts/charter/*.ttf` ship with the repo and the paths
 * are LITERAL, which is what lets Vercel's build tracing see them and put them in the bundle -- a
 * path assembled from a variable is a file the tracer cannot find and the lambda does not carry.
 *
 * THE FETCH STAYS AS THE FALLBACK rather than being replaced. It is the path that has worked in
 * production, and a deployment whose bundle does not carry the files still has an origin that
 * serves them.
 */
async function load(): Promise<CharterBytes | null> {
  return (await fromDisk()) ?? (await fromOrigin())
}

async function fromDisk(): Promise<CharterBytes | null> {
  try {
    const [regular, bold, italic, boldItalic] = await Promise.all([
      /* Literal paths, one per face, for the tracer. Resolved against this file rather than the
         working directory, which a serverless runtime does not promise anything about. */
      readFile(new URL('../../../public/fonts/charter/charter-regular.ttf', import.meta.url)),
      readFile(new URL('../../../public/fonts/charter/charter-bold.ttf', import.meta.url)),
      readFile(new URL('../../../public/fonts/charter/charter-italic.ttf', import.meta.url)),
      readFile(new URL('../../../public/fonts/charter/charter-bold-italic.ttf', import.meta.url)),
    ])
    return {
      regular: new Uint8Array(regular),
      bold: new Uint8Array(bold),
      italic: new Uint8Array(italic),
      boldItalic: new Uint8Array(boldItalic),
    }
  } catch {
    return null
  }
}

async function fromOrigin(): Promise<CharterBytes | null> {
  const origin = originOf()
  if (!origin) return null
  try {
    const [regular, bold, italic, boldItalic] = await Promise.all(
      FACES.map(async (path) => {
        const res = await fetch(`${origin}${path}`)
        if (!res.ok) throw new Error(`${path}: ${res.status}`)
        return new Uint8Array(await res.arrayBuffer())
      }),
    )
    return { regular, bold, italic, boldItalic }
  } catch {
    return null
  }
}
