import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model
import "Asteroids.js" as Asteroids

// Watches for `omarchy update` and, while it runs, pins a small Play button
// to the corner of its terminal. Play lays Asteroids over the terminal; the
// update keeps going underneath. When the update asks a question the game
// gets out of the way on its own. If the update ends with the game up, the
// game carries on with an "update complete" banner until the player leaves. The round is saved
// as it goes, since a successful update ends by restarting the shell, and
// offered back when the shell comes up again.
Item {
  id: root

  property var shell: null

  readonly property string pluginDir: {
    var text = String(Qt.resolvedUrl("."))
    return text.indexOf("file://") === 0 ? decodeURIComponent(text.slice(7)).replace(/\/$/, "") : text
  }
  readonly property string stateDir: {
    var base = Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state")
    return base + "/omarchy-update-arcade"
  }

  property bool updating: false
  property var place: null
  property string status: ""
  property bool needsInput: false
  property bool playing: false
  // The update ended with the game up; the overlay stays on its last
  // rectangle until the player leaves with Esc, Q or the button.
  property bool finished: false
  // A checked save from before a shell restart, not yet answered.
  property var pendingSave: null
  property bool offered: false
  // This instance has written save.json since it was last deleted.
  property bool saving: false
  property bool reported: false
  property var scoreTable: []
  property bool muted: false

  function screenNamed(name) {
    var screens = Quickshell.screens || []
    for (var i = 0; i < screens.length; i++) {
      if (screens[i].name === name) return screens[i]
    }
    return null
  }

  function apply(text) {
    var report
    try { report = JSON.parse(text) } catch (e) { return }

    reported = true
    updating = !!report.running
    if (!updating) {
      needsInput = false
      // The probe has no window for a finished update, so keep the last one,
      // as long as its screen is still there.
      if ((finished || playing) && place && screenNamed(place.screen)) {
        finished = true
        return
      }
      if (finished) hideGame()
      finished = false
      playing = false
      place = null
      status = ""
      // A round left hidden when the update ended without a restart.
      if (saving) dropSave()
      offerResume()
      return
    }
    // A new update while the finished game is still up: back to tracking it.
    finished = false

    var next = Model.placement(report)
    // Only swap the object when the rectangle moved, so bindings stay quiet.
    if (!next || !place || next.screen !== place.screen || next.x !== place.x || next.y !== place.y
        || next.width !== place.width || next.height !== place.height || next.address !== place.address) {
      place = next
    }
    if (!place) playing = false

    status = Model.lastLine(report.logTail)
    var asking = Model.needsInput(report.logTail, report.logAge)
    if (asking && !needsInput && playing) hideGame()
    needsInput = asking
    if (Model.restartingShell(report.logTail)) saveNow()
    offerResume()
  }

  function showGame() {
    if (!place) return
    playing = true
  }

  function hideGame() {
    if (!playing) return
    playing = false
    // Hand the keyboard back to the terminal, where the update lives.
    // The address goes into a Lua expression, so only take Hyprland's own shape.
    // If the terminal has closed since, hyprctl finds nothing and does nothing.
    if (place && /^0x[0-9a-f]+$/.test(place.address)) {
      Quickshell.execDetached(["hyprctl", "dispatch", "hl.dsp.focus({ window = \"address:" + place.address + "\" })"])
    }
    // Nothing left to come back to once the update is over.
    if (finished) {
      finished = false
      place = null
      status = ""
      dropSave()
    }
  }

  // Esc, Q, the button and IPC hide. Walking away from the resume prompt
  // throws the save away; a round hidden during an update stays saved, since
  // the shell restart can still come.
  function closeGame() {
    if (game.resumeOffer) dropSave()
    hideGame()
  }

  // --- the round across a shell restart -----------------------------------

  function roundToKeep() {
    return (updating || finished) && !game.resumeOffer && !!game.state
      && (game.phase === "playing" || game.phase === "entry")
  }

  // Blocking write, so it lands even from onDestruction.
  function saveNow() {
    if (!roundToKeep()) return
    var snap = Asteroids.snapshot(game.state, Date.now())
    if (!snap) return
    saveFile.setText(JSON.stringify(snap) + "\n")
    saving = true
  }

  function dropSave() {
    saving = false
    pendingSave = null
    game.resumeOffer = null
    Quickshell.execDetached(["rm", "-f", saveFile.path])
  }

  function loadSave(text) {
    var save = Asteroids.readSave(text, Date.now())
    if (!save) { dropSave(); return }
    pendingSave = save
    offerResume()
  }

  // Once per save: over the terminal if an update still runs (waiting until
  // the probe finds it), mid-screen if the update is over.
  function offerResume() {
    if (!pendingSave || offered || !reported || needsInput || playing) return
    if (!Asteroids.saveFresh(pendingSave.savedAt, Date.now())) { dropSave(); return }
    if (updating) {
      if (!place) return
    } else {
      var spot = centredPlace()
      if (!spot) return
      place = spot
      finished = true
    }
    offered = true
    game.resumeOffer = pendingSave
    playing = true
  }

  function centredPlace() {
    var screen = (Hyprland.focusedMonitor && screenNamed(Hyprland.focusedMonitor.name)) || (Quickshell.screens || [])[0]
    return screen ? Model.centred(screen.name, screen.width, screen.height) : null
  }

  Component.onCompleted: Quickshell.execDetached(["mkdir", "-p", root.stateDir])
  // `quickshell kill`, which the restart uses, does run this (checked by hand).
  Component.onDestruction: { try { saveNow() } catch (e) {} }

  Timer {
    interval: 2000
    running: root.updating || root.finished
    repeat: true
    // A hidden round doesn't move, so once saved it stays saved.
    onTriggered: if (root.playing || !root.saving) root.saveNow()
  }

  FileView {
    id: saveFile
    path: root.stateDir + "/save.json"
    printErrors: false
    blockWrites: true
    atomicWrites: true
    property bool checked: false
    onLoaded: if (!checked) { checked = true; root.loadSave(text()) }
    onLoadFailed: checked = true
  }

  // omarchy-shell ninepointlabs.update-arcade toggle, e.g. from a keybinding.
  IpcHandler {
    target: "ninepointlabs.update-arcade"
    function play(): string { root.showGame(); return root.playing ? "playing" : "no update running" }
    function hide(): string { root.closeGame(); return "ok" }
    function toggle(): string { if (root.playing) root.closeGame(); else root.showGame(); return root.playing ? "playing" : "hidden" }
    function state(): string {
      return JSON.stringify({ updating: root.updating, finished: root.finished, playing: root.playing, needsInput: root.needsInput,
                              place: root.place, status: root.status, saved: root.saving, resumeOffered: root.pendingSave !== null })
    }
  }

  Process {
    id: probe
    command: [root.pluginDir + "/bin/update-arcade-probe"]
    stdout: StdioCollector {
      onStreamFinished: root.apply(text)
    }
  }

  // Cheap while idle (one pgrep); quicker while an update runs so the button
  // keeps up when the terminal is moved or resized.
  Timer {
    interval: root.updating ? 600 : 3000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!probe.running) probe.running = true
  }

  // --- saved state: high scores and mute ----------------------------------

  function loadSaved(text) {
    var saved = {}
    try { saved = JSON.parse(text) || {} } catch (e) {}
    scoreTable = Asteroids.cleanTable(saved.highScores)
    muted = saved.muted === true
  }

  function save() {
    if (!makeStateDir.running) makeStateDir.running = true
  }

  // Runs before every save; the state directory may not exist yet.
  Process {
    id: makeStateDir
    command: ["mkdir", "-p", root.stateDir]
    onExited: savedFile.setText(JSON.stringify({ highScores: root.scoreTable, muted: root.muted }, null, 2) + "\n")
  }

  FileView {
    id: savedFile
    path: root.stateDir + "/state.json"
    watchChanges: true
    printErrors: false
    atomicWrites: true
    onLoaded: root.loadSaved(text())
    onFileChanged: reload()
  }

  // --- the window over the update terminal ------------------------------

  PanelWindow {
    id: panel

    readonly property var targetScreen: root.place ? root.screenNamed(root.place.screen) : null
    readonly property var place: targetScreen ? root.place : null

    visible: place !== null
    screen: targetScreen
    anchors { top: true; left: true }
    margins {
      top: place ? place.y : 0
      left: place ? place.x : 0
    }
    implicitWidth: place ? place.width : 1
    implicitHeight: place ? place.height : 1
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore

    WlrLayershell.namespace: "omarchy-update-arcade"
    WlrLayershell.layer: WlrLayer.Top
    // Same focus dance as the shell's keyboard panels: a brief Exclusive
    // prime so the game gets the keyboard on show, then OnDemand.
    property bool focusPrimed: false
    WlrLayershell.keyboardFocus: root.playing
      ? (focusPrimed ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive)
      : WlrKeyboardFocus.None

    Connections {
      target: root
      function onPlayingChanged() {
        panel.focusPrimed = false
        if (root.playing) {
          focusPrimeTimer.restart()
          Qt.callLater(function() { game.forceActiveFocus() })
        }
      }
    }

    Timer {
      id: focusPrimeTimer
      interval: 75
      onTriggered: if (root.playing) panel.focusPrimed = true
    }

    // Only the button takes clicks until the game is up, so the terminal
    // underneath stays usable.
    mask: Region { item: root.playing ? arcade : button }

    Item {
      id: arcade
      anchors.fill: parent
      visible: root.playing

      Rectangle {
        anchors.fill: parent
        color: Commons.Color.background
      }

      Game {
        id: game
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: statusStrip.top
        running: root.playing
        ink: Commons.Color.foreground
        accent: Commons.Color.accent
        backdrop: Commons.Color.background
        fontFamily: Style.font.family
        table: root.scoreTable
        muted: root.muted
        onScoreSigned: function(table) { root.scoreTable = table; root.save() }
        onMuteToggled: { root.muted = !root.muted; root.save() }
        updateDone: root.finished
        onHideRequested: root.closeGame()
        onResumed: root.dropSave()
        onResumeDeclined: root.closeGame()
        // A round that ends is not worth saving any more.
        onPhaseChanged: if (phase === "over" && root.saving) root.dropSave()
      }

      // What the update is up to, so nobody has to peek.
      Rectangle {
        id: statusStrip
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Math.round(statusText.implicitHeight + 12)
        color: Util.alpha(Commons.Color.foreground, 0.06)

        Text {
          id: statusText
          anchors.fill: parent
          anchors.leftMargin: 12
          anchors.rightMargin: 12
          verticalAlignment: Text.AlignVCenter
          textFormat: Text.PlainText
          elide: Text.ElideRight
          font.family: Style.font.family
          font.pixelSize: 12
          color: Commons.Color.muted
          text: root.finished
            ? "Update complete  ·  press Q or Esc when you're done" + (root.status ? "  ·  " + root.status : "")
            : "Updating  ·  " + (root.status || "working on it")
        }
      }
    }

    Rectangle {
      id: button
      anchors.top: parent.top
      anchors.right: parent.right
      anchors.margins: 10
      width: label.implicitWidth + 24
      height: label.implicitHeight + 12
      radius: Style.cornerRadius
      color: hover.containsMouse ? Commons.Color.accent : Util.alpha(Commons.Color.background, 0.92)
      border.width: 1
      border.color: root.needsInput && !root.playing ? Commons.Color.urgent : Commons.Color.accent

      Text {
        id: label
        anchors.centerIn: parent
        textFormat: Text.PlainText
        font.family: Style.font.family
        font.pixelSize: 13
        color: hover.containsMouse ? Commons.Color.background : Commons.Color.foreground
        text: root.playing && game.resumeOffer ? "Discard game" : root.finished ? "Close game" : root.playing ? "Show update" : (root.needsInput ? "Update needs you" : "Play Asteroids")
      }

      MouseArea {
        id: hover
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.playing ? root.closeGame() : root.showGame()
      }
    }
  }
}
