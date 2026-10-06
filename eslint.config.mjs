import js from '@eslint/js'

/**
 * Two environments live in this repo and they do not share globals.
 *
 * The linter was previously configured with one hand-written list that named only the
 * handful of globals someone happened to hit, so every genuine mistake had to be read
 * out of a pile of false "not defined" errors. That is exactly how a real one — an
 * undefined `transferFiles` in the composition root, which would have thrown on the
 * first copy/paste in the shipped app — stayed hidden. The two blocks below name the
 * environment each file actually runs in.
 */

/** Globals available everywhere in Node, including Electron's main process. */
const nodeGlobals = {
  process: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  URL: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly'
}

/** Globals available in the renderer, which is a browser page. */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  Image: 'readonly',
  Audio: 'readonly',
  getComputedStyle: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  Blob: 'readonly',
  fetch: 'readonly'
}

export default [
  js.configs.recommended,
  {
    // Main process, adapters, use cases, preload, domain rules and the tests: all Node.
    files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
    ignores: ['src/renderer/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  },
  {
    // The renderer runs in Chromium, so it has the browser's globals and not Node's.
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  },
  { ignores: ['dist/**', 'node_modules/**'] }
]
