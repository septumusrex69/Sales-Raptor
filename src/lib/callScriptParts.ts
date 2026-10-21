/**
 * A CALL SCRIPT, READ BACK OUT OF THE ONE BLOCK OF TEXT THE LIBRARY STORES.
 *
 * THE FIRM'S BRIEF ASKS FOR FIVE PARTS, because the screen draws each of them differently and a
 * collector is reading it with a debtor already talking:
 *
 *   spoken      the lines they read      large, high contrast -- this is where the eye goes
 *   directions  the lines in brackets    smaller, italic, visually distinct, NEVER read aloud
 *   branches    "if they say X, say Y"   collapsed, one tap to open
 *   capture     what must be recorded    drives the disposition the call cannot close without
 *   never       what must not be said    always visible, red, cannot be collapsed
 *
 * THE BRIEF SAYS TO STORE THEM AS FIVE COLUMNS AND THIS PARSES THEM INSTEAD. The reason is the
 * library: a template's `body` is what the firm edits in the Library screen, and five stored
 * columns beside it are five copies that go stale the first time somebody fixes a typo in the
 * words. This codebase has been bitten by exactly that shape -- firmSettings keeps five lists of
 * one thing and needs a QA script to hold them together. One text, parsed, cannot drift from
 * itself. What the brief actually asks for is that the SCREEN render the five parts differently,
 * and it does.
 *
 * SO THE PARSE MUST BE TOTAL, which is the same rule the letter editor runs on (see
 * documentHtmlToBlocks in CLAUDE.md): every line of the script lands in exactly one part, and
 * anything this does not recognise comes back in `unplaced` rather than being dropped. A script
 * is the firm's words on a regulated call. A parser that quietly swallowed a DO NOT line would
 * take the one part of it that founds a complaint to the Council for Debt Collectors.
 *
 * PURE, AND WITH NO IMPORTS AT ALL, so the QA scripts can hold it and so the seed generator and
 * the panel read a script the same way.
 */

/** A piece of a spoken line: words to say, or an instruction in brackets that is never said. */
export type Run =
  | { kind: 'say'; text: string }
  | { kind: 'direction'; text: string }

export interface ScriptLine {
  runs: Run[]
}

/** One "if they say X, say Y". */
export interface Branch {
  /** What the debtor said. The firm writes these as the debtor's own words. */
  heard: string
  /** What the collector says back. May itself carry a bracketed direction. */
  reply: ScriptLine
}

export interface CallScript {
  /** The header facts off the document. Null where that script does not carry one. */
  goesTo: string | null
  workflowDay: string | null
  popsUp: string | null
  goal: string | null
  spoken: ScriptLine[]
  branches: Branch[]
  capture: string[]
  never: string[]
  /**
   * EVERY LINE THE PARSE COULD NOT PLACE. Empty on a well-formed script.
   *
   * NOT AN ERROR AND NOT A SILENCE. The panel draws these at the bottom under their own heading,
   * because a line of the firm's script that this file does not understand is still a line the
   * collector may need -- and showing it is how somebody notices the parser needs teaching.
   */
  unplaced: string[]
}

/* The headings the firm uses, as they appear in the document. Matched on the whole line, case
   folded, so a heading that happens to appear inside a sentence is not one. */
const HEADINGS = {
  'goes to': 'goesTo',
  'workflow day': 'workflowDay',
  'pops up': 'popsUp',
  'goal of the call': 'goal',
  'what the collector says': 'spoken',
  'if they say': 'branches',
  'capture on the account': 'capture',
  'do not': 'never',
  /* Present in the document and carries nothing: every one of these is a call script, which is
     what the library's own `kind` column says. Recognised so it does not land in `unplaced`. */
  kind: 'skip',
  'call script': 'skip',
} as const

/* What an unrecognised heading switches the parse to. Its lines are kept, in `unplaced`. */
type Unknown = 'unknown'

type Section = typeof HEADINGS[keyof typeof HEADINGS] | Unknown

/**
 * SPLIT A LINE INTO WORDS AND INSTRUCTIONS.
 *
 * THE BRACKETS ARE THE DOCUMENT'S OWN MARKUP -- the brief: "the square brackets in the document
 * mark the direction lines. Parse on them at import." A whole line can be an instruction
 * ("[Pause. Let them answer. Do not fill the silence.]") and an instruction can also sit at the
 * end of a sentence the collector reads ("...the moment you have paid. [Capture PIF pending.]").
 * Both have to be drawn differently from the words, so this splits rather than classifying whole
 * lines: otherwise half the sentence is read aloud and the instruction with it.
 *
 * AN UNCLOSED BRACKET IS WORDS. A script with a stray "[" in it must not turn the rest of the
 * notice into an instruction nobody reads aloud -- the same reasoning as the letter parser's
 * closed tag set, and the cheaper failure of the two.
 */
