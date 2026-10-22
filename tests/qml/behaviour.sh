#!/bin/bash
# Finished mode and save/resume, driven through Service.qml in a windowless
# Quickshell. The staged Service.qml is patched so nothing reaches the desktop:
# no probe (the test feeds reports), no visible panel, no hyprctl, and a fake
# "TEST" screen. State lives in the stage, never in ~/.local/state.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
stage="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/update-arcade-behaviour.XXXXXX")"
trap 'quickshell kill -p "$stage" >/dev/null 2>&1; rm -rf "$stage"' EXIT
cp "$root"/{Service.qml,Game.qml,Sounds.qml,Model.js,Asteroids.js} "$stage/"
cp "$root/tests/qml/behaviour.qml" "$stage/shell.qml"
cp -r "$root/sounds" "$root/bin" "$stage/"
cp -r "${OMARCHY_PATH:-/usr/share/omarchy}/shell/Commons" "$stage/"
node - "$stage/Service.qml" <<'JS' || exit 1
const fs = require("fs");
const file = process.argv[2];
let s = fs.readFileSync(file, "utf8");
const swap = (from, to) => {
  if (!s.includes(from)) { console.log("FAIL patch: " + from.split("\n")[0]); process.exit(1); }
  s = s.split(from).join(to);
};
swap("    running: true\n    repeat: true\n    triggeredOnStart: true", "    running: false\n    repeat: true\n    triggeredOnStart: false");
swap("  function screenNamed(name) {", "  function screenNamed(name) {\n    if (name === \"TEST\") return ({ name: \"TEST\" })");
swap("readonly property var targetScreen: root.place ? root.screenNamed(root.place.screen) : null", "readonly property var targetScreen: null");
swap("visible: place !== null", "visible: false");
swap("\"hyprctl\"", "\"true\"");
swap("  function centredPlace() {", "  function centredPlace() {\n    return Model.centred(\"TEST\", 1920, 1080)");
swap("  property bool updating: false", "  property alias gameItem: game\n  property bool updating: false");
fs.writeFileSync(file, s);
JS
mkdir -p "$stage/state/omarchy-update-arcade"
save="$stage/state/omarchy-update-arcade/save.json"
failed=0

# A save of a round at score 4321, wave 2, written $1 ms from now.
fresh() {
  node -e '
    const fs = require("fs"), vm = require("vm"), ctx = {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(process.argv[1], "utf8").replace(/^\.pragma library\s*$/m, ""), ctx);
    const s = ctx.newGame(800, 600, Math.random, []);
    ctx.start(s); s.score = 4321; s.level = 2;
    process.stdout.write(JSON.stringify(ctx.snapshot(s, Date.now() + Number(process.argv[2] || 0))));
  ' "$root/Asteroids.js" "${1:-0}"
}

scenario() { # name, seconds
  XDG_STATE_HOME="$stage/state" SCENARIO=$1 timeout "$2" qs -p "$stage" >"$stage/$1.log" 2>&1
  grep -aE "OK |FAIL |rror" "$stage/$1.log" | grep -v portal | sed 's/.*qml[^:]*: //'
  grep -aq DONE "$stage/$1.log" && ! grep -aE "FAIL |rror" "$stage/$1.log" | grep -qv portal || { failed=1; echo "FAIL $1 did not finish cleanly"; }
}

rm -f "$save"; scenario save 10
rm -f "$save"; scenario hidden 6
rm -f "$save"; fresh >"$save"; scenario resume-finished 8
rm -f "$save"; fresh >"$save"; scenario resume-updating 5
rm -f "$save"; fresh >"$save"; scenario resume-input 5
rm -f "$save"; echo '{"version":1,"savedAt":' >"$save"; scenario corrupt 5
rm -f "$save"; fresh -700000 >"$save"; scenario stale 5
rm -f "$save"; fresh | sed 's/"score":4321/"score":"__proto__"/' >"$save"; scenario hostile 5
rm -f "$save"; scenario none 5

# The shell restart: quickshell kill has to run onDestruction and the
# blocking write has to land, before any autosave tick could have.
rm -f "$save"
XDG_STATE_HOME="$stage/state" SCENARIO=kill qs -p "$stage" >"$stage/kill.log" 2>&1 &
for _ in $(seq 50); do grep -aq READY "$stage/kill.log" && break; sleep 0.1; done
before=no; [[ -e $save ]] && before=yes
timeout 30 quickshell kill -p "$stage" >/dev/null 2>&1; wait
if [[ $before == no ]] && grep -q '"score":777' "$save" 2>/dev/null; then
  echo "OK kill: quickshell kill saved the round on the way out"
else
  echo "FAIL kill: no save from onDestruction (saved before kill: $before)"; failed=1
fi
exit $failed
