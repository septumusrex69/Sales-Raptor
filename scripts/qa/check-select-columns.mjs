/**
 * Do our PostgREST selects name columns that actually exist?
 *
 * WHY THIS EXISTS. A Supabase select is a STRING. Nothing in `npm run build` looks inside it:
 * tsc checks the row interface we wrote by hand, not the literal we hand to PostgREST, and the
 * two are free to disagree. When they do, PostgREST rejects the whole request for one unknown
 * column — so a single wrong name empties an entire page rather than blanking one field.
 *
 * That is not hypothetical. `leads ( first_name, last_name, company )` shipped to staging; the
 * column is `company_name`; the mailbox showed no mail at all, on every tab, including mail that
 * had nothing to do with leads. The build was green the whole time.
 *
 * WHAT IT CHECKS. Every `.from('table').select(...)` in src/ and api/, against the table
 * definitions in supabase/schema.sql — which is already the repo's source of truth and already
 * kept current with every migration, so there is no second snapshot to drift.
 *
 * TWO failure modes, because both empty the page and neither is visible to tsc:
 *   1. a column that does not exist;
 *   2. an embed with more than one foreign key between the two tables and no constraint named,
 *      which PostgREST refuses with "more than one relationship was found".
 *
 * The second is not hypothetical either, and it happened the day after the first: a migration
 * added moved_from_account_id to user_emails, giving it a second key to debtor_accounts, and
 * the mailbox went blank again with this check passing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It will not catch a column that exists in the live database
 * but is missing from schema.sql, because it believes schema.sql. That is the right direction to
 * be wrong: a stale schema.sql makes this shout about a column that is fine, which someone then
 * fixes by updating schema.sql — exactly the discipline worth enforcing.
 *
 *   node scripts/qa/check-select-columns.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname

/** Every foreign key in the schema, as {from, to}. Filled by readSchema; read by relationships(). */
const fks = []

/* ------------------------------------------------------------------ *
 * What the schema says
 * ------------------------------------------------------------------ */

/**
 * Table -> set of column names, read out of `create table` blocks.
 *
 * Also honours `alter table ... add column`, because a migration mirrored into schema.sql
 * sometimes lands as an alter rather than being folded into the original block.
 */
function readSchema(rawSql) {
  const tables = new Map()

  /*
   * Strip line comments first.
   *
   * This schema comments nearly every column, ON THE LINE ABOVE IT. Splitting on commas leaves
   * each column glued to the comment that introduces it, so a "does this line start with --"
   * test throws the column away with the prose — silently, and for most of the file. That is
   * exactly what the first version of this script did, and it reported 45 real columns missing.
   *
   * Block comments go too, and for a sharper reason: prose contains apostrophes ("the debtor's
   * account"), and the comma-splitter below treats a quote as the start of a string literal. One
   * apostrophe in a comment therefore swallows every column after it. That cost the second run
   * of this script a false report on is_filed.
   */
  const sql = rawSql
    // Line comments FIRST. One of them mentions the path /api/email/*, and that `/*` opens a
    // block comment that then runs to the next `*/` 1052 lines later, taking 16 table
    // definitions with it. Removing line comments first removes the fake opener.
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const createRe = /create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi
  for (const [, table, body] of sql.matchAll(createRe)) {
    for (const [, target] of body.matchAll(/references\s+(?:public\.)?(\w+)/gi)) {
      fks.push({ from: table, to: target })
    }
    const cols = new Set()
    for (const raw of splitTopLevel(body)) {
      const line = raw.trim()
      if (!line) continue
      // Skip table-level constraints; they are not columns.
      if (/^(primary key|foreign key|unique|check|constraint|exclude)\b/i.test(line)) continue
      // The name, then whitespace and a type — or, for the last column, end of the block.
      const name = line.match(/^"?(\w+)"?(?:\s|$)/)
      if (name) cols.add(name[1])
    }
    tables.set(table, cols)
  }

  const alterRe = /alter table (?:only )?(?:public\.)?(\w+)([\s\S]*?);/gi
  for (const [, table, body] of sql.matchAll(alterRe)) {
    if (!tables.has(table)) continue
    for (const [, col] of body.matchAll(/add column (?:if not exists )?"?(\w+)"?/gi)) {
      tables.get(table).add(col)
    }
    // A column added by ALTER can carry a foreign key too — which is exactly how the second key
    // to debtor_accounts arrived and broke the mailbox.
    for (const [, target] of body.matchAll(/references\s+(?:public\.)?(\w+)/gi)) {
      fks.push({ from: table, to: target })
    }
  }

  return tables
}

