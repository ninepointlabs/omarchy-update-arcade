import QtQuick
import "Asteroids.js" as Asteroids

// The playfield: vector Asteroids drawn in the theme's colors. Owns the
// keyboard while it has focus; the caller pauses it by clearing `running`.
FocusScope {
  id: root

  property bool running: false
  property color ink: "white"
  property color accent: "white"
  property color backdrop: "black"
  property string fontFamily: "monospace"
  // Top ten as [{initials, score, date}], loaded and saved by the caller.
  property var table: []
  property bool muted: false
  // A checked save (Asteroids.readSave) to offer back; null when there is none.
  property var resumeOffer: null
  // Q leaves too, once the update is over. Off otherwise, and never during
  // initials entry, where Q is a letter.
  property bool quitWithQ: false

  signal scoreSigned(var table)
  signal hideRequested()
  signal muteToggled()
  signal resumed()
  signal resumeDeclined()

  property var state: null
  property bool paused: false
  // Mirrors state.phase === "playing" as a real property: the game state is a
  // plain JS object, so a binding that reads it never hears it change.
  property bool inPlay: false
  // The same for the whole phase (title | playing | entry | over), so the
  // caller can tell a round in progress from one that is done.
  property string phase: "title"
  readonly property bool soundOn: sounds.item ? sounds.item.active : false
  readonly property var held: ({})

  function input() {
    return {
      left: !!(held[Qt.Key_Left] || held[Qt.Key_A]),
      right: !!(held[Qt.Key_Right] || held[Qt.Key_D]),
      thrust: !!(held[Qt.Key_Up] || held[Qt.Key_W]),
      fire: !!held[Qt.Key_Space],
      hyperspace: !!(held[Qt.Key_Down] || held[Qt.Key_S] || held[Qt.Key_Shift])
    }
  }

  function ensureState() {
    if (!state && width > 0 && height > 0) state = Asteroids.newGame(width, height, Math.random, table)
  }

  function releaseKeys() {
    for (var key in held) delete held[key]
  }

  onWidthChanged: if (state) Asteroids.resize(state, width, height); else ensureState()
  onHeightChanged: if (state) Asteroids.resize(state, width, height); else ensureState()
  onRunningChanged: {
    releaseKeys()
    if (running) {
      ensureState()
      keys.forceActiveFocus()
    } else if (state && state.phase === "playing") {
      paused = true
    }
  }
  // A table loaded after the game was created, or signed in another session.
  onTableChanged: {
    if (!state || state.phase === "entry") return
    state.table = Asteroids.cleanTable(table)
    if (state.phase !== "playing") state.highScore = Asteroids.topScore(state.table)
  }

  function today() {
    return Qt.formatDate(new Date(), "yyyy-MM-dd")
  }

  function acceptResume() {
    ensureState()
    if (!state || !resumeOffer) return
    Asteroids.resume(state, resumeOffer)
    paused = false
    resumeOffer = null
    phase = state.phase
    inPlay = state.phase === "playing"
    root.resumed()
  }

  function sign() {
    root.scoreSigned(Asteroids.signEntry(root.state, today()))
  }

  // Initials entry eats every key except Esc; returns true when it did.
  function entryKey(event) {
    var s = root.state
    if (!s || s.phase !== "entry") return false
    var e = s.entry
    // Swallow the fire button still being mashed when the last ship went.
    if (s.time - e.since < 0.8) return true
    if (event.key === Qt.Key_Up) Asteroids.entryRoll(e, 1)
    else if (event.key === Qt.Key_Down) Asteroids.entryRoll(e, -1)
    else if (event.key === Qt.Key_Left || event.key === Qt.Key_Backspace) Asteroids.entryMove(e, -1)
    else if (event.key === Qt.Key_Right) Asteroids.entryMove(e, 1)
    else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) root.sign()
    else if (event.key === Qt.Key_Space) { if (e.pos < 2) Asteroids.entryMove(e, 1); else root.sign() }
    else if (Asteroids.entryType(e, event.text)) root.sign()
    canvas.requestPaint()
    return true
  }

  Rectangle {
    anchors.fill: parent
    color: root.backdrop
  }

  Item {
    id: keys
    anchors.fill: parent
    focus: true

    Keys.onPressed: function(event) {
      if (event.isAutoRepeat) { event.accepted = true; return }
      var s = root.state
      // The resume prompt takes only its two answers.
      if (root.resumeOffer) {
        if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) root.acceptResume()
        else if (event.key === Qt.Key_Escape || (event.key === Qt.Key_Q && root.quitWithQ)) root.resumeDeclined()
        canvas.requestPaint()
        event.accepted = true
        return
      }
      if (event.key !== Qt.Key_Escape && root.entryKey(event)) {
        event.accepted = true
        return
      }
      if (event.key === Qt.Key_Escape || (event.key === Qt.Key_Q && root.quitWithQ)) {
        root.hideRequested()
      } else if (event.key === Qt.Key_M) {
        root.muteToggled()
      } else if (event.key === Qt.Key_P && s && s.phase === "playing") {
        root.paused = !root.paused
      } else if ((event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                 && s && (s.phase === "title" || s.phase === "over")) {
        Asteroids.start(s)
        root.paused = false
      } else if (root.paused && event.key !== Qt.Key_Escape) {
        root.paused = false
      }
      root.held[event.key] = true
      event.accepted = true
    }

    Keys.onReleased: function(event) {
      if (event.isAutoRepeat) return
      delete root.held[event.key]
      event.accepted = true
    }
  }

  FrameAnimation {
    running: root.running && root.visible
    onTriggered: {
      var s = root.state
      if (!s) return
      if (!root.paused) {
        Asteroids.step(s, frameTime, root.input())
        root.inPlay = s.phase === "playing"
        root.phase = s.phase
        var board = sounds.item
        if (board) for (var i = 0; i < s.events.length; i++) board.play(s.events[i])
      }
      canvas.requestPaint()
    }
  }

  // Optional: Sounds.qml needs Qt Multimedia, and the game is fine without it.
  Loader {
    id: sounds
    source: "Sounds.qml"
    asynchronous: true
    Binding {
      target: sounds.item
      when: sounds.item !== null
      property: "active"
      value: root.running && !root.paused && !root.muted && root.inPlay
    }
  }

  // Loops follow the world each frame rather than through bindings, since
  // the game state is a plain JS object.
  FrameAnimation {
    running: sounds.item !== null && root.running
    onTriggered: {
      var s = root.state
      var board = sounds.item
      board.thrusting = !!(s && s.ship && s.ship.alive && s.ship.thrusting)
      board.saucer = s && s.saucer ? s.saucer.size : 0
    }
  }

  Canvas {
    id: canvas
    anchors.fill: parent
    renderStrategy: Canvas.Cooperative

    function drawShip(ctx, ship, scale, flame) {
      var pts = Asteroids.shipPoints(scale)
      ctx.save()
      ctx.translate(ship.x, ship.y)
      ctx.rotate(ship.angle)
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
      ctx.stroke()
      if (flame) {
        var r = 11 * scale
        ctx.beginPath()
        ctx.moveTo(-r * 0.4, r * 0.8)
        ctx.lineTo(0, r * (1.4 + Math.random() * 0.6))
        ctx.lineTo(r * 0.4, r * 0.8)
        ctx.strokeStyle = root.accent
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawSaucer(ctx, saucer) {
      var lines = Asteroids.saucerLines(saucer.r)
      ctx.strokeStyle = root.ink
      ctx.save()
      ctx.translate(saucer.x, saucer.y)
      for (var l = 0; l < lines.length; l++) {
        ctx.beginPath()
        ctx.moveTo(lines[l][0][0], lines[l][0][1])
        for (var i = 1; i < lines[l].length; i++) ctx.lineTo(lines[l][i][0], lines[l][i][1])
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawRock(ctx, rock) {
      var n = rock.outline.length
      ctx.beginPath()
      for (var i = 0; i < n; i++) {
        var a = rock.angle + i / n * Math.PI * 2
        var x = rock.x + Math.sin(a) * rock.r * rock.outline[i]
        var y = rock.y - Math.cos(a) * rock.r * rock.outline[i]
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
    }

    function text(ctx, value, x, y, size, align, color) {
      ctx.font = "bold " + Math.round(size) + "px \"" + root.fontFamily + "\""
      ctx.textAlign = align
      ctx.fillStyle = color
      ctx.fillText(value, x, y)
    }

    // The top ten, as many rows as fit; the row just signed blinks.
    function drawTable(ctx, s, cx, top, k) {
      var rows = s.table
      var line = 22 * k
      var room = Math.max(0, Math.floor((height - top - 40 * k) / line))
      if (rows.length === 0) {
        text(ctx, "no high scores yet — be the first", cx, top + line, 14 * k, "center", root.ink)
        return
      }
      text(ctx, "HIGH SCORES", cx, top, 14 * k, "center", root.accent)
      for (var i = 0; i < Math.min(rows.length, room - 1); i++) {
        var y = top + (i + 1.4) * line
        var mine = i === s.lastRank
        if (mine && Math.floor(s.time * 4) % 2 === 1) continue
        var color = mine ? root.accent : root.ink
        text(ctx, (i + 1) + ".", cx - 90 * k, y, 16 * k, "right", color)
        text(ctx, rows[i].initials, cx - 70 * k, y, 16 * k, "left", color)
        text(ctx, String(rows[i].score), cx + 100 * k, y, 16 * k, "right", color)
      }
    }

    function drawEntry(ctx, s, cx, cy, k) {
      text(ctx, "NEW HIGH SCORE", cx, cy - 70 * k, 30 * k, "center", root.accent)
      text(ctx, String(s.score), cx, cy - 34 * k, 22 * k, "center", root.ink)
      var e = s.entry
      var cell = 40 * k
      for (var i = 0; i < 3; i++) {
        var x = cx + (i - 1) * cell
        var active = i === e.pos
        if (!active || Math.floor(s.time * 3) % 2 === 0) {
          text(ctx, e.initials[i], x, cy + 30 * k, 36 * k, "center", active ? root.accent : root.ink)
        }
        ctx.fillStyle = active ? root.accent : root.ink
        ctx.fillRect(x - 14 * k, cy + 40 * k, 28 * k, 2 * k)
      }
      text(ctx, "type your initials, or ↑ ↓ to pick and ENTER to sign", cx, cy + 80 * k, 13 * k, "center", root.ink)
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      ctx.clearRect(0, 0, width, height)
      var s = root.state
      if (!s) return
      var k = s.scale
      ctx.lineWidth = Math.max(1.5, 1.6 * k)
      ctx.lineJoin = "round"
      ctx.strokeStyle = root.ink

      for (var i = 0; i < s.rocks.length; i++) drawRock(ctx, s.rocks[i])

      ctx.fillStyle = root.accent
      for (var b = 0; b < s.bullets.length; b++) {
        ctx.beginPath()
        ctx.arc(s.bullets[b].x, s.bullets[b].y, 2 * k, 0, Math.PI * 2)
        ctx.fill()
      }

      for (var p = 0; p < s.particles.length; p++) {
        var part = s.particles[p]
        ctx.globalAlpha = Math.max(0, part.life / part.maxLife)
        ctx.fillRect(part.x - k, part.y - k, 2 * k, 2 * k)
      }
      ctx.globalAlpha = 1

      ctx.fillStyle = root.ink
      for (var sb = 0; sb < s.saucerBullets.length; sb++) {
        ctx.beginPath()
        ctx.arc(s.saucerBullets[sb].x, s.saucerBullets[sb].y, 2 * k, 0, Math.PI * 2)
        ctx.fill()
      }
      if (s.saucer) drawSaucer(ctx, s.saucer)

      var ship = s.ship
      if (s.phase === "playing" && ship && ship.alive) {
        // Blink while the spawn shield is up.
        if (ship.shield <= 0 || Math.floor(s.time * 8) % 2 === 0) {
          ctx.strokeStyle = root.ink
          drawShip(ctx, ship, k, ship.thrusting && !root.paused)
        }
      }

      var pad = 16 * k
      var hud = 20 * k
      if (s.phase !== "title") {
        text(ctx, String(s.score), pad, pad + hud, hud, "left", root.ink)
        ctx.strokeStyle = root.ink
        ctx.lineWidth = Math.max(1, 1.2 * k)
        for (var l = 0; l < Math.min(s.lives, 8); l++) {
          drawShip(ctx, { x: pad + 8 * k + l * 18 * k, y: pad + hud * 2.1, angle: 0 }, k * 0.65, false)
        }
      }
      // Top center: the top-right corner belongs to the Show update button.
      text(ctx, "HI " + s.highScore, width / 2, pad + hud, hud * 0.8, "center", root.accent)
      if (root.muted && sounds.item) text(ctx, "MUTED", width / 2, pad + hud * 2, hud * 0.55, "center", root.ink)

      var cx = width / 2
      var cy = height / 2
      if (root.resumeOffer) {
        var o = root.resumeOffer
        text(ctx, "RESUME YOUR GAME?", cx, cy - 34 * k, 34 * k, "center", root.ink)
        text(ctx, o.phase === "entry" ? o.score + "  ·  a high score to sign"
                                      : o.score + "  ·  wave " + o.level + "  ·  " + o.lives + (o.lives === 1 ? " ship" : " ships"),
             cx, cy + 2 * k, 16 * k, "center", root.ink)
        text(ctx, "ENTER to resume  ·  ESC to discard", cx, cy + 32 * k, 16 * k, "center", root.accent)
      } else if (s.phase === "title") {
        text(ctx, "ASTEROIDS", cx, height * 0.2 + 20 * k, 46 * k, "center", root.ink)
        text(ctx, "SPACE to start", cx, height * 0.2 + 52 * k, 16 * k, "center", root.accent)
        drawTable(ctx, s, cx, height * 0.2 + 92 * k, k)
        text(ctx, "← → turn   ↑ thrust   SPACE fire   ↓ hyperspace   P pause   M mute   ESC back to the update",
             cx, height - pad, 12 * k, "center", root.ink)
      } else if (s.phase === "entry") {
        drawEntry(ctx, s, cx, cy, k)
      } else if (s.phase === "over") {
        text(ctx, "GAME OVER", cx, height * 0.2 + 20 * k, 40 * k, "center", root.ink)
        text(ctx, "SPACE to play again", cx, height * 0.2 + 52 * k, 16 * k, "center", root.accent)
        drawTable(ctx, s, cx, height * 0.2 + 92 * k, k)
      } else if (root.paused) {
        text(ctx, "PAUSED", cx, cy, 34 * k, "center", root.ink)
        text(ctx, "any key to resume", cx, cy + 30 * k, 16 * k, "center", root.accent)
      } else if (s.rocks.length === 0) {
        text(ctx, "WAVE " + (s.level + 1), cx, cy, 30 * k, "center", root.accent)
      }
    }
  }
}