export function splitRuns(line: string): Run[] {
  const runs: Run[] = []
  let rest = line
  for (;;) {
    const open = rest.indexOf('[')
    if (open === -1) break
    const close = rest.indexOf(']', open + 1)
    if (close === -1) break
    const before = rest.slice(0, open).trim()
    if (before) runs.push({ kind: 'say', text: before })
    const inside = rest.slice(open + 1, close).trim()
    if (inside) runs.push({ kind: 'direction', text: inside })
    rest = rest.slice(close + 1)
  }
  const tail = rest.trim()
  if (tail) runs.push({ kind: 'say', text: tail })
  return runs
}

/** Is every run on this line an instruction? Then nothing on it is said out loud. */
export function isAllDirection(line: ScriptLine): boolean {
  return line.runs.length > 0 && line.runs.every((r) => r.kind === 'direction')
}

/** The words of a line, instructions dropped — what a collector actually reads aloud. */
export function spokenText(line: ScriptLine): string {
  return line.runs.filter((r) => r.kind === 'say').map((r) => r.text).join(' ')
}

/* A capture or DO-NOT line arrives bulleted in the document. The bullet is the document's, not
   the firm's words, so it is taken off rather than drawn twice beside a list marker. */
const bullet = (s: string) => s.replace(/^[—–\-•*]+\s*/, '').trim()

/**
 * Read a script back out of its stored text.
 *
 * ONE PASS, HEADING BY HEADING. A line is whatever the last heading said it was, and a line with
 * no heading above it is `unplaced` -- which is how a script pasted in without its WHAT THE
 * COLLECTOR SAYS heading shows up as a problem on screen instead of as an empty panel.
 */
export function parseCallScript(text: string): CallScript {
  const out: CallScript = {
    goesTo: null, workflowDay: null, popsUp: null, goal: null,
    spoken: [], branches: [], capture: [], never: [], unplaced: [],
  }
  let section: Section | null = null
  /* The half of a branch already read. The document writes them as two lines: what the debtor
     said, then what to say back. */
  let heard: string | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = HEADINGS[line.toLowerCase() as keyof typeof HEADINGS]
    if (heading) {
      section = heading
      /* A new heading ends an unfinished branch rather than carrying it into the next section. */
      if (heading !== 'branches') heard = null
      continue
    }
    /*
     * A HEADING THIS FILE DOES NOT KNOW STILL ENDS THE PART ABOVE IT.
     *
     * THE DOCUMENT SHOUTS ITS SECTION HEADINGS -- "WHAT THE COLLECTOR SAYS", "IF THEY SAY",
     * "CAPTURE ON THE ACCOUNT", "DO NOT" -- so a line in capitals that is not one of them is a
     * section somebody has added, and its lines are not a continuation of the last one.
     *
     * WHY THAT MATTERS MORE THAN IT LOOKS. Left as a continuation, a new section called
     * "WHAT TO LISTEN FOR" would have its lines drawn as WORDS THE COLLECTOR READS ALOUD, on a
     * recorded call, to a debtor. Treated as unknown they land in `unplaced` and the panel draws
     * them under "Also on this script", which is visible and harmless. Of the two ways to be
     * wrong about a line nobody has taught this parser, only one of them says something untrue to
     * a debtor.
     *
     * CAPITALS, TWO WORDS, AND NO BULLET -- all three, and each is there because of a line in the
     * firm's own scripts that the first cut of this rule got wrong.
     *
     *   NO BULLET, because a capture line IS a disposition code: "—  EXEC", "—  TPC", "—  VM".
     *   Capitals alone read every one of those as a new section and threw the rest of the capture
     *   list away.
     *
     *   TWO WORDS, because a bare "EXEC" with the bullet stripped by an editor is still a capture
     *   line and not a heading. Every heading the document uses is two words or more.
     *
     * None of the firm's 31 scripts has a spoken line in capitals, and check-call-script-parts
     * holds all of this the only way worth holding it: by asserting `unplaced` is empty and the
     * five parts are present on every one of them.
     */
    if (/[A-Z]/.test(line) && !/[a-z]/.test(line) && /\s/.test(line) && !/^[—–\-•*]/.test(line)) {
      section = 'unknown'
      heard = null
      continue
    }
    switch (section) {
      case 'goesTo': out.goesTo ??= line; break
      case 'workflowDay': out.workflowDay ??= line; break
      case 'popsUp': out.popsUp ??= line; break
      case 'goal': out.goal ??= line; break
      case 'spoken': out.spoken.push({ runs: splitRuns(line) }); break
      case 'branches':
        if (heard === null) { heard = stripQuotes(line) } else {
          out.branches.push({ heard, reply: { runs: splitRuns(line) } })
          heard = null
        }
        break
      case 'capture': out.capture.push(bullet(line)); break
      case 'never': out.never.push(bullet(line)); break
      case 'skip': break
      /*
       * NO HEADING YET, OR ONE THIS FILE DOES NOT KNOW. Kept, not dropped -- see `unplaced`.
       * The heading line itself is not kept, because an unknown heading with its lines under it
       * reads as a heading on the screen regardless of what this called it.
       */
      default: out.unplaced.push(line)
    }
  }
  /*
   * A BRANCH WITH NOTHING TO SAY BACK IS STILL SOMETHING THE DEBTOR SAID. Dropping it would lose
   * the one line a collector is looking for while being asked that exact question.
   */
  if (heard !== null) out.unplaced.push(heard)
  return out
}

