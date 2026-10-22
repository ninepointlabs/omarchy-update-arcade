.pragma library

// Asteroids, the game state and rules. No drawing and no Qt: Game.qml feeds
// it input and elapsed time and paints whatever is in the state afterwards.
// Distances are in logical pixels, times in seconds, angles in radians with 0
// pointing up the screen.

var TAU = Math.PI * 2

var SHIP_RADIUS = 11
var TURN_SPEED = 4.6
var THRUST = 340
var DRAG = 0.55              // fraction of speed kept per second
var MAX_SPEED = 520
var BULLET_SPEED = 560
var BULLET_LIFE = 0.95
var MAX_BULLETS = 5
var FIRE_COOLDOWN = 0.16
var RESPAWN_DELAY = 1.8
var SPAWN_SHIELD = 2.5
var HYPERSPACE_COOLDOWN = 1.2
var EXTRA_LIFE_EVERY = 10000
var START_LIVES = 3
var TABLE_SIZE = 10
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 "

// Flying saucers, indexed by size: 2 the big wobbly one, 1 the small sniper.
var SAUCER_RADIUS = [0, 9, 17]
var SAUCER_SCORE = [0, 1000, 200]
var SAUCER_SPEED = [0, 150, 105]
var SAUCER_FIRE_EVERY = [0, 0.85, 1.25]
var SAUCER_BULLET_SPEED = 380
var SAUCER_BULLET_LIFE = 1.15

// The heartbeat: two notes, alternating, speeding up the longer a wave runs.
var BEAT_SLOWEST = 1.0
var BEAT_FASTEST = 0.26
var BEAT_SPEEDUP = 0.025

// Index by rock size: 3 large, 2 medium, 1 small.
var ROCK_RADIUS = [0, 13, 24, 42]
var ROCK_SCORE = [0, 100, 50, 20]
var ROCK_SPEED = [0, 115, 80, 50]

function rand(rng, lo, hi) {
  return lo + rng() * (hi - lo)
}

function wrap(value, size) {
  if (value < 0) return value + size
  if (value >= size) return value - size
  return value
}

// Shortest distance on the torus, so things touching across an edge collide.
function wrappedDistance(ax, ay, bx, by, w, h) {
  var dx = Math.abs(ax - bx)
  var dy = Math.abs(ay - by)
  if (dx > w / 2) dx = w - dx
  if (dy > h / 2) dy = h - dy
  return Math.sqrt(dx * dx + dy * dy)
}

function makeShip(state) {
  return {
    x: state.w / 2, y: state.h / 2,
    vx: 0, vy: 0, angle: 0,
    alive: true, thrusting: false,
    shield: SPAWN_SHIELD
  }
}

// A jagged outline: radius multipliers around the circle, so every rock is
// its own lumpy self.
function makeOutline(rng) {
  var points = []
  var count = 10 + Math.floor(rng() * 4)
  for (var i = 0; i < count; i++) points.push(rand(rng, 0.72, 1.08))
  return points
}

function makeRock(state, size, x, y) {
  var rng = state.rng
  var speed = ROCK_SPEED[size] * rand(rng, 0.7, 1.3) * (1 + state.level * 0.06)
  var heading = rand(rng, 0, TAU)
  return {
    x: x, y: y, size: size,
    r: ROCK_RADIUS[size] * state.scale,
    vx: Math.sin(heading) * speed,
    vy: -Math.cos(heading) * speed,
    angle: rand(rng, 0, TAU),
    spin: rand(rng, -1.2, 1.2),
    outline: makeOutline(rng)
  }
}

// New wave of large rocks along the edges, never on top of the ship.
function spawnWave(state) {
  var count = Math.min(3 + state.level, 11)
  var rng = state.rng
  for (var i = 0; i < count; i++) {
    var x, y
    if (rng() < 0.5) {
      x = rand(rng, 0, state.w)
      y = rng() < 0.5 ? 0 : state.h - 1
    } else {
      x = rng() < 0.5 ? 0 : state.w - 1
      y = rand(rng, 0, state.h)
    }
    state.rocks.push(makeRock(state, 3, x, y))
  }
  state.beatEvery = BEAT_SLOWEST
  state.beatIn = BEAT_SLOWEST
}

// Things the player should hear this frame, for whoever plays sounds.
function emit(state, name) {
  state.events.push(name)
}

