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

`npm run build` first is not optional. The harness links the stylesheet that build produces, and
Tailwind only emits a class it saw in the source *at build time*. A newly added arbitrary value
like `max-w-[32rem]` is simply absent from a stale CSS file, so the component renders unstyled in
that one respect and the measurement quietly lies. That happened while building the diary
picker: the cap read as "not working" until the CSS was rebuilt.

`shoot.mjs` prints a table per `data-probe` box — its width, its scroll overflow, and the worst
left/right overhang of any descendant, naming the culprit's class. Anything non-zero is a bug.
It also reports console errors and writes a full-page PNG.

`diary-stub.ts` stands in for `src/lib/diary.ts` (swapped by an esbuild `onResolve` plugin in
`build.mjs`) so nothing reaches Supabase. Point `diary-preview.tsx` at whatever needs measuring.
