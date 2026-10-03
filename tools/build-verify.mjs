import { build } from 'esbuild';

await build({
  entryPoints: ['verify-filings.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'verify-bundle.mjs',
  logLevel: 'info',
  alias: {
    '$app/environment': './tools/test-shims/app-environment.js',
    $lib: './src/lib'
  }
});