// --- high score table ------------------------------------------------------
// A list of {initials, score, date}, best first, at most TABLE_SIZE long.

function cleanTable(table) {
  var out = []
  if (!Array.isArray(table)) return out
  for (var i = 0; i < table.length; i++) {
    var row = table[i]
    if (!row || typeof row.score !== "number" || !isFinite(row.score) || row.score <= 0) continue
    out.push({
      initials: String(row.initials || "???").toUpperCase().slice(0, 3),
      score: Math.floor(row.score),
      date: String(row.date || "")
    })
  }
  out.sort(function(a, b) { return b.score - a.score })
  return out.slice(0, TABLE_SIZE)
}

function topScore(table) {
  return table && table.length ? table[0].score : 0
}

function qualifies(table, score) {
  if (score <= 0) return false
  return table.length < TABLE_SIZE || score > table[table.length - 1].score
}

// Ties go below the scores already there: whoever got there first keeps it.
function insertScore(table, initials, score, date) {
  var rows = cleanTable(table)
  var at = rows.length
  for (var i = 0; i < rows.length; i++) {
    if (score > rows[i].score) { at = i; break }
  }
  rows.splice(at, 0, { initials: String(initials).toUpperCase().slice(0, 3), score: score, date: date || "" })
  return { table: rows.slice(0, TABLE_SIZE), rank: at < TABLE_SIZE ? at : -1 }
}

// Initials entry, arcade style: up/down rolls the letter, left/right or a
// typed character moves along, and the third letter (or Enter) signs it.
function entryRoll(entry, delta) {
  var current = LETTERS.indexOf(entry.initials[entry.pos])
  if (current < 0) current = 0
  var next = LETTERS[(current + delta + LETTERS.length) % LETTERS.length]
  entry.initials = entry.initials.slice(0, entry.pos) + next + entry.initials.slice(entry.pos + 1)
}

function entryType(entry, ch) {
  ch = String(ch || "").toUpperCase()
  if (ch.length !== 1 || LETTERS.indexOf(ch) < 0 || ch === " ") return false
  entry.initials = entry.initials.slice(0, entry.pos) + ch + entry.initials.slice(entry.pos + 1)
  if (entry.pos < 2) { entry.pos += 1; return false }
  return true
}

function entryMove(entry, delta) {
  entry.pos = Math.max(0, Math.min(2, entry.pos + delta))
}

function newGame(w, h, rng, table) {
  var state = {
    w: w, h: h, rng: rng || Math.random,
    scale: Math.max(0.6, Math.min(1.4, Math.min(w, h) / 600)),
    phase: "title",          // title | playing | entry | over
    table: cleanTable(table),
    entry: null,             // {initials, pos} while signing the table
    lastRank: -1,            // row to highlight after signing
    score: 0, highScore: 0,
    lives: START_LIVES, nextLifeAt: EXTRA_LIFE_EVERY,
    level: 0,
    rocks: [], bullets: [], particles: [],
    ship: null,
    saucer: null, saucerBullets: [], saucerIn: 0,
    events: [],
    beatEvery: BEAT_SLOWEST, beatIn: BEAT_SLOWEST, beatNote: 0,
    respawnIn: 0, fireCooldown: 0, hyperCooldown: 0,
    waveDelay: 0,
    time: 0
  }
  state.highScore = topScore(state.table)
  // The title screen drifts a few rocks around behind the text.
  spawnWave(state)
  return state
}

function start(state) {
  state.phase = "playing"
  state.entry = null
  state.lastRank = -1
  state.highScore = topScore(state.table)
  state.score = 0
  state.lives = START_LIVES
  state.nextLifeAt = EXTRA_LIFE_EVERY
  state.level = 1
  state.rocks = []
  state.bullets = []
  state.particles = []
  state.saucer = null
  state.saucerBullets = []
  state.saucerIn = nextSaucerDelay(state)
  state.events = []
  state.ship = makeShip(state)
  state.respawnIn = 0
  state.fireCooldown = 0
  state.hyperCooldown = 0
  state.waveDelay = 0
  spawnWave(state)
}

