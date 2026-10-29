/**
 * SQL WITH ITS COMMENTS TAKEN OUT, READ IN ORDER (S15).
 *
 * The checks used to strip `--` comments first and `/* *\/` comments second, because a line comment once
 * mentioned the path /api/email/* and that `/*` opened a block that ran a thousand lines. The order fixed
 * that and made the opposite case: a BLOCK comment with " -- " in its prose ("if -- and only if -- the
 * ticket is this client's") lost its closing `*\/` to the first pass, and then ran to the next `*\/` in the
 * file -- which, the day one was appended (portal_handovers), swallowed every statement in between and a
 * check reported a live column missing.
 *
 * One pass, the way Postgres reads it: inside a block comment `--` means nothing; inside a line comment
 * `/*` means nothing; inside a quoted string neither does. Dollar-quoted bodies are read as code, because
 * the comments in a function body are comments too.
 */
export function stripSqlComments(sql) {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      out += ' '
      continue
    }
    if (c === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") break
        j += 1
      }
      out += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    out += c
    i += 1
  }
  return out
}
