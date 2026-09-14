/** Bundles the preview, swapping src/lib/diary.ts for a stub so nothing reaches a database. */
import * as esbuild from 'esbuild'
import path from 'node:path'

const stub = {
  name: 'stub-diary',
  setup(build) {
    build.onResolve({ filter: /lib\/diary\.ts$/ }, (args) => (
      // The stub re-exports the real module, so its own import must not resolve to itself.
      args.importer.includes('diary-stub')
        ? null
        : { path: path.resolve('.qa-harness/diary-stub.ts') }
    ))
    // The bar reads the signed-in user; the real context would reach for Supabase.
    build.onResolve({ filter: /store\/AuthContext$/ }, () => ({
      path: path.resolve('.qa-harness/auth-stub.ts'),
    }))
    // The row reads the client's name out of the store, which would otherwise load the whole app.
    build.onResolve({ filter: /store\/AppStore$/ }, () => ({
      path: path.resolve('.qa-harness/store-stub.ts'),
    }))
    build.onResolve({ filter: /store\/ThemeContext$/ }, () => ({
      path: path.resolve('.qa-harness/theme-stub.ts'),
    }))
    // The reminder popup would otherwise poll Supabase every thirty seconds from the harness.
    build.onResolve({ filter: /lib\/reminders\.ts$/ }, (args) => (
      args.importer.includes('reminders-stub')
        ? null
        : { path: path.resolve('.qa-harness/reminders-stub.ts') }
    ))
  },
}

await esbuild.build({
  entryPoints: ['.qa-harness/diary-preview.tsx'],
  bundle: true,
  outfile: '.qa-harness/bundle.js',
  jsx: 'automatic',
  plugins: [stub],
  define: {
    'process.env.NODE_ENV': '"development"',
    // The app reads Vite's env at module scope; give it something so importing the
    // supabase client does not throw during an offline render.
    'import.meta.env.VITE_SUPABASE_URL': '"http://localhost"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"offline"',
    'import.meta.env.MODE': '"development"',
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
  },
  logLevel: 'info',
})