function resize(state, w, h) {
  if (w <= 0 || h <= 0) return
  var fx = w / state.w
  var fy = h / state.h
  var all = state.rocks.concat(state.bullets, state.particles, state.saucerBullets)
  if (state.ship) all.push(state.ship)
  if (state.saucer) all.push(state.saucer)
  for (var i = 0; i < all.length; i++) {
    all[i].x = wrap(all[i].x * fx, w)
    all[i].y = wrap(all[i].y * fy, h)
  }
  state.w = w
  state.h = h
}

function burst(state, x, y, count, speed) {
  var rng = state.rng
  for (var i = 0; i < count; i++) {
    var heading = rand(rng, 0, TAU)
    var v = rand(rng, 0.2, 1) * speed
    var life = rand(rng, 0.4, 1.0)
    state.particles.push({
      x: wrap(x, state.w), y: wrap(y, state.h),
      vx: Math.sin(heading) * v, vy: -Math.cos(heading) * v,
      life: life, maxLife: life
    })
  }
}

function addScore(state, points) {
  state.score += points
  if (state.score > state.highScore) state.highScore = state.score
  while (state.score >= state.nextLifeAt) {
    state.lives += 1
    state.nextLifeAt += EXTRA_LIFE_EVERY
    emit(state, "extra-life")
  }
}

var BANG = ["", "bang-small", "bang-medium", "bang-large"]

// noScore: a saucer's doing, which earns the player nothing.
function breakRock(state, index, noScore) {
  var rock = state.rocks[index]
  state.rocks.splice(index, 1)
  if (!noScore) addScore(state, ROCK_SCORE[rock.size])
  emit(state, BANG[rock.size])
  burst(state, rock.x, rock.y, 6 + rock.size * 4, 140)
  if (rock.size > 1) {
    state.rocks.push(makeRock(state, rock.size - 1, rock.x, rock.y))
    state.rocks.push(makeRock(state, rock.size - 1, rock.x, rock.y))
  }
}

function killShip(state) {
  var ship = state.ship
  ship.alive = false
  ship.thrusting = false
  burst(state, ship.x, ship.y, 28, 220)
  emit(state, "ship-boom")
  state.lives -= 1
  if (state.lives <= 0) {
    endGame(state)
  } else {
    state.respawnIn = RESPAWN_DELAY
  }
}

function endGame(state) {
  state.lastRank = -1
  state.saucer = null
  state.saucerBullets = []
  if (qualifies(state.table, state.score)) {
    state.phase = "entry"
    state.entry = { initials: "AAA", pos: 0, since: state.time }
  } else {
    state.phase = "over"
  }
}

// Sign the table with the entry's initials. Returns the new table.
function signEntry(state, date) {
  var result = insertScore(state.table, state.entry.initials, state.score, date)
  state.table = result.table
  state.lastRank = result.rank
  state.highScore = topScore(state.table)
  state.entry = null
  state.phase = "over"
  return state.table
}

// The center has to be clear before a new ship appears there.
function spawnClear(state) {
  var cx = state.w / 2
  var cy = state.h / 2
  var room = 90 * state.scale
  for (var i = 0; i < state.rocks.length; i++) {
    var r = state.rocks[i]
    if (wrappedDistance(r.x, r.y, cx, cy, state.w, state.h) < r.r + room) return false
  }
  return !state.saucer
}

// --- flying saucers ----------------------------------------------------------

function nextSaucerDelay(state) {
  return rand(state.rng, 9, 16) - Math.min(state.level, 6) * 0.8
}

// The small one shows up more as the game goes on, and always past 40,000.
function smallSaucerChance(state) {
  if (state.score >= 40000) return 1
  if (state.score >= 10000) return 0.7
  return Math.min(0.12 + state.level * 0.08, 0.6)
}

function spawnSaucer(state) {
  var rng = state.rng
  var size = rng() < smallSaucerChance(state) ? 1 : 2
  var r = SAUCER_RADIUS[size] * state.scale
  var fromLeft = rng() < 0.5
  var speed = SAUCER_SPEED[size] * state.scale
  state.saucer = {
    size: size, r: r,
    x: fromLeft ? -r : state.w + r,
    y: rand(rng, state.h * 0.12, state.h * 0.88),
    vx: fromLeft ? speed : -speed,
    vy: 0,
    fireIn: SAUCER_FIRE_EVERY[size] * 0.6,
    turnIn: rand(rng, 0.8, 1.8)
  }
}

