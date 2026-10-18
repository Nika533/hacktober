@echo off
rem Packaged hoot-bridge launcher (shipped in resources/ by the installer, D1-30).
rem Runs the bridge with the app's own signed Electron binary in Node mode.
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\Hoot.exe" "%~dp0hoot-bridge.cjs" %*
