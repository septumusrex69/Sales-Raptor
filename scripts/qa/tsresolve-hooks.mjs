/** The resolve hook itself. See tsresolve.mjs for why this exists. */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      const asJs = new URL(specifier, context.parentURL)
      // Only when the .js does not exist. A real one must always win.
      if (!existsSync(fileURLToPath(asJs))) {
        const asTs = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
        if (existsSync(fileURLToPath(asTs))) {
          return nextResolve(specifier.slice(0, -3) + '.ts', context)
        }
      }
    } catch { /* fall through to the default resolver */ }
  }
  return nextResolve(specifier, context)
}