function saucerAim(state, saucer) {
  var ship = state.ship
  if (saucer.size === 2 || !ship || !ship.alive) return rand(state.rng, 0, TAU)
  // Shortest way to the ship across the edges, then a miss that shrinks
  // with every level.
  var dx = ship.x - saucer.x
  var dy = ship.y - saucer.y
  if (dx > state.w / 2) dx -= state.w
  if (dx < -state.w / 2) dx += state.w
  if (dy > state.h / 2) dy -= state.h
  if (dy < -state.h / 2) dy += state.h
  var spread = Math.max(0.06, 0.36 - Math.min(state.level, 8) * 0.04)
  return Math.atan2(dx, -dy) + rand(state.rng, -spread, spread)
}

function destroySaucer(state, award) {
  var saucer = state.saucer
  state.saucer = null
  if (award) addScore(state, SAUCER_SCORE[saucer.size])
  burst(state, saucer.x, saucer.y, 22, 200)
  emit(state, "saucer-boom")
  state.saucerIn = nextSaucerDelay(state)
}

function updateSaucer(state, dt) {
  var saucer = state.saucer
  if (!saucer) {
    state.saucerIn -= dt
    if (state.saucerIn <= 0 && state.rocks.length > 0) spawnSaucer(state)
    return
  }

  saucer.x += saucer.vx * dt
  saucer.y = wrap(saucer.y + saucer.vy * dt, state.h)
  // Saucers cross once and leave; they don't wrap sideways.
  if (saucer.x < -saucer.r * 2 || saucer.x > state.w + saucer.r * 2) {
    state.saucer = null
    state.saucerIn = nextSaucerDelay(state)
    return
  }

  saucer.turnIn -= dt
  if (saucer.turnIn <= 0) {
    var choices = [-0.7, 0, 0.7]
    saucer.vy = choices[Math.floor(state.rng() * 3)] * Math.abs(saucer.vx)
    saucer.turnIn = rand(state.rng, 0.8, 1.8)
  }

  saucer.fireIn -= dt
  if (saucer.fireIn <= 0) {
    var angle = saucerAim(state, saucer)
    var speed = SAUCER_BULLET_SPEED * state.scale
    state.saucerBullets.push({
      x: wrap(saucer.x, state.w), y: saucer.y,
      vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed,
      life: SAUCER_BULLET_LIFE
    })
    saucer.fireIn = SAUCER_FIRE_EVERY[saucer.size]
    emit(state, "saucer-fire")
  }
}

function moveAll(list, dt, w, h) {
  for (var i = 0; i < list.length; i++) {
    list[i].x = wrap(list[i].x + list[i].vx * dt, w)
    list[i].y = wrap(list[i].y + list[i].vy * dt, h)
  }
}

function updateShip(state, dt, input) {
  var ship = state.ship
  if (input.left) ship.angle -= TURN_SPEED * dt
  if (input.right) ship.angle += TURN_SPEED * dt
  ship.thrusting = !!input.thrust
  if (ship.thrusting) {
    ship.vx += Math.sin(ship.angle) * THRUST * dt
    ship.vy -= Math.cos(ship.angle) * THRUST * dt
  }
  var keep = Math.pow(DRAG, dt)
  ship.vx *= keep
  ship.vy *= keep
  var speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy)
  if (speed > MAX_SPEED) {
    ship.vx *= MAX_SPEED / speed
    ship.vy *= MAX_SPEED / speed
  }
  ship.x = wrap(ship.x + ship.vx * dt, state.w)
  ship.y = wrap(ship.y + ship.vy * dt, state.h)
  ship.shield = Math.max(0, ship.shield - dt)

  if (input.fire && state.fireCooldown <= 0 && state.bullets.length < MAX_BULLETS) {
    var nose = SHIP_RADIUS * state.scale
    state.bullets.push({
      x: wrap(ship.x + Math.sin(ship.angle) * nose, state.w),
      y: wrap(ship.y - Math.cos(ship.angle) * nose, state.h),
      vx: ship.vx + Math.sin(ship.angle) * BULLET_SPEED,
      vy: ship.vy - Math.cos(ship.angle) * BULLET_SPEED,
      life: BULLET_LIFE
    })
    state.fireCooldown = FIRE_COOLDOWN
    emit(state, "fire")
  }

  if (input.hyperspace && state.hyperCooldown <= 0) {
    burst(state, ship.x, ship.y, 10, 90)
    ship.x = rand(state.rng, 0, state.w)
    ship.y = rand(state.rng, 0, state.h)
    ship.vx = 0
    ship.vy = 0
    state.hyperCooldown = HYPERSPACE_COOLDOWN
    emit(state, "hyperspace")
  }
}

