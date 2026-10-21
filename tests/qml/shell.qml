// Headless compile check, run by tests/qml/run.sh from a staged copy.
// Builds Service.qml, Game.qml and Sounds.qml without a window, checks every sound
// loaded, and prints OK/FAIL lines. Quickshell has no clean exit from QML, so
// run.sh stops it once the verdict is printed.
import QtQuick
import Quickshell
import "Asteroids.js" as Asteroids

ShellRoot {
  id: shell

  Loader { id: game; source: "Game.qml"; width: 640; height: 480 }
  Loader { id: sounds; source: "Sounds.qml" }
  // Needs qs.Commons, which run.sh stages from the installed Omarchy shell.
  Loader { id: service; source: "Service.qml" }

  // Regression: sound has to come on when a round starts from the title
  // screen, with no pause in between (it once stayed silent until one).
  property bool soundOnTitle: true
  property bool soundInRound: false
  Timer {
    interval: 1200; running: true
    onTriggered: { game.item.running = true; roundTimer.start() }
  }
  Timer {
    id: roundTimer; interval: 400
    onTriggered: {
      shell.soundOnTitle = game.item.soundOn
      Asteroids.start(game.item.state)
      checkRound.start()
    }
  }
  Timer {
    id: checkRound; interval: 400
    onTriggered: shell.soundInRound = game.item.soundOn
  }

  Timer {
    interval: 2500
    running: true
    onTriggered: {
      console.log(game.status === Loader.Ready ? "OK Game.qml" : "FAIL Game.qml status " + game.status)
      console.log(service.status === Loader.Ready ? "OK Service.qml" : "FAIL Service.qml status " + service.status)
      if (service.item && service.item.updating) console.log("NOTE an omarchy update is running")
      if (sounds.status !== Loader.Ready) {
        console.log("FAIL Sounds.qml status " + sounds.status)
        return
      }
      console.log("OK Sounds.qml")
      console.log(!shell.soundOnTitle ? "OK quiet on the title screen" : "FAIL sound on during the title screen")
      console.log(shell.soundInRound ? "OK sound on once a round starts" : "FAIL sound still off after a round started")
      var pools = sounds.item.pools
      var bad = []
      var count = 0
      for (var name in pools) {
        for (var v = 0; v < pools[name].length; v++) {
          count++
          // SoundEffect.Ready === 2
          if (pools[name][v].status !== 2) bad.push(name + "=" + pools[name][v].status)
        }
      }
      console.log(bad.length ? "FAIL sounds not ready: " + bad.join(", ") : "OK all " + count + " sound voices loaded")
      console.log("DONE")
    }
  }
}
