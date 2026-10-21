/**
 * The words out of an UNCOMPRESSED PDF, without a PDF library.
 *
 * WHY THIS EXISTS. pdf.js reads these files perfectly in Chromium and threw
 * "undefined is not a function" inside its own minified code on the firm's iPads — twice, once on
 * its default build and once on the legacy build with the polyfills compiled in. The firm works
 * this app on iPads. A reader that only runs on the machine nobody uses is not a reader.
 *
 * And it turns out not to be needed for these files. Every trace the bureau has produced so far
 * carries its content streams UNCOMPRESSED — not one FlateDecode across seven real reports — so
 * the words are sitting in the file as plain text between `stream` and `endstream`, and getting
 * them out is string work. No worker, no WebAssembly, no polyfill, nothing for a browser to
 * disagree about.
 *
 * NOT A PDF PARSER, AND MUST NOT GROW INTO ONE. It reads text-showing operators out of
 * uncompressed streams and nothing else. A PDF with compressed streams returns nothing at all,
 * which is the signal for the caller to fall back to pdf.js — see pdfText.ts. Trying to cover
 * every PDF here would be rewriting pdf.js badly.
 */

/**
 * A PDF string literal, with the escapes the spec allows.
 *
 * Octal is the one that matters in practice: the bureau writes a non-breaking space as \240 and a
 * bullet as \225, and left raw those turn into stray characters in the middle of a company name.
 */
function unescapePdfString(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]
    if (c !== '\\') { out += c; continue }
    const next = raw[i + 1]
    if (next === undefined) break
    /* \ddd — up to three octal digits, and fewer is legal. */
    if (next >= '0' && next <= '7') {
      let digits = ''
      while (digits.length < 3 && raw[i + 1] >= '0' && raw[i + 1] <= '7') {
        digits += raw[i + 1]
        i += 1
      }
      out += String.fromCharCode(parseInt(digits, 8))
      continue
    }
    i += 1
    if (next === 'n') { out += '\n'; continue }
    if (next === 'r') { out += '\r'; continue }
    if (next === 't') { out += '\t'; continue }
    if (next === 'b') { out += '\b'; continue }
    if (next === 'f') { out += '\f'; continue }
    /* A backslash before a newline is a line continuation: both disappear. */
    if (next === '\n') continue
    if (next === '\r') { if (raw[i + 1] === '\n') i += 1; continue }
    /* \( \) \\ and anything else: the character stands for itself. */
    out += next
  }
  return out
}

/** <48656c6c6f> — the other way a PDF can write a string. */
function fromHexString(hex: string): string {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '')
  let out = ''
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
  }
  /* An odd digit count means the last byte is padded with a zero, per the spec. */
  if (clean.length % 2 === 1) out += String.fromCharCode(parseInt(clean.slice(-1) + '0', 16))
  return out
}

/**
 * Every string literal inside one bracketed TJ array, joined.
 *
 * `[(He) -20 (llo)] TJ` is ONE run of text that a PDF writer split to nudge the kerning. Split
 * into two tokens it becomes two table cells, and the reader downstream counts columns.
 */
function tjArray(body: string): string {
  let out = ''
  const re = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]*)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    out += m[1] !== undefined ? unescapePdfString(m[1]) : fromHexString(m[2] ?? '')
  }
  return out
}

/**
 * The bytes as one character-per-byte string.
 *
 * TextDecoder('latin1') maps every byte to the code point of the same value, which is what makes
 * the regex work byte-for-byte on a file that is part text and part binary. Decoding as UTF-8
 * would mangle the binary and, worse, silently shift the offsets of everything after it.
 */
function asLatin1(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  try {
    return new TextDecoder('latin1').decode(bytes)
  } catch {
    /* No latin1 label: build it by hand, in chunks, because apply() on 200k arguments throws. */
    let out = ''
    for (let i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode(...bytes.subarray(i, i + 8192))
    }
    return out
  }
}

/**
 * Text runs in the order the file draws them.
 *
 * Returns an empty list for a PDF this cannot read — compressed streams, or a scan with no text
 * in it at all. Empty is the caller's signal to try something else; it never guesses.
 */
export function plainPdfTokens(data: ArrayBuffer): string[] {
  const text = asLatin1(data)
  const tokens: string[] = []

  /*
   * Streams in file order. That ordering is what gives the tokens their reading order, which the
   * whole of traceProfile depends on — it reads label-then-value down the page.
   */
  const streams = /stream\r?\n?([\s\S]*?)endstream/g
  let s: RegExpExecArray | null
  while ((s = streams.exec(text)) !== null) {
    const body = s[1]
    /*
     * A CHEAP SKIP, NOT A GUARD. A stream with no text operator in it has nothing for the regex
     * below to find either — this just avoids running that regex across a two-megabyte embedded
     * font on every upload. Correctness comes from the operator regex itself.
     */
    if (!/\bTJ\b|\bTj\b/.test(body)) continue

    /*
     * The three ways a page shows text: Tj, TJ, and the quote operators that move to the next
     * line first. Matched in one pass so their order on the page is preserved.
     */
    const ops = /\[((?:\\.|[^\\\][])*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]*)>\s*Tj/g
    let m: RegExpExecArray | null
    while ((m = ops.exec(body)) !== null) {
      const piece = m[1] !== undefined ? tjArray(m[1])
        : m[2] !== undefined ? unescapePdfString(m[2])
          : fromHexString(m[3] ?? '')
      /*
       * TRIMMED, AND OTHERWISE LEFT ALONE. Deciding a run is empty needs a trim; changing what is
       * inside it does not belong here. Every other normalisation — non-breaking spaces, the runs
       * of padding the bureau puts between its columns — happens once in parseTrace, so this
       * reader and pdf.js cannot hand it two different versions of the same document.
       */
      const trimmed = piece.trim()
      if (trimmed) tokens.push(trimmed)
    }
  }
  return tokens
}