function hits(a, b, reach, state) {
  return wrappedDistance(a.x, a.y, wrap(b.x, state.w), b.y, state.w, state.h) < reach
}

function collide(state) {
  var w = state.w
  var h = state.h
  for (var b = state.bullets.length - 1; b >= 0; b--) {
    var bullet = state.bullets[b]
    if (state.saucer && hits(bullet, state.saucer, state.saucer.r, state)) {
      state.bullets.splice(b, 1)
      destroySaucer(state, true)
      continue
    }
    for (var r = state.rocks.length - 1; r >= 0; r--) {
      var rock = state.rocks[r]
      if (wrappedDistance(bullet.x, bullet.y, rock.x, rock.y, w, h) < rock.r) {
        state.bullets.splice(b, 1)
        breakRock(state, r)
        break
      }
    }
  }

  // Saucer shots break rocks too, for no points.
  for (var sb = state.saucerBullets.length - 1; sb >= 0; sb--) {
    var shot = state.saucerBullets[sb]
    for (var sr = state.rocks.length - 1; sr >= 0; sr--) {
      if (wrappedDistance(shot.x, shot.y, state.rocks[sr].x, state.rocks[sr].y, w, h) < state.rocks[sr].r) {
        state.saucerBullets.splice(sb, 1)
        breakRock(state, sr, true)
        break
      }
    }
  }

  // Not while it's still sliding in from the side, where the wave's rocks
  // also start.
  var saucerIn = state.saucer && state.saucer.x >= 0 && state.saucer.x < w
  if (saucerIn) {
    for (var ri = state.rocks.length - 1; ri >= 0; ri--) {
      if (hits(state.rocks[ri], state.saucer, state.rocks[ri].r + state.saucer.r * 0.8, state)) {
        breakRock(state, ri, true)
        destroySaucer(state, false)
        break
      }
    }
  }

  var ship = state.ship
  if (!ship || !ship.alive || ship.shield > 0) return
  var shipR = SHIP_RADIUS * state.scale * 0.8

  for (var si = state.saucerBullets.length - 1; si >= 0; si--) {
    var s2 = state.saucerBullets[si]
    if (wrappedDistance(ship.x, ship.y, s2.x, s2.y, w, h) < shipR) {
      state.saucerBullets.splice(si, 1)
      killShip(state)
      return
    }
  }

  if (state.saucer && hits(ship, state.saucer, state.saucer.r + shipR, state)) {
    destroySaucer(state, true)
    killShip(state)
    return
  }

  for (var i = state.rocks.length - 1; i >= 0; i--) {
    var rk = state.rocks[i]
    if (wrappedDistance(ship.x, ship.y, rk.x, rk.y, w, h) < rk.r + shipR) {
      breakRock(state, i)
      killShip(state)
      return
    }
  }
}

// Advance the world by dt seconds. input: {left, right, thrust, fire, hyperspace}.
function step(state, dt, input) {
  dt = Math.min(dt, 0.05)   // a long stall (hidden, suspended) is not a teleport
  state.time += dt
  state.events = []
  input = input || {}

  state.fireCooldown = Math.max(0, state.fireCooldown - dt)
  state.hyperCooldown = Math.max(0, state.hyperCooldown - dt)

  for (var i = 0; i < state.rocks.length; i++) state.rocks[i].angle += state.rocks[i].spin * dt
  moveAll(state.rocks, dt, state.w, state.h)
  moveAll(state.bullets, dt, state.w, state.h)
  moveAll(state.particles, dt, state.w, state.h)
  moveAll(state.saucerBullets, dt, state.w, state.h)

  for (var b = state.bullets.length - 1; b >= 0; b--) {
    state.bullets[b].life -= dt
    if (state.bullets[b].life <= 0) state.bullets.splice(b, 1)
  }
  for (var sb = state.saucerBullets.length - 1; sb >= 0; sb--) {
    state.saucerBullets[sb].life -= dt
    if (state.saucerBullets[sb].life <= 0) state.saucerBullets.splice(sb, 1)
  }
  for (var p = state.particles.length - 1; p >= 0; p--) {
    state.particles[p].life -= dt
    if (state.particles[p].life <= 0) state.particles.splice(p, 1)
  }

  if (state.phase !== "playing") return

  if (state.ship.alive) {
    updateShip(state, dt, input)
  } else if (state.respawnIn > 0) {
    state.respawnIn -= dt
  } else if (spawnClear(state)) {
    state.ship = makeShip(state)
  }

  updateSaucer(state, dt)
  collide(state)

  if (state.phase === "playing" && state.rocks.length > 0) {
    state.beatIn -= dt
    if (state.beatIn <= 0) {
      emit(state, state.beatNote === 0 ? "beat1" : "beat2")
      state.beatNote = 1 - state.beatNote
      state.beatEvery = Math.max(BEAT_FASTEST, state.beatEvery - BEAT_SPEEDUP)
      state.beatIn = state.beatEvery
    }
  }

  if (state.phase === "playing" && state.rocks.length === 0) {
    if (state.waveDelay <= 0) state.waveDelay = 1.5
    state.waveDelay -= dt
    if (state.waveDelay <= 0) {
      state.level += 1
      spawnWave(state)
    }
  }
}

