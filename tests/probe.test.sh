#!/bin/bash
# bin/update-arcade-probe against fake hyprctl and pgrep. Every command the
# probe runs is recorded with its full argv; a window title must never show up
# there (argv is readable by other users through /proc). Offline.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/update-arcade-probe.XXXXXX")"
trap 'kill "$updater" 2>/dev/null; rm -rf "$work"' EXIT
fail=0
check() { if eval "$2"; then echo "OK $1"; else echo "FAIL $1"; fail=1; fi; }

secret="SECRET-bank-statement-$$.pdf — Private Browsing"
shims="$work/shims"
mkdir -p "$shims"

# Stand-in for the update; its ancestors include this script, whose pid the
# fake update terminal below claims.
sleep 60 & updater=$!

for tool in jq awk tail date stat id; do
  cat >"$shims/$tool" <<EOF
#!/bin/bash
printf '%s\0' "\$0" "\$@" >>"$work/argv"
exec /usr/bin/$tool "\$@"
EOF
done
cat >"$shims/pgrep" <<EOF
#!/bin/bash
printf '%s\0' "\$0" "\$@" >>"$work/argv"
echo $updater
EOF
cat >"$shims/hyprctl" <<EOF
#!/bin/bash
printf '%s\0' "\$0" "\$@" >>"$work/argv"
case "\$1" in
  clients) /usr/bin/cat <<'JSON'
[{"address":"0xaaa","mapped":true,"pid":1,"class":"firefox","title":"$secret","initialTitle":"$secret",
  "at":[0,0],"size":[800,600],"workspace":{"id":2,"name":"2"},"monitor":0,"fullscreen":0},
 {"address":"0xbbb","mapped":true,"pid":$$,"class":"org.omarchy.terminal","title":"$secret","initialTitle":"omarchy update",
  "at":[10,20],"size":[640,480],"workspace":{"id":1,"name":"1"},"monitor":0,"fullscreen":0}]
JSON
  ;;
  monitors) echo '[{"id":0,"name":"DP-1","description":"$secret","x":0,"y":0,"activeWorkspace":{"id":1,"name":"1"},"specialWorkspace":{"id":0,"name":""}}]' ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$shims"/*

# The probe pins PATH to system directories; point that one line at the shims.
sed "s|^PATH=/usr/bin:/bin$|PATH=$shims|" "$root/bin/update-arcade-probe" >"$work/probe"
chmod +x "$work/probe"
check "probe PATH line is where the test expects it" "! cmp -s '$work/probe' '$root/bin/update-arcade-probe'"

"$work/probe" >"$work/out"
check "reports the running update" "jq -e '.running == true' '$work/out' >/dev/null"
check "finds the update terminal" "jq -e '.window.address == \"0xbbb\" and .window.at == [10,20] and .window.size == [640,480]' '$work/out' >/dev/null"
check "finds its monitor" "jq -e '.monitor.name == \"DP-1\" and .monitor.workspace == 1' '$work/out' >/dev/null"
check "no title in the output" "! grep -qF -- 'SECRET-' '$work/out'"
check "hyprctl was asked" "grep -qzx -- clients '$work/argv'"
check "no title on any command line" "! tr '\0' '\n' <'$work/argv' | grep -qF -- 'SECRET-'"

# hyprctl missing or failing: still a valid report, just no window.
printf '#!/bin/bash\necho "HYPRLAND_INSTANCE_SIGNATURE not set"\nexit 1\n' >"$shims/hyprctl"
"$work/probe" >"$work/out"
check "survives a failing hyprctl" "jq -e '.running == true and .window == null and .monitor == null' '$work/out' >/dev/null"

exit $fail
