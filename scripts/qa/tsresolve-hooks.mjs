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
  // Extensionless, the way the app's own source imports ('../types'). Vite resolves these;
  // Node does not, so a lib that imports a value (not just a type) could not be checked.
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const asTs = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(asTs))) return nextResolve(specifier + '.ts', context)
    } catch { /* fall through to the default resolver */ }
  }
  return nextResolve(specifier, context)
}