// --- save and resume ---------------------------------------------------------
// A successful update ends by restarting the shell, which takes the game with
// it. The round in progress is kept as plain data and offered back after.
// Bullets, particles and saucers are left out: they are gone in a second anyway.

var SAVE_VERSION = 1
var SAVE_MAX_AGE = 10 * 60 * 1000   // ms
var SAVE_MAX_ROCKS = 100
var SAVE_MAX_BYTES = 64 * 1024

function snapshot(state, now) {
  if (!state || (state.phase !== "playing" && state.phase !== "entry")) return null
  var ship = state.phase === "playing" && state.ship && state.ship.alive ? state.ship : null
  return {
    version: SAVE_VERSION,
    savedAt: now,
    phase: state.phase,
    w: state.w, h: state.h,
    score: state.score,
    lives: state.lives,
    level: state.level,
    ship: ship ? { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy, angle: ship.angle } : null,
    rocks: state.phase === "playing" ? state.rocks.map(function(r) {
      return { x: r.x, y: r.y, size: r.size, vx: r.vx, vy: r.vy, angle: r.angle, spin: r.spin, outline: r.outline.slice() }
    }) : [],
    entry: state.phase === "entry" && state.entry ? { initials: state.entry.initials, pos: state.entry.pos } : null
  }
}

// Ten minutes covers the restart; a minute of slack for a clock that moved.
function saveFresh(savedAt, now) {
  return now - savedAt <= SAVE_MAX_AGE && savedAt - now <= 60 * 1000
}

function finite(value, limit) {
  return typeof value === "number" && isFinite(value) && Math.abs(value) <= limit
}

function wholeIn(value, lo, hi) {
  return typeof value === "number" && Math.floor(value) === value && value >= lo && value <= hi
}

