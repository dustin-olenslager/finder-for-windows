'use strict'

/**
 * The folder watcher, with the drive that broke it modelled explicitly.
 *
 * The bug this file pins: on a Google Drive virtual drive `fs.watch` succeeds and then
 * never fires, so a new file only appeared after navigating away and back. A test that
 * only exercises a working `fs.watch` would have passed on the broken code, so the fake
 * filesystem here includes a watcher that is a complete no-op — exactly like the real one
 * on that drive.
 */

const test = require('node:test')
const assert = require('node:assert')

const { createFolderWatcher } = require('../src/infrastructure/folder-watcher')

/** A directory that exists only in memory, plus watchers that may or may not fire. */
function fakeFs({ files = [], watchWorks = true } = {}) {
  const tree = new Map()
  for (const [dir, entries] of Object.entries(files)) {
    tree.set(dir, new Set(entries))
  }

  const watchers = []
  const fake = {
    tree,
    /** Pretend a file was created in a folder. */
    add(dir, name) {
      tree.get(dir).add(name)
    },
    /** Pretend a file was deleted. */
    remove(dir, name) {
      tree.get(dir).delete(name)
    },
    /** Fire every live watcher, as a real filesystem would. */
    emit() {
      for (const w of watchers) w.callback()
    },
    liveWatchers() {
      return watchers.filter((w) => !w.closed).length
    },
    watch(dir, _options, callback) {
      const record = { dir, callback, closed: false }
      watchers.push(record)
      return {
        close: () => {
          record.closed = true
        },
        on: () => {}
      }
    },
    promises: {
      async readdir(dir) {
        const entries = tree.get(dir)
        if (!entries) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return [...entries].map((name) => ({
          name,
          isDirectory: () => name.endsWith('/')
        }))
      }
    }
  }

  // The Google Drive case: the watcher is created and simply never fires. Modelled by
  // never invoking its callback — which is precisely what the real drive does.
  if (!watchWorks) {
    const realWatch = fake.watch
    fake.watch = (dir, options, callback) => {
      const handle = realWatch(dir, options, callback)
      return handle
    }
  }

  return fake
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

test('a new file is noticed even when fs.watch never fires', async () => {
  // THE regression. This is the Google Drive virtual drive: `watch` returns a handle and
  // stays silent forever, so only the poll can see the new file.
  const fsModule = fakeFs({ files: { 'G:\\SH3301\\01_InProgress': ['take_V019.mp4'] }, watchWorks: false })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 20, debounceMs: 5 })

  watcher.set(['G:\\SH3301\\01_InProgress'])
  await settle(60)
  assert.equal(changes, 0, 'opening a folder must not report a change')

  fsModule.add('G:\\SH3301\\01_InProgress', 'take_V020.mp4')
  await settle(120)
  assert.equal(changes, 1, 'the new file must be reported without fs.watch')
  watcher.close()
})

test('a new file is noticed when fs.watch works, without waiting for the poll', async () => {
  const fsModule = fakeFs({ files: { 'C:\\local': ['a.txt'] }, watchWorks: true })
  let changes = 0
  // A poll interval far longer than the test, so only fs.watch can be responsible.
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 60000, debounceMs: 5 })

  watcher.set(['C:\\local'])
  await settle(60)
  assert.equal(changes, 0)

  fsModule.add('C:\\local', 'b.txt')
  fsModule.emit()
  await settle(60)
  assert.equal(changes, 1, 'a working fs.watch must report immediately')
  watcher.close()
})