/**
 * How many relationships PostgREST can see between two tables, in either direction.
 *
 * More than one and a bare `target ( ... )` embed is ambiguous: PostgREST refuses the WHOLE
 * request with "more than one relationship was found" and the page renders empty. The fix is to
 * name the constraint — `target!my_table_some_column_fkey ( ... )` — which is why the parser
 * above accepts that form.
 */
function relationships(a, b) {
  return fks.filter((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a)).length
}

/**
 * Split a create-table body on commas that are NOT inside brackets.
 *
 * Naive splitting breaks on `check (status in ('a','b'))` and on `generated always as (x or y)`,
 * both of which this schema uses heavily — and every column after such a line would be lost,
 * producing a page of false failures.
 */
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let current = ''
  let quote = null
  for (const ch of body) {
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue }
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  parts.push(current)
  return parts
}

/* ------------------------------------------------------------------ *
 * What the code asks for
 * ------------------------------------------------------------------ */

/**
 * Pull the column list apart into the base table's own columns and its embeds.
 *
 * PostgREST syntax handled: plain names, `alias:column`, `table ( a, b )` embeds, and the
 * `table!constraint ( ... )` form used where two foreign keys reach the same table. `*` is
 * allowed through — it names nothing that can be wrong.
 */
function parseSelect(select) {
  const own = []
  const embeds = []
  let depth = 0
  let current = ''
  const flush = () => {
    const piece = current.trim()
    current = ''
    if (!piece) return
    const embed = piece.match(/^([\w]+)(!\w+)?\s*\(([\s\S]*)\)$/)
    if (embed) {
      const inner = parseSelect(embed[3])
      embeds.push({ table: embed[1], columns: inner.own, named: !!embed[2] })
      // A nested embed's own embeds are checked against their own table, recursively.
      embeds.push(...inner.embeds)
      return
    }
    // `alias:real_column` — the real column is the half that has to exist.
    const aliased = piece.includes(':') ? piece.split(':').pop().trim() : piece
    if (aliased && aliased !== '*' && /^\w+$/.test(aliased)) own.push(aliased)
  }
  for (const ch of select) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { flush(); continue }
    current += ch
  }
  flush()
  return { own, embeds }
}

/** Every .ts/.tsx under a directory, skipping node_modules and build output. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Find `.from('table')….select(<literal>)` pairs.
 *
 * The select is matched to the nearest PRECEDING .from in the same file, which is how these are
 * written everywhere in this codebase — a builder chain, occasionally split over several
 * statements (`let q = supabase.from(...)`, then `q = q.eq(...)`). A select whose column list is
 * a const rather than a literal is resolved through `const NAME = \`...\``.
 */
function findSelects(source, consts) {
  const found = []
  const re = /\.from\('(\w+)'\)|\.select\(\s*(`[\s\S]*?`|'[^']*'|[A-Z_][A-Z0-9_]*)\s*[,)]/g
  let table = null
  for (const m of source.matchAll(re)) {
    if (m[1]) { table = m[1]; continue }
    if (!table) continue
    let literal = m[2]
    if (/^[A-Z_][A-Z0-9_]*$/.test(literal)) {
      if (!consts.has(literal)) continue
      literal = consts.get(literal)
    } else {
      literal = literal.slice(1, -1)
    }
    // A count-only select passes 'id' plus options; still worth checking that column.
    found.push({ table, select: literal, index: m.index })
  }
  return found
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const schema = readSchema(readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8'))
const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'api'))]

