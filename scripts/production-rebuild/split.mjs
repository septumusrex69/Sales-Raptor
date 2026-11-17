// Split a Postgres script into top-level statements (quotes, E'', "", $tag$, -- and nested /* */ handled).
import { readFileSync } from 'node:fs'
const src = readFileSync(process.argv[2], 'utf8')
const out = []; let cur = ''; let i = 0; const n = src.length
while (i < n) {
  const c = src[i], d = src[i + 1]
  if (c === '-' && d === '-') { const j = src.indexOf('\n', i); const e = j < 0 ? n : j; cur += src.slice(i, e); i = e; continue }
  if (c === '/' && d === '*') { let depth = 1, j = i + 2; while (j < n && depth) { if (src[j] === '/' && src[j+1] === '*') { depth++; j += 2 } else if (src[j] === '*' && src[j+1] === '/') { depth--; j += 2 } else j++ } cur += src.slice(i, j); i = j; continue }
  if (c === "'") { const esc = /[eE]$/.test(cur) && !/[A-Za-z0-9_][eE]$/.test(cur); let j = i + 1; while (j < n) { if (esc && src[j] === '\\') { j += 2; continue } if (src[j] === "'") { if (src[j+1] === "'") { j += 2; continue } break } j++ } cur += src.slice(i, j + 1); i = j + 1; continue }
  if (c === '"') { let j = i + 1; while (j < n) { if (src[j] === '"') { if (src[j+1] === '"') { j += 2; continue } break } j++ } cur += src.slice(i, j + 1); i = j + 1; continue }
  if (c === '$') { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64)); if (m && !/[A-Za-z0-9_]$/.test(cur)) { const tag = m[0]; const j = src.indexOf(tag, i + tag.length); if (j < 0) throw new Error('unterminated ' + tag + ' at ' + i); cur += src.slice(i, j + tag.length); i = j + tag.length; continue } }
  if (c === ';') { out.push(cur); cur = ''; i++; continue }
  cur += c; i++
}
if (cur.trim()) out.push(cur)
const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
const stmts = out.map((s) => s.trim()).filter((s) => strip(s) !== '').filter((s) => !/^(begin|commit|start transaction)$/i.test(strip(s)))
process.stdout.write(JSON.stringify(stmts))
console.error('statements:', stmts.length, 'dropped begin/commit:', out.filter(s => /^(begin|commit)$/i.test(strip(s))).length)
