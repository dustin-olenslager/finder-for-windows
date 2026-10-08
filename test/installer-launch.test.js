'use strict'

/**
 * The installer must launch the executable, not the Start Menu shortcut.
 *
 * The bug this file pins: clicking Finish in the installer raised "Windows is searching for
 * Finder for Windows.exe" on a completed, correct install. Nothing was wrong with the
 * application — electron-builder points the Finish-page launch at the Start Menu shortcut
 * ($launchLink = $newStartMenuLink) and then hands that shortcut to the shell to resolve, and
 * the resolution failed. The user sees a missing-file error on a successful install.
 *
 * This cannot be caught by running the app, and it cannot be caught by any test that does not
 * build an installer — which needs Windows. What it CAN be caught by is the contract between
 * our include and electron-builder's template, and that contract is what these tests assert:
 * our macro nests inside the template, and it wins the assignment because it runs LAST.
 *
 * The ordering assertion is the one that matters. `installSection.nsh` assigns $launchLink and
 * then inserts `customInstall`; if a future electron-builder reorders those two, our override
 * silently stops applying and the installer goes back to launching the shortcut — with no
 * error anywhere except the Finish button, on a machine we cannot see. That is exactly the
 * shape of failure worth a test.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const template = (...parts) =>
  fs.readFileSync(path.join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis', ...parts), 'utf8')

const customInclude = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8')
const installSection = template('installSection.nsh')
const assistedInstaller = template('assistedInstaller.nsh')
const common = template('common.nsh')

test('our include defines the hook electron-builder looks for', () => {
  assert.match(
    customInclude,
    /!macro\s+customInstall\b/,
    'build/installer.nsh must define customInstall — that is the only hook the template invokes'
  )
})

test('the hook points the launch at the installed executable', () => {
  assert.match(
    customInclude,
    /StrCpy\s+\$launchLink\s+"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/,
    'the launch must target $INSTDIR\\${APP_EXECUTABLE_FILENAME}'
  )
})

test('it uses the packager\'s own filename define, so the name cannot drift', () => {
  // common.nsh derives it from the product name: "Finder for Windows.exe". Hard-coding the
  // name here would break the day the product is renamed, in a place no test could see.
  assert.match(common, /!define\s+APP_EXECUTABLE_FILENAME\s+"\$\{PRODUCT_FILENAME\}\.exe"/)
  // Comments are excluded on purpose: the header prose names the executable to explain the
  // bug, and only the DIRECTIVES are the thing that must not hard-code it.
  const directives = customInclude
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
  assert.ok(
    !/Finder for Windows\.exe/.test(directives),
    'do not hard-code the executable name in a directive — use ${APP_EXECUTABLE_FILENAME}'
  )
})

test('electron-builder launches through the shortcut — the reason this override exists', () => {
  // If upstream ever stops doing this, this test fails and the override can be deleted rather
  // than left in place as folklore.
  assert.match(installSection, /StrCpy\s+\$launchLink\s+"\$newStartMenuLink"/)
  assert.match(assistedInstaller, /ExecShellAsUser.*\$launchLink.*open/)
})

test('our override runs AFTER the template assigns the shortcut', () => {
  const assigned = installSection.indexOf('StrCpy $launchLink "$newStartMenuLink"')
  const hooked = installSection.indexOf('!insertmacro customInstall')
  assert.notStrictEqual(assigned, -1, 'template no longer assigns $launchLink to the shortcut')
  assert.notStrictEqual(hooked, -1, 'template no longer inserts customInstall')
  assert.ok(
    hooked > assigned,
    `customInstall must be inserted after the $launchLink assignment, or the override is ` +
      `overwritten (assignment at ${assigned}, hook at ${hooked}) — the Finish button would ` +
      `go back to launching the shortcut`
  )
})

test('the fallback path was already correct — the shortcut branch is the whole bug', () => {
  // Sanity: the template already launches $INSTDIR\...exe when no shortcut exists, which is
  // why this only reproduces on a normal install where the shortcut WAS created.
  assert.match(installSection, /StrCpy\s+\$launchLink\s+"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/)
})

test('shortcuts are still created — the fix removes indirection, not the shortcuts', () => {
  assert.match(installSection, /addStartMenuLink/)
  assert.match(installSection, /addDesktopLink/)
  assert.match(customInclude, /does NOT weaken the shortcuts|still created/)
})
