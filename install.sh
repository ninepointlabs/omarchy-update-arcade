#!/bin/bash
# Copy this checkout into the Omarchy plugin directory. Does not enable the
# plugin or restart the shell.

set -euo pipefail
# Only system tools, by absolute path; nothing from a user PATH directory.
PATH=/usr/bin:/bin
export PATH
unset BASH_ENV ENV CDPATH PYTHONPATH PYTHONHOME PYTHONSTARTUP

src="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd)"
id="$(/usr/bin/python3 -I -S -B - "$src/manifest.json" <<'PY'
import json, re, sys
value = json.load(open(sys.argv[1]))["id"]
if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,63}", value):
    raise SystemExit("unexpected plugin id")
print(value)
PY
)"
parent="$HOME/.config/omarchy/plugins"
dest="$parent/$id"

if [ -L "$parent" ] || [ -L "$dest" ]; then
  echo "Error: $dest (or its parent) is a symlink, not a plugin directory. Remove it and re-run." >&2
  exit 1
fi
/usr/bin/mkdir -p -m 700 "$parent"

stage="$(/usr/bin/mktemp -d "$parent/.update-arcade.staging.XXXXXX")"
trap '/usr/bin/rm -rf "$stage"' EXIT

/usr/bin/mkdir -p "$stage/bin"
/usr/bin/cp "$src/manifest.json" "$src/Service.qml" "$src/Game.qml" "$src/Sounds.qml" "$src/Model.js" "$src/Asteroids.js" \
  "$src/README.md" "$src/LICENSE" "$stage/"
/usr/bin/cp "$src/bin/update-arcade-probe" "$stage/bin/"
/usr/bin/mkdir -p "$stage/sounds"
/usr/bin/cp "$src"/sounds/*.wav "$stage/sounds/"
/usr/bin/chmod 755 "$stage/bin/update-arcade-probe"

omarchy_bin=/usr/share/omarchy/bin/omarchy
[ -x "$omarchy_bin" ] || omarchy_bin=/usr/bin/omarchy
"$omarchy_bin" plugin validate "$stage"

if [ -e "$dest" ]; then
  old="$parent/.update-arcade.old.$$"
  /usr/bin/mv -f "$dest" "$old"
  if /usr/bin/mv -f "$stage" "$dest"; then
    /usr/bin/rm -rf "$old"
  else
    /usr/bin/rm -rf "$dest" 2>/dev/null || true
    /usr/bin/mv -f "$old" "$dest"
    echo "Error: install failed; restored the previous install." >&2
    exit 1
  fi
else
  /usr/bin/mv -f "$stage" "$dest"
fi
trap - EXIT

echo "Installed $id to $dest"
echo "Not enabled and the shell was not restarted. When you want it live:"
echo "  omarchy plugin enable $id"
echo "  omarchy restart shell"
