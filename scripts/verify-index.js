#!/usr/bin/env node
'use strict'

/**
 * Integration check: build a real index over a real temp directory and search it.
 *
 * The unit tests use in-memory fixtures, which proves the matching rules but NOT that
 * the walker, the content reader and the store fit together. This runs the actual
 * pipeline on disk: create files, walk them, persist, reload, search.
 *
 * Usage: node scripts/verify-index.js
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { createIndexBuilder } = require('../src/application/build-index')
const { searchIndex } = require('../src/application/search-index')
const { createFsIndexWalker } = require('../src/adapters/fs-index-walker')
const { createJsonIndexStore } = require('../src/adapters/json-index-store')

const failures = []

function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${label}  ${detail}`)
  if (!condition) failures.push(label)
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ffw-index-'))
  const dataDir = path.join(root, '_appdata')

  // A tree with: a name hit, a content-only hit, an excluded folder, a binary file,
  // and a deep file, so every rule has something real to act on.
  await fsp.mkdir(path.join(root, 'Documents'), { recursive: true })
  await fsp.mkdir(path.join(root, 'Videos'), { recursive: true })
  await fsp.mkdir(path.join(root, 'app', 'node_modules', 'left-pad'), { recursive: true })
  await fsp.mkdir(path.join(root, 'Documents', 'deep', 'deeper'), { recursive: true })

  await fsp.writeFile(path.join(root, 'shot-list-final.txt'), 'a list of shots')
  await fsp.writeFile(
    path.join(root, 'Documents', 'meeting-notes.md'),
    '# Meeting\n\nWe reviewed the shot list and agreed on the schedule.\n'
  )
  await fsp.writeFile(path.join(root, 'Documents', 'deep', 'deeper', 'buried.txt'), 'deeply buried treasure')
  await fsp.writeFile(path.join(root, 'app', 'node_modules', 'left-pad', 'index.js'), 'shot list in a dependency')
  // A NUL byte in the first block means binary: it must be indexed by name only.
  await fsp.writeFile(path.join(root, 'Videos', 'clip.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x73, 0x68, 0x6f, 0x74]))

  const store = createJsonIndexStore({ dataDir })
  const builder = createIndexBuilder({ walker: createFsIndexWalker() })

  const progressEvents = []
  const result = await builder.run([root], {
    onProgress: (progress) => progressEvents.push(progress)
  })

  check('the scan reports progress while it runs', progressEvents.length > 2, `${progressEvents.length} events`)
  check('the scan ends with a done report', progressEvents.at(-1)?.done === true)
  check('the scan found the files', result.records.length >= 4, `${result.records.length} records`)

  const names = result.records.map((r) => r.name).sort()
  check('node_modules is skipped', !names.includes('index.js'), names.join(', '))
  check('a deeply nested file is still found', names.includes('buried.txt'), names.join(', '))

  const binary = result.records.find((r) => r.name === 'clip.bin')
  check('a binary file keeps its name and gets no content', binary && binary.contentTokens === null)

  const notes = result.records.find((r) => r.name === 'meeting-notes.md')
  check('a text file has its contents read', Array.isArray(notes?.contentTokens) && notes.contentTokens.length > 0)

  // Persist, then read back from disk — the store is the part fixtures never touch.
  await store.write(result.records, result.stats)
  const reloaded = await store.read()
  check('the index round-trips through the file', reloaded.records.length === result.records.length, `${reloaded.records.length}`)
  check('the saved scan stats survive', reloaded.stats?.files === result.stats.files)

  // Now search the REAL persisted index.
  const byName = await searchIndex({ store }, { text: 'shot list', scope: 'everywhere' })
  check(
    'a two-word query finds the file by name',
    byName.results.some((r) => r.name === 'shot-list-final.txt' && r.matched === 'name'),
    JSON.stringify(byName.results.map((r) => `${r.name}:${r.matched}`))
  )
  check(
    'the same query also finds the file whose CONTENTS mention it',
    byName.results.some((r) => r.name === 'meeting-notes.md' && r.matched === 'content'),
    JSON.stringify(byName.results.map((r) => `${r.name}:${r.matched}`))
  )
  check('a name hit ranks above a content hit', byName.results[0].matched === 'name')

  const scoped = await searchIndex({ store }, { text: 'buried', scope: 'folder', folder: path.join(root, 'Documents') })
  check('folder scope finds a nested file under that folder', scoped.results.length === 1, JSON.stringify(scoped.results.map((r) => r.name)))

  const excluded = await searchIndex({ store }, { text: 'left-pad', scope: 'everywhere' })
  check('a skipped folder is genuinely absent from search', excluded.results.length === 0, JSON.stringify(excluded.results.map((r) => r.name)))

  const excludedTerm = await searchIndex({ store }, { text: 'shot -agreed', scope: 'everywhere' })
  check(
    'excluding a term drops the content hit that contains it',
    !excludedTerm.results.some((r) => r.name === 'meeting-notes.md'),
    JSON.stringify(excludedTerm.results.map((r) => r.name))
  )

  const binaryByName = await searchIndex({ store }, { text: 'clip', scope: 'everywhere' })
  check('a binary file is still findable by name', binaryByName.results.some((r) => r.name === 'clip.bin'))

  // The scan must survive an unreadable folder rather than dying.
  const locked = path.join(root, 'locked')
  await fsp.mkdir(locked)
  fs.chmodSync(locked, 0o000)
  const survived = await builder.run([root], {})
  fs.chmodSync(locked, 0o755)
  check('an unreadable folder does not end the scan', survived.records.length >= 5, `${survived.records.length}`)

  await fsp.rm(root, { recursive: true, force: true })

  console.log()
  console.log('FAILURES:', failures.length ? failures : 'none')
  process.exit(failures.length ? 1 : 0)
}

main().catch((error) => {
  console.error('verify-index crashed:', error)
  process.exit(1)
})
