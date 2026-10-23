#!/bin/bash
# Compile Service.qml, Game.qml and Sounds.qml in a throwaway Quickshell instance with no
# window, and check every sound loads. Quickshell only loads files inside its
# config folder, so the plugin is staged next to the harness first.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
stage="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/update-arcade-qml.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
cp "$root"/{Service.qml,Game.qml,Sounds.qml,Model.js,Asteroids.js} "$root/tests/qml/shell.qml" "$stage/"
cp -r "$root/sounds" "$root/bin" "$stage/"
cp -r "${OMARCHY_PATH:-/usr/share/omarchy}/shell/Commons" "$stage/"
# NO_SOUND=1: stand in for a system without Qt Multimedia.
if [[ ${NO_SOUND:-} == 1 ]]; then
  sed -i 's/^import QtMultimedia$/import QtMultimediaMissing/' "$stage/Sounds.qml"
fi
# Its own state folder, so the real high scores and save file are never read or touched.
mkdir -p "$stage/state"
XDG_STATE_HOME="$stage/state" timeout 8 qs -p "$stage" >"$stage/out.log" 2>&1
grep -E "OK |FAIL |rror" "$stage/out.log" | grep -v portal | sed 's/.*qml[^:]*: //'
grep -q DONE "$stage/out.log" && ! grep -E "FAIL |rror" "$stage/out.log" | grep -qv portal
