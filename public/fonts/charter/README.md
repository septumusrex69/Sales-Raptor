# Charter

The face the firm's notices are set in. Matthew Carter's Charter, in the four Type 1 outlines
Bitstream contributed to the X Consortium — the same fonts Debian ships as `xfonts-scalable` and
the ones the firm's own section 129 examples are typed in.

**Why the repertoire matters more than the look.** `letterPdf` draws a notice in the fourteen
standard PDF faces, which every reader already has, so nothing is embedded. Charter is not one of
the fourteen, so choosing it means embedding a font in every letter — and a font this repo has to
ship, publicly. The licence in `LICENCE.txt` grants exactly that: "use, copy, modify, sublicense,
sell, and redistribute … for any purpose and without restriction", provided the notice travels
with the files and the trademark is acknowledged. That is why the notice is checked in beside
them and must stay there.

**Two formats of the same outlines, and that is deliberate.** The `.woff2` files are what the
editor's sheet is typed in; the `.ttf` files are what pdf-lib embeds, because a WOFF2 is a Brotli
container pdf-lib cannot open. The `.ttf` files were produced by decompressing these exact
`.woff2` files, so the two cannot disagree about a glyph. Replacing one without the other is how
the page and the paper start to differ.

Source: `charter-webfont@4.1.0` (npm), which packages the X Consortium fonts unmodified.

**Three characters Charter does not have**, all three declared in `src/lib/charter.ts` and held
there by `check-charter.mjs`: the non-breaking space (drawn as an ordinary space — it is one),
the soft hyphen (already dropped before it reaches a PDF), and the euro (reported, because a
currency symbol is a word). Every other character Windows-1252 can write, Charter can draw.
