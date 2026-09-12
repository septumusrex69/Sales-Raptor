/**
 * Teach `node --experimental-strip-types` to follow a `.js` specifier to its `.ts` source.
 *
 * Needed by exactly one kind of file: the modules under src/lib that are imported by BOTH the
 * browser and a Vercel API route. Those must write `./annexureB.js`, because Vercel transpiles
 * each file and ships it, so Node resolves the specifier at runtime against the EMITTED
 * `annexureB.js`. A `.ts` specifier survives into that output, points at a file that is not
 * there, and takes the route down with ERR_MODULE_NOT_FOUND -- which is exactly what happened to
 * every /api/buzzbox/* route on the live site on 12 September.
 *
 * Node's type stripping does not do that rewrite: a `.js` specifier must be a `.js` file on disk.
 * So this hook does it, and only where the `.js` file genuinely does not exist -- a real .js file
 * always wins, so nothing about ordinary resolution changes.
 *
 *   node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs scripts/qa/whatever.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./tsresolve-hooks.mjs', pathToFileURL('./scripts/qa/'))
