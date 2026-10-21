.pragma library

// Pure helpers for reading the probe's report: where the update terminal is,
// what the update last said, and whether it is waiting on the user.

// CSI (incl. private modes like ?2004h), OSC, character-set picks like the
// ESC ( B that tput sgr0 and makepkg emit, and lone two-byte escapes.
var ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()*+][0-9A-Za-z]|\x1b[@-Z\\-_]/g

function stripAnsi(text) {
  return String(text || "").replace(ANSI, "")
}

// Each physical line keeps only what follows its last carriage return, the
// way a terminal would show a spinner or progress bar that redraws in place.
function visibleLines(tail) {
  return stripAnsi(tail).split("\n").map(function(line) {
    var parts = line.split("\r")
    for (var i = parts.length - 1; i >= 0; i--) {
      if (parts[i].trim() !== "") return parts[i]
    }
    return ""
  })
}

function lastLine(tail) {
  var lines = visibleLines(tail)
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].replace(/\s+/g, " ").trim()
    // gum's key hint row under a prompt says nothing about progress.
    if (line !== "" && !/^\S+ toggle .* submit/.test(line)) return line
  }
  return ""
}

var PROMPT_LINE = /(\[[yn]\/[yn]\]|\([yn]\/[yn]\)|password.*:\s*$|==>\s*$|\?\s*$)/i
// A PKGBUILD's own read prompt, e.g. "  -> Please type absolute path to mounted
// Rune CD (e.g. /media/cdrom)": it starts by asking, whatever it ends with.
// Anchored to the start so build chatter ("checking for size_t type...") isn't one.
var ASKING_LINE = /^\s*(?:(?:->|==>|::)\s*)?(?:please|type|enter|choose|select|press|confirm|proceed|answer)\b/i

// True while the update is sitting on a question. Two signals:
//  - gum and other line editors switch bracketed paste on (?2004h) while they
//    read input and off (?2004l) after, so an unmatched "on" means a prompt.
//  - sudo, pacman and yay prompts end the output on a recognizable line, and
//    a PKGBUILD's own questions start with one ("Please type ...").
// The output has to have gone quiet first, so a build that merely prints a
// line ending in "?" does not pull the player out of the game.
function needsInput(tail, logAge) {
  var text = String(tail || "")
  if (logAge < 1) return false
  if (text.lastIndexOf("\x1b[?2004h") > text.lastIndexOf("\x1b[?2004l")) return true
  if (logAge < 2) return false
  var lines = visibleLines(text)
  for (var i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "") continue
    return PROMPT_LINE.test(lines[i].trim()) || ASKING_LINE.test(lines[i])
  }
  return false
}

// Monitor-relative rectangle of the update terminal, or null when it is not
// on screen (no window found, another workspace, or fullscreen).
function placement(report) {
  if (!report || !report.running || !report.window || !report.monitor) return null
  var win = report.window
  var mon = report.monitor
  var onScreen = win.workspace === mon.workspace || (mon.special !== 0 && win.workspace === mon.special)
  if (!onScreen || win.fullscreen) return null
  if (!win.size || win.size[0] < 200 || win.size[1] < 150) return null
  return {
    screen: mon.name,
    address: win.address,
    x: win.at[0] - mon.x,
    y: win.at[1] - mon.y,
    width: win.size[0],
    height: win.size[1]
  }
}
