# The firm's 31 collector call scripts

What a collector says to a debtor on the telephone, out of `BF-Collector-CALL-SCRIPTS.docx`.
`source.txt` is the text of that document, kept here as the record of what was imported — the same
reason `scripts/letters/letters.json` exists. `build.mjs` turns it into `seed.sql`; the firm edits
the words in the Library from there on.

**A call script is never sent anywhere.** It is read off a screen by a person while a debtor is on
the line, which is what makes it different from every other template: it has to be on screen
before the collector speaks, already filled with this debtor's figures, and the collector must not
be able to end the call without recording what happened. `CallScriptPanel` is that, and
`src/lib/callScripts.ts` holds the rules it runs on.

**Each script is stored whole, not split into five columns.** The firm's brief asks for five parts
— spoken, directions, branches, capture, never — because the screen draws each differently.
`src/lib/callScriptParts.ts` reads them back out of the one text at render time instead, because
`body` is what the Library edits: five stored copies beside it go stale the first time somebody
fixes a typo. The parse is therefore **total** — every line lands in exactly one part and anything
unrecognised comes back in `unplaced` and is drawn on screen — for the same reason the letter
editor's parse is total. A parser that quietly swallowed a DO NOT line would take the one part of
a script that founds a complaint to the Council for Debt Collectors.

**The group headings end a block.** The document separates its seven groups with "B. The
collection workflow" and so on, and the last of them — "G. Answers to what they actually say" — is
not a script at all but sixteen objection answers. Cutting a block at the first heading rather
than trimming a trailing one is what keeps those sixteen out of `script-close-no-agreement`; they
live in `OBJECTIONS` in `callScripts.ts`, shown beside whichever script is open.

Run `node scripts/call-scripts/build.mjs` to regenerate. `check-call-scripts.mjs` holds the rules
and `check-call-script-parts.mjs` holds the parse, both against this directory rather than against
a database.