/* The document puts the debtor's words in curly quotes on some branches and not on others. Taken
   off so the panel can draw them its own way rather than drawing somebody else's quotation marks
   inside its own. */
function stripQuotes(s: string): string {
  return s.replace(/^[“"'‘]+/, '').replace(/[”"'’]+$/, '').trim()
}

/**
 * EVERY MERGE FIELD IN A SCRIPT, wherever it sits.
 *
 * READ OFF THE PARSED SCRIPT RATHER THAN THE RAW TEXT, so a field in a DO NOT line or inside a
 * branch counts exactly as one in the spoken words does. The panel has to fill all of them before
 * it opens: the brief is blunt about why -- "a collector reading {{balance}} aloud off the screen
 * is the failure this is meant to prevent".
 */
export function fieldsInScript(script: CallScript): string[] {
  const found = new Set<string>()
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) found.add(m[1])
  }
  for (const key of ['goesTo', 'workflowDay', 'popsUp', 'goal'] as const) {
    if (script[key]) scan(script[key] as string)
  }
  for (const l of script.spoken) for (const r of l.runs) scan(r.text)
  for (const b of script.branches) {
    scan(b.heard)
    for (const r of b.reply.runs) scan(r.text)
  }
  for (const s of script.capture) scan(s)
  for (const s of script.never) scan(s)
  for (const s of script.unplaced) scan(s)
  return [...found]
}

/**
 * WHICH OF THEM THIS ACCOUNT CANNOT ANSWER.
 *
 * SHOWN IN RED AS THE FIELD'S OWN NAME, at the firm's asking: "if a field is empty, show the field
 * name in red rather than an empty space." A blank in the middle of a sentence is a sentence the
 * collector reads straight past -- "the balance that has been handed to us is." -- and then has to
 * invent a number on a recorded call.
 */
export function unanswered(script: CallScript, values: Record<string, string>): string[] {
  return fieldsInScript(script).filter((k) => !(values[k] ?? '').trim())
}

/**
 * A LINE BROKEN INTO WHAT IS FILLED AND WHAT IS NOT.
 *
 * THE FIRM: "everything is merge-filled before the panel opens. A collector reading {{balance}}
 * aloud off the screen is the failure this is meant to prevent. If a field is empty, show the
 * field name in red rather than an empty space."
 *
 * SO THE BRACES ARE NOT LEFT STANDING AND THE GAP IS NOT LEFT EMPTY -- both of those get read
 * out. A field with no answer becomes a marked gap that says what is missing, which is the one
 * version a collector stops at instead of reading past.
 *
 * NOT renderTemplate, WHICH IS FOR THINGS THAT ARE SENT. That one removes an optional field and
 * its line, and reports what is missing afterwards -- right for an SMS priced per segment, wrong
 * here: a script is not measured, and a line silently removed from a script is a line the
 * collector never knew they were meant to say.
 */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'missing'; field: string }

export function mergeSegments(text: string, values: Record<string, string>): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const m of text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    const start = m.index ?? 0
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) })
    const value = (values[m[1]] ?? '').trim()
    if (value) out.push({ kind: 'text', text: value })
    else out.push({ kind: 'missing', field: m[1] })
    at = start + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}