const problems = []
const unknownTables = new Set()
let checked = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')

  /*
   * A column list held in a const, in either of the two ways this codebase writes one.
   *
   * THE SECOND FORM WAS MISSING AND COST REAL COVERAGE. Only backticked consts were resolved, so
   * a list written as single-quoted strings joined with + -- which is how `letterheads.ts` and
   * `firmSettings.ts` both write theirs -- fell through the `continue` in findSelects and was
   * never checked at all. Silently: the count went up by nothing and the suite stayed green,
   * which is the worst possible way for a check to not run. Found by putting a column that does
   * not exist into one of them and watching this file say PASS.
   */
  const consts = new Map()
  for (const [, name, body] of source.matchAll(/const ([A-Z_][A-Z0-9_]*)\s*=\s*`([\s\S]*?)`/g)) {
    consts.set(name, body)
  }
  for (const [, name, body] of source.matchAll(
    /const ([A-Z_][A-Z0-9_]*)\s*=\s*((?:'[^']*'\s*(?:\+\s*)?)+)/g)) {
    /* The pieces of `'a, b, ' + 'c'` joined back into one list. Nothing is inserted between them:
       the strings are already written with the separator inside them. */
    consts.set(name, [...body.matchAll(/'([^']*)'/g)].map((q) => q[1]).join(''))
  }

  for (const { table, select, index } of findSelects(source, consts)) {
    const line = source.slice(0, index).split('\n').length
    const where = `${relative(ROOT, file)}:${line}`
    const { own, embeds } = parseSelect(select)

    const check = (tableName, columns) => {
      const known = schema.get(tableName)
      if (!known) { unknownTables.add(tableName); return }
      for (const col of columns) {
        checked += 1
        if (!known.has(col)) problems.push(`${where}  ${tableName}.${col} does not exist`)
      }
    }

    check(table, own)
    for (const e of embeds) {
      check(e.table, e.columns)
      /*
       * An embed that does not name its constraint must have exactly one relationship to resolve
       * through. Two, and PostgREST refuses the entire request — which empties the page rather
       * than blanking a field, and does it at runtime with a green build behind it.
       */
      if (!e.named && schema.has(e.table)) {
        const n = relationships(table, e.table)
        if (n > 1) {
          problems.push(
            `${where}  ${table} -> ${e.table} embed is ambiguous: ${n} foreign keys between them.`
            + ` Name the constraint, e.g. ${e.table}!${table}_<column>_fkey ( ... )`,
          )
        }
      }
    }
  }
}

if (unknownTables.size > 0) {
  console.log(`note: not in schema.sql, so not checked — ${[...unknownTables].sort().join(', ')}`)
}

if (problems.length > 0) {
  console.error(`\nFAIL — ${problems.length} select(s) PostgREST would reject:\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('\nPostgREST rejects the WHOLE request for one bad column or ambiguous embed, so')
  console.error('each of these empties a page rather than blanking a field. Fix the name, or if')
  console.error('the column is real, add it to supabase/schema.sql — which is what this believes.\n')
  process.exit(1)
}

/*
 * A FLOOR ON WHAT WAS ACTUALLY LOOKED AT.
 *
 * Breaking findSelects's regex made this file print "PASS — 0 column references across 288 files
 * exist in schema.sql" and exit 0. A check that examines nothing passes every time, and it passes
 * loudest on the day somebody changes how selects are written -- which is precisely the day the
 * column references stop being checked.
 *
 * The number is a floor rather than an exact count, so adding a query does not fail the build;
 * it is set under the current total and only trips when the parser has plainly stopped finding
 * things. A suggested floor of 500 was once a guess that would have failed the build on the day
 * it was added, which is its own kind of broken check.
 *
 * RAISED FROM 250 TO 400, and the reason is a gap this number failed to catch. Column lists held
 * in single-quoted consts were never resolved at all -- two whole modules' worth -- and the total
 * sat at 355. Which cleared a floor of 250 comfortably, so nothing said a word. The floor guarded
 * "the parser found NOTHING"; it did not guard "the parser found less than it should". 400 is
 * under today's 464 and above that 355, so the same regression would now be caught.
 */
const FLOOR = 400
if (checked < FLOOR) {
  console.error(`\nFAIL — only ${checked} column references were found, which is fewer than the`)
  console.error(`${FLOOR} this codebase has. The select parser has stopped finding them, so the`)
  console.error('columns are no longer being checked at all.\n')
  process.exit(1)
}

/*
 * THE LINE run-all.mjs READS. A file that prints no count is counted as ZERO in the
 * headline and is indistinguishable from a healthy one -- a review of this suite found 20
 * files silent that way, about 800 assertion sites reported as nothing.
 */
console.log(`${checked} passed, 0 failed`)
console.log(
  `PASS — ${checked} column references across ${files.length} files exist in schema.sql,`
  + ' and every unnamed embed resolves through exactly one foreign key',
)
