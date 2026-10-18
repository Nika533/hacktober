; Hoot installer hooks (electron-builder `nsis.include`).
;
; hoot-bridge is the browser extension's native messaging host. The installer
; registers it for this user (HKCU, Chrome, Edge, Chromium and Brave) by
; running the bundled register-native-host.cjs with the app's own binary in
; Node mode, so the manifest and registry keys come from the same code as
; `npm run register-host` (packages/bridge/src/register.ts).

!macro hootRegisterNativeHost ARGS
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
  nsExec::ExecToLog '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\register-native-host.cjs" ${ARGS}'
  Pop $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", n)i'
!macroend

!macro customInstall
  !insertmacro hootRegisterNativeHost '--launcher "$INSTDIR\resources\hoot-bridge.cmd"'
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first. Keep the registration then (the
  ; new install rewrites it), so the extension never loses its host.
  ${ifNot} ${isUpdated}
    !insertmacro hootRegisterNativeHost '--unregister'
  ${endIf}
!macroend
