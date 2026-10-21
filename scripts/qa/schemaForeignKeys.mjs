/**
 * Every foreign key in supabase/schema.sql, read the way Postgres would end up holding them.
 *
 * schema.sql is append-only, so a key is declared wherever its column was -- inside a `create table`,
 * in an `alter table ... add column`, or as a named `add constraint ... foreign key` -- and is dropped
 * by a later `drop constraint` or `drop table`. This walks the file statement by statement, skipping
 * dollar-quoted function bodies (a `references` inside a plpgsql string is not a key), and returns
 * one row per key: { from, column, to, onDelete }.
 *
 * `onDelete` is Postgres's own letter, so the result compares one-for-one with pg_constraint's
 * confdeltype: a = no action, r = restrict, c = cascade, n = set null, d = set default.
 *
 * The live half is scripts/qa/live/foreign-keys.sql, which prints the same rows from pg_constraint;
 * this reader was checked against it on staging (S10, 21 Oct): all 207 live table pairs, and one more
 * the file still declares -- account_fees.payment_id, whose key staging no longer has. A key the file
 * declares and the database lacks only makes a check here stricter, never looser.
 */
import { readFileSync } from 'node:fs'

const ON_DELETE = { 'no action': 'a', restrict: 'r', cascade: 'c', 'set null': 'n', 'set default': 'd' }

/** The file with comments removed and every $tag$ ... $tag$ body blanked, so `;` splits statements. */
function statementsOf(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue }
    if (sql.startsWith('/*', i)) { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue }
    if (sql[i] === "'") {
      const m = /^'(?:[^']|'')*'/.exec(sql.slice(i))
      const lit = m ? m[0] : sql.slice(i)
      out += "''"; i += lit.length; continue
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40))
    if (dollar) {
      const e = sql.indexOf(dollar[0], i + dollar[0].length)
      out += ' $body$ '; i = e < 0 ? sql.length : e + dollar[0].length; continue
    }
    out += sql[i]; i += 1
  }
  return out.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const NAME = '(?:public\\.)?"?([a-z_][a-z0-9_]*)"?'

/** Split a create-table body on top-level commas. */
function topLevel(body) {
  const parts = []
  let depth = 0; let cur = ''
  for (const ch of body) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim())
}

function keyOf(from, clause) {
  // `col type ... references public.t (id) on delete x`, or `[constraint n] foreign key (col) references ...`
  const ref = new RegExp(`references (?!auth\\.|storage\\.)${NAME}(?: ?\\([^)]*\\))?((?: on (?:delete|update) (?:no action|restrict|cascade|set null|set default))*)`, 'i').exec(clause)
  if (!ref) return null
  const del = /on delete (no action|restrict|cascade|set null|set default)/i.exec(ref[2] ?? '')
  const fk = /foreign key ?\(\s*"?([a-z_][a-z0-9_]*)"?/i.exec(clause)
  const column = fk ? fk[1] : (/^(?:add column (?:if not exists )?)?"?([a-z_][a-z0-9_]*)"?/i.exec(clause)?.[1] ?? null)
  // An unnamed key is called <table>_<column>_fkey, which is the name a later drop constraint uses.
  const name = /constraint "?([a-z_][a-z0-9_]*)"?/i.exec(clause)?.[1] ?? `${from}_${column}_fkey`
  return { from, column, to: ref[1], onDelete: del ? ON_DELETE[del[1].toLowerCase()] : 'a', name }
}

export function foreignKeys(sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')) {
  let keys = []
  const created = new Set()
  for (const st of statementsOf(sql)) {
    const create = new RegExp(`^create table (?:if not exists )?${NAME} ?\\((.*)\\)`, 'i').exec(st)
    if (create) {
      const from = create[1]
      // A second `create table if not exists` of the same table creates nothing.
      if (created.has(from) && /if not exists/i.test(st)) continue
      created.add(from)
      for (const part of topLevel(create[2])) {
        const k = keyOf(from, part)
        if (k) keys.push(k)
      }
      continue
    }
    const drop = new RegExp(`^drop table (?:if exists )?${NAME}`, 'i').exec(st)
    if (drop) { keys = keys.filter((k) => k.from !== drop[1] && k.to !== drop[1]); continue }
    const alter = new RegExp(`^alter table (?:only )?(?:if exists )?${NAME} (.*)$`, 'i').exec(st)
    if (!alter) continue
    const from = alter[1]
    for (const action of topLevel(alter[2])) {
      const dropC = /^drop constraint (?:if exists )?"?([a-z_][a-z0-9_]*)"?/i.exec(action)
      if (dropC) { keys = keys.filter((k) => !(k.from === from && k.name === dropC[1])); continue }
      const dropCol = /^drop column (?:if exists )?"?([a-z_][a-z0-9_]*)"?/i.exec(action)
      if (dropCol) { keys = keys.filter((k) => !(k.from === from && k.column === dropCol[1])); continue }
      if (!/^add /i.test(action)) continue
      const k = keyOf(from, action.replace(/^add (?=constraint|foreign key)/i, ''))
      if (!k) continue
      // `add column if not exists` on a column that is already there adds nothing.
      if (/add column if not exists/i.test(action) && keys.some((x) => x.from === from && x.column === k.column)) continue
      if (k.name && keys.some((x) => x.from === from && x.name === k.name)) continue
      keys.push(k)
    }
  }
  return keys
}
