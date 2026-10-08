# Custom NSIS include — the ONE thing this file exists to fix is what happens when the
# user clicks Finish.
#
# electron-builder launches the app at Finish through the START MENU SHORTCUT rather than
# through the executable. installSection.nsh sets $launchLink to $newStartMenuLink whenever
# that shortcut exists, and assistedInstaller.nsh's StartApp then hands it to the shell with
# ExecShellAsUser "open". Resolving a .lnk through the shell is an extra step that can fail on
# a fresh install, and when it does the failure is invisible to the application: the install is
# complete and correct, but Finish raises "Windows is searching for <app>.exe" — a missing-
# shortcut error, which reads to the user as a broken installation. Upstream tracks the same
# coupling in electron-builder#1917 ("NSIS: Remove the runAfterFinish dependency on Start Menu
# Shortcut").
#
# So: point the launch at the executable we just wrote. Same program, no shell indirection, and
# no dependency on a shortcut having resolved. This does NOT weaken the shortcuts — they are
# still created by addStartMenuLink / addDesktopLink immediately above, and still work from the
# Start menu and the desktop.
#
# Why the hook and not a direct assignment: installSection.nsh inserts `customInstall` AFTER it
# assigns $launchLink (line 81, versus lines 71-75), so this value is the one that survives, and
# it uses electron-builder's documented extension point rather than patching their template.
#
# ${APP_EXECUTABLE_FILENAME} is `Finder for Windows.exe` — the real filename the packager
# produces, taken from the same define the template itself uses, so the two cannot drift.

!macro customInstall
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend
