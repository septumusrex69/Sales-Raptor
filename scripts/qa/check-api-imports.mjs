/**
 * Every module an API route reaches must import with `.js` specifiers.
 *
 * This check exists because getting it wrong takes the live site down, and did -- twice in one
 * afternoon on 12 September 2026. Vercel does not bundle an API route: it transpiles each file
 * and ships them, so Node resolves the specifiers at runtime against the EMITTED `.js` files. A
 * `./annexureB.ts` specifier survives transpilation, points at a file that is not in the output,
 * and the whole route dies with ERR_MODULE_NOT_FOUND before its first line runs.
 *
 * It is invisible everywhere else. Vite resolves `.ts` happily, `tsc --noEmit` is content, and
 * `esbuild --bundle` -- which is what I checked it with the first time -- resolves the import at
 * BUILD time and so cannot reproduce a runtime resolution failure at all. Only production fails,
 * and only for the routes nobody touched in that deploy.
 *
 * So this walks the real import graph from every api/ entry point into src/ and asserts the
 * invariant directly. A file only the browser imports is not touched: `.ts` specifiers are the
 * house style there, and they work.
 *
 * Run: node --experimental-strip-types scripts/qa/check-api-imports.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

let failures = []
let checked = 0

/** Every .ts file under api/, which is where a serverless function can start. */
function apiFiles(dir = path.join(ROOT, 'api')) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...apiFiles(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * Relative imports that survive to runtime.
 *
 * `import type` and `export type` are erased by the compiler, so a `.ts` specifier on one of
 * those is harmless and must not be reported -- flagging it would train people to ignore this.
 */
function runtimeImports(file) {
  const src = readFileSync(file, 'utf8')
  const out = []
  const re = /(?:^|\n)\s*(?:import|export)\s+([^'"]*?)from\s*['"](\.[^'"]+)['"]/g
  for (const m of src.matchAll(re)) {
    const clause = m[1]
    // `import type { X } from` / `export type { X } from` — erased entirely.
    if (/^\s*type\s/.test(clause)) continue
    // `import { type A, type B } from` — erased only if EVERY binding is a type.
    const named = clause.match(/\{([^}]*)\}/)
    if (named) {
      const bindings = named[1].split(',').map((b) => b.trim()).filter(Boolean)
      const other = clause.replace(/\{[^}]*\}/, '').replace(/[,\s]/g, '')
      if (bindings.length > 0 && bindings.every((b) => b.startsWith('type ')) && !other) continue
    }
    out.push(m[2])
  }
  return out
}

function resolveSpecifier(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Walk from an api file into src, checking every runtime specifier on the way. */
function walk(file, seen, trail) {
  if (seen.has(file)) return
  seen.add(file)
  checked++
  for (const spec of runtimeImports(file)) {
    const target = resolveSpecifier(file, spec)
    const inSrc = target && target.includes(`${path.sep}src${path.sep}`)
    // The invariant. Only for files that end up inside a deployed function.
    if (inSrc && spec.endsWith('.ts')) {
      failures.push(
        `${path.relative(ROOT, file)}\n       imports "${spec}"\n`
        + `       reached from ${trail.map((f) => path.relative(ROOT, f)).join(' -> ') || '(api entry)'}\n`
        + '       A .ts specifier does not survive Vercel\'s transpile. Use .js.',
      )
    }
    if (target) walk(target, seen, [...trail, file])
  }
}

const seen = new Set()
for (const entry of apiFiles()) walk(entry, seen, [])

console.log(`\nwalked ${checked} files reachable from api/`)
if (failures.length === 0) {
  console.log('every runtime import into src/ uses a .js specifier\n')
  process.exit(0)
}
console.log(`\n${failures.length} bad specifier(s):`)
for (const f of failures) console.log(`  FAIL ${f}`)
console.log()
process.exit(1)
