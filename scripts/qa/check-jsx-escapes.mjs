/**
 * `—` IS A JAVASCRIPT ESCAPE AND JSX IS NOT JAVASCRIPT.
 *
 * In a string literal — 'a — b' — the compiler turns it into an em dash. In JSX text, and
 * in a JSX attribute written with quotes rather than braces, there is no string literal: the
 * characters are the value, and the six characters `—` go on the screen exactly as typed.
 *
 * THIS HAS NOW SHIPPED THREE TIMES, twice in a placeholder and once as a separator between a
 * deal's name and its contact, and every time the firm found it rather than a check. It is a
 * particularly bad failure to leave to a person: it typechecks, it lints, it renders, the tests
 * pass, and the only symptom is a line of gibberish on a screen somebody else is using.
 *
 * WHAT IS LEFT ALONE, because it is correct in all of them:
 *   - quoted string literals, template literals and regular expressions, where the escape works;
 *   - an attribute written with braces — placeholder={'a — b'} — which is a string literal;
 *   - comments, which is where most of the matches in this codebase live.
 *
 * So the scan is deliberately narrow: JSX text between tags, and quote-delimited attributes. A
 * check that flagged every `\u` in every .tsx file would be noise nobody reads — and CLAUDE.md
 * is explicit that a warning firing when nothing is wrong is worse than no warning at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const failures = []
const ok = (label, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(label)
}

function tsxFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full))
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const ESCAPE = /\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/

/**
 * Strip everything an escape is legal in, then look at what is left.
 *
 * ORDER MATTERS AND IT IS THE WHOLE TRICK: comments first (a comment may contain a quote, and
 * `// don't` would otherwise open a string that swallows the rest of the file), then template
 * literals, then quoted strings. What survives is JSX text, JSX attribute values written with
 * quotes, and code — and code cannot carry a bare `\u` outside a literal, so a match is real.
 */
function suspicious(code) {
  const hits = []
  /*
   * BLOCK COMMENTS ARE BLANKED OVER THE WHOLE FILE FIRST, not per line, and every newline inside
   * one is kept so the line numbers still point at the right place. This house style runs to
   * twenty-line block comments and they are where most of this codebase's `\u` sequences live --
   * a per-line stripper sees ` * an em dash is \u2014` with no `/*` on it and reports the comment.
   */
  const lines = code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const bare = lines[i]
      .replace(/\/\/.*$/, '')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
      /*
       * REGULAR EXPRESSIONS, which escape legally and are full of `\u00a0`. Only where one can
       * actually start — after an opening bracket, a comma, an operator — so that a division is
       * not mistaken for the opening of one and the rest of the line eaten with it.
       */
      .replace(/(^|[(,=:!&|?[\s])\/(?![/*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[a-z]*/g, '$1//')
      /*
       * QUOTED STRINGS, EXCEPT THE ONES THAT ARE JSX ATTRIBUTES -- and that exception is the
       * entire check. `const dash = '\u2014'` is a string literal and the escape works; but
       * `placeholder="\u2014"` has no literal in it at all, and those six characters are the
       * value. What tells them apart on one line is the space: an attribute is `name="..."`
       * with the quote hard against the equals, and an assignment is not.
       */
      .replace(/(.?)('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g,
        (whole, before, str) => (before === '=' ? whole : `${before}${str[0]}${str[0]}`))
    if (ESCAPE.test(bare)) hits.push({ line: i + 1, text: lines[i].trim() })
  }
  return hits
}

/*
 * THE CHECK ITSELF IS CHECKED FIRST. A scanner whose stripping is slightly too greedy reports
 * nothing on a whole codebase and reads exactly like a codebase with no bugs in it — which is
 * how an assertion like this passes for years while the thing it guards is broken. So it is run
 * over both shapes before it is trusted with the real files.
 */
const MUST_CATCH = [
  '        <span className="x">\\u00b7</span>',
  '          placeholder="A note \\u2014 optional"',
  '          <p>Signing\\u2026</p>',
  '          title="Bredell\\u2019s book" />',
  '          {n} accounts \\u2014 none worked',
]
const MUST_IGNORE = [
  "          const dash = 'a \\u2014 b'",
  '          const dash = `a \\u2014 ${b}`',
  "          <input placeholder={'a \\u2014 b'} />",
  '          // the em dash is \\u2014 and it works in a string',
  "          .replace(/\\u00a0/g, ' ')",
  /* Real lines out of this codebase, so a stripper that is too greedy or too shy is caught by
     the shapes actually written here rather than by ones invented for the check. */
  "  return from === null ? 'From \\u2014' : `From ${money(from)}`",
  "    hint: 'Every payment, and Swordfish\\u2019s own balance.',",
  "    const blob = new Blob(['\\uFEFF', csv], { type: 'text/csv' })",
  "        value={deal.service ?? '\\u2014'}",
  '        {unread > 0 ? `Unread \\u00b7 ${unread}` : \'Unread\'}',
  '  /* A comment may say \\u2014 and hold an apostrophe: don\'t be fooled. */',
  '  /*\n   * And it may run over lines, saying \\u2014 on one of them.\n   */',
]
for (const line of MUST_CATCH) {
  ok(`the scanner catches: ${line.trim()}`, suspicious(line).length === 1)
}
for (const line of MUST_IGNORE) {
  ok(`the scanner leaves alone: ${line.trim()}`, suspicious(line).length === 0)
}

/* ---------- and now the real thing ---------- */

const found = []
for (const file of tsxFiles('src')) {
  for (const hit of suspicious(readFileSync(file, 'utf8'))) {
    found.push(`${file}:${hit.line}  ${hit.text}`)
  }
}
/* Listed rather than counted: the point of this check is to say WHERE, because the fix is to
   type the character itself and somebody has to find the line to do it. */
ok(`no \\uXXXX escape is sitting in JSX, where it prints as itself${
  found.length ? `\n      ${found.join('\n      ')}` : ''}`, found.length === 0)

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A \\uXXXX escape works in a string literal and prints as six characters in JSX text or in a quoted
attribute. It has shipped three times and the firm found it every time, because it typechecks,
lints, renders and tests clean. The scanner is checked against both shapes before it is believed.`)