// The save file, checked field by field. Returns a clean copy, or null for
// anything stale, corrupt or odd; the caller deletes the file then.
function readSave(text, now) {
  if (typeof text !== "string" || text.length === 0 || text.length > SAVE_MAX_BYTES) return null
  var data
  try { data = JSON.parse(text) } catch (e) { return null }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  if (data.version !== SAVE_VERSION || !finite(data.savedAt, 1e15)) return null
  if (!saveFresh(data.savedAt, now)) return null
  if (data.phase !== "playing" && data.phase !== "entry") return null
  if (!finite(data.w, 20000) || !finite(data.h, 20000) || data.w < 100 || data.h < 100) return null
  if (!wholeIn(data.score, 0, 1e9) || !wholeIn(data.level, 1, 999)) return null
  if (!wholeIn(data.lives, data.phase === "playing" ? 1 : 0, 99)) return null

  var out = {
    savedAt: data.savedAt, phase: data.phase, w: data.w, h: data.h,
    score: data.score, lives: data.lives, level: data.level,
    ship: null, rocks: [], entry: null
  }
  var far = 1e5
  if (data.ship !== null && data.ship !== undefined) {
    var sh = data.ship
    if (!sh || typeof sh !== "object") return null
    if (!finite(sh.x, far) || !finite(sh.y, far) || !finite(sh.vx, far) || !finite(sh.vy, far) || !finite(sh.angle, far)) return null
    out.ship = { x: sh.x, y: sh.y, vx: sh.vx, vy: sh.vy, angle: sh.angle }
  }
  if (!Array.isArray(data.rocks) || data.rocks.length > SAVE_MAX_ROCKS) return null
  for (var i = 0; i < data.rocks.length; i++) {
    var r = data.rocks[i]
    if (!r || typeof r !== "object" || !wholeIn(r.size, 1, 3)) return null
    if (!finite(r.x, far) || !finite(r.y, far) || !finite(r.vx, far) || !finite(r.vy, far)
        || !finite(r.angle, far) || !finite(r.spin, 10)) return null
    if (!Array.isArray(r.outline) || r.outline.length < 3 || r.outline.length > 32) return null
    for (var j = 0; j < r.outline.length; j++) {
      if (!finite(r.outline[j], 2) || r.outline[j] < 0.3) return null
    }
    out.rocks.push({ x: r.x, y: r.y, size: r.size, vx: r.vx, vy: r.vy, angle: r.angle, spin: r.spin, outline: r.outline.slice() })
  }
  if (data.phase === "entry") {
    var e = data.entry
    if (!e || typeof e !== "object" || typeof e.initials !== "string" || e.initials.length !== 3 || !wholeIn(e.pos, 0, 2)) return null
    for (var c = 0; c < 3; c++) {
      if (LETTERS.indexOf(e.initials[c]) < 0) return null
    }
    out.entry = { initials: e.initials, pos: e.pos }
  }
  return out
}

function clampSpeed(o, limit) {
  var speed = Math.sqrt(o.vx * o.vx + o.vy * o.vy)
  if (speed > limit) {
    o.vx *= limit / speed
    o.vy *= limit / speed
  }
}

// Picks a checked save back up in a game of whatever size the overlay is now.
// The ship comes back shielded, so nobody resumes into a rock.
function resume(state, save) {
  start(state)
  var fx = state.w / save.w
  var fy = state.h / save.h
  state.score = save.score
  state.lives = save.lives
  state.level = save.level
  state.nextLifeAt = (Math.floor(save.score / EXTRA_LIFE_EVERY) + 1) * EXTRA_LIFE_EVERY
  if (state.score > state.highScore) state.highScore = state.score
  state.saucerIn = nextSaucerDelay(state)
  if (save.phase === "entry") {
    state.rocks = []
    state.ship = null
    state.phase = "entry"
    state.entry = { initials: save.entry.initials, pos: save.entry.pos, since: state.time }
    return
  }
  state.rocks = save.rocks.map(function(r) {
    var rock = {
      x: wrap(((r.x % save.w) + save.w) % save.w * fx, state.w),
      y: wrap(((r.y % save.h) + save.h) % save.h * fy, state.h),
      size: r.size, r: ROCK_RADIUS[r.size] * state.scale,
      vx: r.vx, vy: r.vy, angle: r.angle, spin: r.spin, outline: r.outline.slice()
    }
    clampSpeed(rock, ROCK_SPEED[3] * 4 * (1 + save.level * 0.06))
    return rock
  })
  if (save.ship) {
    var ship = state.ship
    ship.x = wrap(((save.ship.x % save.w) + save.w) % save.w * fx, state.w)
    ship.y = wrap(((save.ship.y % save.h) + save.h) % save.h * fy, state.h)
    ship.vx = save.ship.vx
    ship.vy = save.ship.vy
    ship.angle = save.ship.angle % TAU
    clampSpeed(ship, MAX_SPEED)
  }
}

// Saucer outline as polylines in local coordinates: the hull, the rim line
// across it, and the dome on top.
function saucerLines(r) {
  return [
    [[-r, 0], [-r * 0.45, -r * 0.4], [r * 0.45, -r * 0.4], [r, 0], [r * 0.5, r * 0.4], [-r * 0.5, r * 0.4], [-r, 0]],
    [[-r, 0], [r, 0]],
    [[-r * 0.45, -r * 0.4], [-r * 0.25, -r * 0.8], [r * 0.25, -r * 0.8], [r * 0.45, -r * 0.4]]
  ]
}

// Ship outline in local coordinates (nose up), scaled.
function shipPoints(scale) {
  var r = SHIP_RADIUS * scale
  return [[0, -r * 1.25], [r * 0.85, r], [0, r * 0.55], [-r * 0.85, r]]
}