test('seeding a folder never reports a change', async () => {
  // Firing on the first observation would make every folder open refresh itself.
  const fsModule = fakeFs({ files: { 'C:\\a': ['one.txt', 'two.txt'] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(150)
  assert.equal(changes, 0, 'the initial listing is not a change')
  watcher.close()
})

test('one change is reported once, not on every poll tick', async () => {
  // The signature must be stored BEFORE the callback, or the refresh it triggers looks
  // like another change and the app re-lists forever.
  const fsModule = fakeFs({ files: { 'C:\\a': ['one.txt'] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(50)
  fsModule.add('C:\\a', 'two.txt')
  await settle(200) // many poll ticks
  assert.equal(changes, 1, `expected exactly one report, got ${changes}`)
  watcher.close()
})

test('several quick changes coalesce into one refresh', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': [] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 40 })

  watcher.set(['C:\\a'])
  await settle(50)
  fsModule.add('C:\\a', 'x1.tmp')
  fsModule.add('C:\\a', 'x2.tmp')
  fsModule.add('C:\\a', 'x3.tmp')
  fsModule.emit()
  await settle(150)
  assert.equal(changes, 1, 'a burst of writes is one refresh')
  watcher.close()
})

test('a deleted file is noticed too', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': ['keep.txt', 'gone.txt'] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(50)
  fsModule.remove('C:\\a', 'gone.txt')
  await settle(120)
  assert.equal(changes, 1)
  watcher.close()
})

test('a rename is noticed as a change', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': ['before.txt'] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(50)
  fsModule.remove('C:\\a', 'before.txt')
  fsModule.add('C:\\a', 'after.txt')
  await settle(120)
  assert.equal(changes, 1)
  watcher.close()
})

test('a file becoming a folder counts as a change', async () => {
  // The trailing slash in the signature is what makes this visible: the NAME is the same.
  const fsModule = fakeFs({ files: { 'C:\\a': ['thing'] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(50)
  fsModule.tree.get('C:\\a').delete('thing')
  fsModule.tree.get('C:\\a').add('thing/')
  await settle(120)
  assert.equal(changes, 1, 'the same name as a folder is a different listing')
  watcher.close()
})

test('leaving a folder stops watching it and frees its native watcher', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': [], 'C:\\b': [] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a', 'C:\\b'])
  await settle(50)
  assert.deepEqual(watcher.watched().sort(), ['C:\\a', 'C:\\b'])
  assert.equal(fsModule.liveWatchers(), 2)

  watcher.set(['C:\\a'])
  await settle(50)
  assert.deepEqual(watcher.watched(), ['C:\\a'], 'the folder left behind is dropped')
  assert.equal(fsModule.liveWatchers(), 1, 'its native watcher is released, not leaked')

  // A change in the folder no longer watched must not report.
  fsModule.add('C:\\b', 'ignored.txt')
  await settle(120)
  assert.equal(changes, 0)
  watcher.close()
})

test('an unreadable folder does not report a change', async () => {
  // A permissions blip or a disconnected drive must not look like "the folder changed".
  const fsModule = fakeFs({ files: { 'C:\\a': ['one.txt'] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(50)
  fsModule.tree.delete('C:\\a') // now unreadable
  await settle(120)
  assert.equal(changes, 0, 'an unreadable folder is not a change')

  fsModule.tree.set('C:\\a', new Set(['one.txt'])) // readable again, same contents
  await settle(120)
  assert.equal(changes, 0, 'and coming back unchanged is not a change either')
  watcher.close()
})

test('a drive that refuses fs.watch entirely still gets polled', async () => {
  // Some network paths throw on `watch` rather than returning a silent handle.
  const fsModule = fakeFs({ files: { 'Z:\\share': ['a.txt'] } })
  fsModule.watch = () => {
    throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
  }
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['Z:\\share'])
  await settle(50)
  assert.equal(changes, 0)

  fsModule.add('Z:\\share', 'b.txt')
  await settle(120)
  assert.equal(changes, 1, 'the poll covers a drive where watch is unavailable')
  watcher.close()
})

test('close() stops everything and reports nothing afterwards', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': [] } })
  let changes = 0
  const watcher = createFolderWatcher(() => { changes += 1 }, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(50)
  watcher.close()
  assert.equal(fsModule.liveWatchers(), 0, 'no native watcher may outlive close()')
  assert.deepEqual(watcher.watched(), [])

  fsModule.add('C:\\a', 'after-close.txt')
  await settle(120)
  assert.equal(changes, 0, 'nothing is reported after close')
})

test('set() after close() is ignored rather than resurrecting the watcher', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': [] } })
  const watcher = createFolderWatcher(() => {}, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.close()
  watcher.set(['C:\\a'])
  assert.deepEqual(watcher.watched(), [], 'a closed watcher stays closed')
  assert.equal(fsModule.liveWatchers(), 0)
})

test('the same folder is not watched twice', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': [] } })
  const watcher = createFolderWatcher(() => {}, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(40)
  watcher.set(['C:\\a'])
  await settle(40)
  assert.equal(fsModule.liveWatchers(), 1, 'a repeated set() must not double-watch')
  assert.deepEqual(watcher.watched(), ['C:\\a'])
  watcher.close()
})

test('an empty set stops polling entirely', async () => {
  const fsModule = fakeFs({ files: { 'C:\\a': [] } })
  const watcher = createFolderWatcher(() => {}, { fsModule, intervalMs: 15, debounceMs: 5 })

  watcher.set(['C:\\a'])
  await settle(40)
  watcher.set([])
  assert.deepEqual(watcher.watched(), [])
  assert.equal(fsModule.liveWatchers(), 0)
  watcher.close()
})
