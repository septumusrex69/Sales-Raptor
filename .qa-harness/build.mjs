/** Bundles the preview, swapping src/lib/diary.ts for a stub so nothing reaches a database. */
import * as esbuild from 'esbuild'
import path from 'node:path'

const stub = {
  name: 'stub-diary',
  setup(build) {
    build.onResolve({ filter: /lib\/diary\.ts$/ }, () => ({
      path: path.resolve('.qa-harness/diary-stub.ts'),
    }))
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
