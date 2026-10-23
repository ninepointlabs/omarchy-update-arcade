// Headless behaviour check for finished mode and save/resume, run by
// tests/qml/behaviour.sh from a staged copy in which Service.qml has no probe
// timer, a fake "TEST" screen and a panel that never shows. One scenario per
// run, picked by $SCENARIO; prints OK/FAIL lines.
import QtQuick
import Quickshell
import Quickshell.Io
import "Asteroids.js" as Asteroids
ShellRoot {
  id: top
  property string scenario: Quickshell.env("SCENARIO")
  property string savePath: Quickshell.env("XDG_STATE_HOME") + "/omarchy-update-arcade/save.json"
  property string run: JSON.stringify({ running: true, logTail: "building foo\n", logAge: 0,
    window: { address: "0xabc", workspace: 1, fullscreen: 0, at: [10, 20], size: [800, 600] },
    monitor: { name: "TEST", workspace: 1, special: 0, x: 0, y: 0 } })
  property string restarting: JSON.stringify({ running: true, logTail: "Keeping orphaned packages.\r\n\x1b[32m\r\nRestarting shell\x1b[0m\r\n", logAge: 0,
    window: { address: "0xabc", workspace: 1, fullscreen: 0, at: [10, 20], size: [800, 600] },
    monitor: { name: "TEST", workspace: 1, special: 0, x: 0, y: 0 } })
  Loader { id: svc; source: "Service.qml" }
  FileView { id: probeFile; path: top.savePath; blockLoading: true; printErrors: false; watchChanges: false }
  function exists() { probeFile.reload(); probeFile.waitForJob(); return probeFile.loaded && probeFile.text().length > 0 }
  function saved() { probeFile.reload(); probeFile.waitForJob(); try { return JSON.parse(probeFile.text()) } catch (e) { return null } }
  function check(name, ok) { console.log((ok ? "OK " : "FAIL ") + top.scenario + ": " + name) }
  function later(ms, f) { var t = Qt.createQmlObject('import QtQuick; Timer {}', top); t.interval = ms; t.triggered.connect(f); t.start() }
  function startRound(s, g) {
    s.apply(run); s.showGame()
    g.state = Asteroids.newGame(640, 480, Math.random, [])
    Asteroids.start(g.state); g.state.score = 4321; g.state.level = 2; g.phase = "playing"
  }
  Timer { interval: 800; running: true; onTriggered: {
    var s = svc.item, g = s.gameItem
    if (!g.state) g.state = Asteroids.newGame(640, 480, Math.random, [])
    if (scenario === "save") {
      startRound(s, g)
      s.apply(restarting)
      var d = saved()
      check("restart line writes the save", d && d.phase === "playing" && d.score === 4321 && d.version === 1)
      check("save reads back", Asteroids.readSave(JSON.stringify(d), Date.now()) !== null)
      g.state.score = 5000
      later(2300, function() {
        check("autosave rewrites every 2 s", saved() && saved().score === 5000)
        Asteroids.endGame(g.state); g.phase = g.state.phase === "entry" ? "entry" : "over"
        if (g.phase === "entry") { later(2300, function() {
          check("entry screen saved", saved() && saved().phase === "entry")
          Asteroids.signEntry(g.state, "2026-10-21"); g.phase = "over"
          later(400, function() { check("game over deletes the save", !exists()); console.log("DONE") })
        }) }
      })
    } else if (scenario === "hidden") {
      startRound(s, g)
      later(2300, function() {
        s.hideGame()   // Esc during the update
        check("hidden round stays saved", exists() && s.saving)
        s.apply('{"running":false}')
        later(400, function() { check("update ends without restart: save deleted", !exists() && !s.playing); console.log("DONE") })
      })
    } else if (scenario === "finished") {
      // Title screen up when the update ends: it stays, with the banner.
      s.apply(run); s.showGame()
      s.apply('{"running":false}')
      check("title screen stays up", s.playing && s.finished && s.place !== null && g.updateDone)
      s.hideGame()
      check("Esc closes it", !s.playing && !s.finished && s.place === null && !g.updateDone)
      // A round in play: it keeps going, through game over and beyond.
      startRound(s, g)
      s.apply('{"running":false}')
      check("round stays up", s.playing && s.finished && g.state.phase === "playing")
      s.apply('{"running":false}')
      check("stays across probes", s.playing && s.finished)
      Asteroids.endGame(g.state)
      if (g.state.phase === "entry") { g.phase = "entry"; Asteroids.signEntry(g.state, "2026-10-22") }
      g.phase = "over"
      later(3600, function() {
        check("game over does not close it", s.playing && s.finished && s.place !== null)
        Asteroids.start(g.state); g.phase = "playing"
        check("plays again after the update", s.playing && s.finished)
        s.apply(run)
        check("new update: back to tracking", s.playing && !s.finished && s.updating && !g.updateDone)
        s.apply('{"running":false}')
        s.closeGame()
        check("close clears it", !s.playing && !s.finished && s.place === null)
        console.log("DONE")
      })
    } else if (scenario === "kill") {
      startRound(s, g)
      g.state.score = 777
      console.log("READY")
    } else if (scenario === "resume-finished") {
      check("pending save loaded", s.pendingSave !== null && s.pendingSave.score === 4321)
      s.apply('{"running":false}')
      check("offered mid-screen in finished mode", s.playing && s.finished && g.resumeOffer !== null
            && s.place.width === 1152 && s.place.x === 384 && s.place.address === "")
      check("banner and Q in finished mode", g.updateDone === true)
      s.apply('{"running":false}')
      check("offer survives the next probe", s.playing && s.finished)
      g.acceptResume()
      check("resumed into the round", g.phase === "playing" && g.state.score === 4321 && g.state.level === 2 && g.resumeOffer === null)
      later(400, function() {
        check("resume deletes the save", !exists() && s.pendingSave === null)
        later(2300, function() {
          check("finished-mode round autosaves", exists())
          s.closeGame()
          later(400, function() { check("close deletes it", !exists() && !s.playing && !s.finished && s.place === null); console.log("DONE") })
        })
      })
    } else if (scenario === "resume-updating") {
      s.apply(run)
      check("offered over the terminal", s.playing && !s.finished && g.resumeOffer !== null && s.place.address === "0xabc")
      check("no banner, Q not a quit key while updating", g.updateDone === false)
      g.resumeDeclined()
      later(400, function() { check("discard deletes the save and closes", !exists() && !s.playing && g.resumeOffer === null)
        s.apply(run)
        check("not offered again", !s.playing)
        console.log("DONE") })
    } else if (scenario === "resume-input") {
      s.apply(run)
      var asking = JSON.parse(run); asking.logTail = "[sudo] password for tim: "; asking.logAge = 5
      s.apply(JSON.stringify(asking))
      check("needsInput hides the prompt but keeps the save", !s.playing && g.resumeOffer !== null && exists())
      s.apply(run); check("no auto re-show", !s.playing)
      s.showGame(); check("Play shows the prompt again", s.playing && g.resumeOffer !== null)
      console.log("DONE")
    } else if (scenario === "corrupt" || scenario === "stale" || scenario === "hostile") {
      s.apply('{"running":false}')
      later(400, function() { check("ignored and deleted", s.pendingSave === null && !s.playing && !exists()); console.log("DONE") })
    } else if (scenario === "none") {
      s.apply('{"running":false}')
      check("no save: nothing shown", !s.playing && s.place === null && !exists())
      startRound(s, g); s.hideGame()
      s.apply('{"running":false}')
      check("plain play unchanged", !s.playing && !s.finished)
      console.log("DONE")
    }
  }}
}
