# Offline layout harness

Renders components against the app's **real compiled stylesheet**, with the database stubbed
out, and measures whether anything sticks out of its container. It exists because two layout
bugs in this codebase — a menu 67px off the left of a phone screen, a details grid running off
its card — were found by *measuring* and would never have been found by looking.

```sh
npm run build          # REQUIRED FIRST — see below
node .qa-harness/build.mjs
node .qa-harness/shoot.mjs
```

Run BOTH builds, in that order, every time. `npm run build` regenerates the stylesheet;
`build.mjs` regenerates the bundle. Skip either and the two disagree — and the failure is silent
in both directions:

- **Stale stylesheet**: a newly added arbitrary class (`max-w-[32rem]`) is simply absent, so the
  component renders unstyled in that one respect.
- **Stale bundle**: the DOM still carries yesterday's class names, and Tailwind no longer emits
  rules for them, so the element falls back to whatever it had before. This one is nastier — it
  reported a column-alignment bug as still broken twenty minutes after it was fixed.

`npm run build` first is not optional. The harness links the stylesheet that build produces, and
Tailwind only emits a class it saw in the source *at build time*. A newly added arbitrary value
like `max-w-[32rem]` is simply absent from a stale CSS file, so the component renders unstyled in
that one respect and the measurement quietly lies. That happened while building the diary
picker: the cap read as "not working" until the CSS was rebuilt.

`dictate-drive.mjs` is a different kind of check: it installs a fake SpeechRecognition before the
page loads and plays a real dictation through it — interim words, a final phrase, a silence
timeout, more words, Stop. It exists because two dictation bugs were invisible in the source. The
words appearing beside the button instead of in the box is arguably a design mistake you could
spot by reading; a pause killing the session is not, because nothing in the file is wrong — Chrome
simply ends a session after a few seconds of quiet whatever `continuous` says. Only driving it
showed that.

`shoot.mjs` prints a table per `data-probe` box — its width, its scroll overflow, and the worst
left/right overhang of any descendant, naming the culprit's class. Anything non-zero is a bug.
It also reports console errors and writes a full-page PNG.

`diary-stub.ts` stands in for `src/lib/diary.ts` (swapped by an esbuild `onResolve` plugin in
`build.mjs`) so nothing reaches Supabase. Point `diary-preview.tsx` at whatever needs measuring.

## One expected console error

`file:///brand/raptor-mark.png` fails to load. That is the harness, not the app: the compiled CSS
references the brand mark as a **root-relative** URL (`/brand/raptor-mark.png`), which resolves
against `public/` when the app is served from `/` and against the filesystem root under `file://`.
The file is in the repo and loads fine in the real app. Ignore it; any *other* console error is
real.

## The stylesheet hash goes stale, again and again

`index.html` links a HASHED file out of `dist/`, and `npm run build` gives it a new name every
time the CSS content changes. Point it at the old one and the page renders completely unstyled —
which does not look like a broken link, it looks like a layout bug you are about to go and fix.
It has now cost two readings. Before shooting:

    ls -t dist/assets/*.css | head -1     # and put that filename in index.html

## Arbitrary Tailwind classes do not work in here

This directory is not scanned by Tailwind, so a class like `h-[280px]` or `[&_.fixed]:absolute`
written ONLY in a harness file is never emitted and silently does nothing. Use the plain CSS
block in index.html for harness-only layout, as `.reminder-probe` does.
