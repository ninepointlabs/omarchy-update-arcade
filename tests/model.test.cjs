#!/usr/bin/env node
"use strict";
// Model.js (probe parsing, prompt detection) and Asteroids.js (game rules).
// Both are QML `.pragma library` files; the pragma line is dropped and the
// rest runs as plain JS. Offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
function load(file) {
  const ctx = {};
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(root, file), "utf8").replace(/^\.pragma library\s*$/m, "");
  vm.runInContext(src, ctx);
  return ctx;
}
const model = load("Model.js");
const game = load("Asteroids.js");

// ------------------------------------------------------------- Model --
const ESC = "\x1b";

assert.equal(model.stripAnsi(`${ESC}[32mRestarting shell${ESC}[0m`), "Restarting shell");
assert.equal(model.stripAnsi(`${ESC}[?2004hx${ESC}[?2004l`), "x");
assert.equal(model.stripAnsi(`${ESC}]0;title${ESC}\\ok`), "ok");

// Last line: spinners redraw with \r, the last visible frame wins.
assert.equal(model.lastLine("one\r\ntwo\r\n  building foo 10%\rbuilding foo 90%\r\n\r\n"), "building foo 90%");
assert.equal(model.lastLine(""), "");
// gum's key hint row is skipped.
assert.equal(model.lastLine("Remove 1 orphaned package(s)?\r\n\r\n←→ toggle • enter submit • y Yes • n No"),
  "Remove 1 orphaned package(s)?");

// Prompts: gum turns bracketed paste on while it reads.
const gumOpen = `Orphan system packages\r\n${ESC}[?2004h Remove 1 orphaned package(s)?\r\n Yes  No`;
const gumClosed = gumOpen + `${ESC}[?2004lKeeping orphaned packages.\r\n`;
assert.equal(model.needsInput(gumOpen, 1), true);
assert.equal(model.needsInput(gumOpen, 0), false, "output still moving");
assert.equal(model.needsInput(gumClosed, 5), false);
// sudo, pacman, yay.
assert.equal(model.needsInput("[sudo] password for tim: ", 3), true);
assert.equal(model.needsInput(":: Proceed with installation? [Y/n] ", 3), true);
assert.equal(model.needsInput("==> Packages to cleanBuild?\n==> [N]one [A]ll\n==> ", 3), true);
assert.equal(model.needsInput("==> ", 1.5), false, "line prompts wait for 2s of quiet");
// A PKGBUILD asking in its own words (seen in a real update), with makepkg's
// ESC ( B colour resets around it.
const rune = `${ESC}[1m${ESC}[34m  ->${ESC}(B${ESC}[m${ESC}[1m Please type absolute path to mounted Rune CD (e.g. /media/cdrom)${ESC}(B${ESC}[m`;
assert.equal(model.lastLine(rune), "-> Please type absolute path to mounted Rune CD (e.g. /media/cdrom)");
assert.equal(model.needsInput(rune, 3), true);
assert.equal(model.needsInput(rune, 1.5), false, "still waits for 2s of quiet");
assert.equal(model.needsInput("==> Enter the path to the license file\n", 3), true);
assert.equal(model.needsInput("checking for size_t type... yes\nchecking whether to enable maintainer-specific portions of Makefiles... no\n", 30), false);
assert.equal(model.needsInput("   Compiling typenum v1.17.0\n", 30), false);
assert.equal(model.needsInput("  -> Selected 3 packages for removal\n", 30), false, "whole words only");
// Ordinary progress is not a prompt, even when it pauses.
assert.equal(model.needsInput("   Compiling serde v1.0.200\n", 30), false);
assert.equal(model.needsInput("", 30), false);

// Placement.
const report = {
  running: true,
  window: { address: "0xabc", at: [1736, 140], size: [900, 600], workspace: 2, fullscreen: 0 },
  monitor: { name: "DP-2", x: 1536, y: 0, workspace: 2, special: 0 },
};
assert.deepEqual(JSON.parse(JSON.stringify(model.placement(report))),
  { screen: "DP-2", address: "0xabc", x: 200, y: 140, width: 900, height: 600 });
assert.equal(model.placement({ ...report, monitor: { ...report.monitor, workspace: 3 } }), null, "other workspace");
assert.notEqual(model.placement({ ...report, window: { ...report.window, workspace: -98 },
  monitor: { ...report.monitor, workspace: 3, special: -98 } }), null, "shown special workspace");
assert.equal(model.placement({ ...report, window: { ...report.window, fullscreen: 2 } }), null);
assert.equal(model.placement({ ...report, window: null }), null);
assert.equal(model.placement({ running: false }), null);

// --------------------------------------------------------- Asteroids --
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

let s = game.newGame(800, 600, seeded(1), [{ initials: "tim", score: 1234, date: "2026-10-20" }]);
assert.equal(s.phase, "title");
assert.equal(s.highScore, 1234);
assert.equal(s.table[0].initials, "TIM");
assert.ok(s.rocks.length > 0, "title screen has drifting rocks");
game.step(s, 0.016, { fire: true });
assert.equal(s.bullets.length, 0, "no shooting on the title screen");

game.start(s);
assert.equal(s.phase, "playing");
assert.equal(s.level, 1);
assert.equal(s.rocks.length, 4);
assert.equal(s.lives, 3);
for (const r of s.rocks) {
  assert.ok(game.wrappedDistance(r.x, r.y, 400, 300, 800, 600) > 150, "wave spawns away from the ship");
}

// Turning and thrust.
s.rocks = [];
s.waveDelay = 99;
game.step(s, 0.05, { right: true });
assert.ok(s.ship.angle > 0);
s.ship.angle = 0;
game.step(s, 0.05, { thrust: true });
assert.ok(s.ship.vy < 0, "thrust pushes toward the nose (up)");

// Fire rate and the bullet cap.
s.bullets = [];
s.fireCooldown = 0;
game.step(s, 0.01, { fire: true });
game.step(s, 0.01, { fire: true });
assert.equal(s.bullets.length, 1, "cooldown between shots");
for (let i = 0; i < 40; i++) game.step(s, 0.02, { fire: true });
assert.ok(s.bullets.length <= 5);

// Wrapping.
assert.equal(game.wrap(-1, 800), 799);
assert.equal(game.wrap(800, 800), 0);
assert.equal(game.wrappedDistance(1, 10, 799, 10, 800, 600), 2);

// A bullet breaks a large rock into two mediums and scores 20.
s = game.newGame(800, 600, seeded(2), []);
game.start(s);
s.rocks = [game.makeRock(s, 3, 100, 100)];
s.rocks[0].vx = s.rocks[0].vy = 0;
s.bullets = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1 }];
game.step(s, 0.01, {});
assert.equal(s.score, 20);
assert.equal(s.rocks.length, 2);
assert.ok(s.rocks.every(r => r.size === 2));
assert.equal(s.highScore, 20, "HI follows the score past the table");

// Small rocks just vanish.
s.rocks = [game.makeRock(s, 1, 100, 100)];
s.rocks[0].vx = s.rocks[0].vy = 0;
s.bullets = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1 }];
game.step(s, 0.01, {});
assert.equal(s.score, 120);
assert.equal(s.rocks.length, 0);

// Clearing the field brings the next, bigger wave after a beat.
for (let i = 0; i < 100 && s.level === 1; i++) game.step(s, 0.05, {});
assert.equal(s.level, 2);
assert.equal(s.rocks.length, 5);

// Collisions: shielded ships are safe, unshielded ones are not.
s = game.newGame(800, 600, seeded(3), []);
game.start(s);
s.rocks = [game.makeRock(s, 3, 400, 300)];
s.rocks[0].vx = s.rocks[0].vy = 0;
game.step(s, 0.01, {});
assert.equal(s.ship.alive, true, "spawn shield");
s.ship.shield = 0;
game.step(s, 0.01, {});
assert.equal(s.ship.alive, false);
assert.equal(s.lives, 2);

// Respawn waits for the delay and a clear center.
s.rocks = [game.makeRock(s, 3, 400, 300)];
s.rocks[0].vx = s.rocks[0].vy = 0;
for (let i = 0; i < 100; i++) game.step(s, 0.05, {});
assert.equal(s.ship.alive, false, "center still occupied");
s.rocks[0].x = 50;
s.rocks[0].y = 50;
game.step(s, 0.05, {});
assert.equal(s.ship.alive, true);

// Last life ends the game; a score that makes the table asks for initials.
s.lives = 1;
s.ship.shield = 0;
s.rocks = [game.makeRock(s, 3, s.ship.x, s.ship.y)];
s.rocks[0].vx = s.rocks[0].vy = 0;
game.step(s, 0.01, {});
assert.equal(s.phase, "entry", "crash points onto an empty table");
const e = s.entry;
assert.equal(game.entryType(e, "j"), false);
game.entryRoll(e, -1);                 // A wraps round to a blank
assert.equal(e.initials, "J A");
game.entryRoll(e, 1);
assert.equal(e.initials, "JAA");
game.entryRoll(e, 1);
game.entryRoll(e, 1);
assert.equal(e.initials, "JCA");
game.entryMove(e, 1);
assert.equal(game.entryType(e, "?"), false, "only letters and digits");
assert.equal(game.entryType(e, "7"), true, "third character signs");
const signed = game.signEntry(s, "2026-10-20");
assert.equal(s.phase, "over");
assert.equal(JSON.stringify(signed), JSON.stringify([{ initials: "JC7", score: s.score, date: "2026-10-20" }]));
assert.equal(s.lastRank, 0);

// No table spot, no initials.
s = game.newGame(800, 600, seeded(9), Array.from({ length: 10 }, (_, i) => ({ initials: "AAA", score: 1000 * (i + 1) })));
game.start(s);
s.score = 1000;
game.endGame(s);
assert.equal(s.phase, "over", "ties with the last row don't bump it");
s.score = 1001;
game.endGame(s);
assert.equal(s.phase, "entry");

// Table: sorted, capped at ten, ties keep the earlier holder above, junk dropped.
let t = game.cleanTable([{ initials: "a", score: 5 }, null, { score: "x" }, { initials: "bbbb", score: 50 }, { score: -1 }]);
assert.equal(JSON.stringify(t.map(r => [r.initials, r.score])), JSON.stringify([["BBB", 50], ["A", 5]]));
assert.equal(JSON.stringify(game.cleanTable("nope")), "[]");
let r = game.insertScore(t, "new", 5, "d");
assert.equal(r.rank, 2);
assert.equal(r.table[1].initials, "A");
t = Array.from({ length: 10 }, (_, i) => ({ initials: "X", score: 100 - i }));
r = game.insertScore(t, "TOP", 500, "d");
assert.equal(r.rank, 0);
assert.equal(r.table.length, 10);
assert.equal(r.table[9].score, 92);
assert.equal(game.qualifies([], 0), false);
assert.equal(game.qualifies([], 1), true);

// Extra life every 10,000.
s = game.newGame(800, 600, seeded(4), []);
game.start(s);
game.addScore(s, 10000);
assert.equal(s.lives, 4);
game.addScore(s, 25000);
assert.equal(s.lives, 6);

// Long frames are clamped; resize keeps things on the field.
s = game.newGame(800, 600, seeded(5), []);
game.start(s);
const x0 = s.rocks[0].x;
game.step(s, 10, {});
assert.ok(s.time <= 0.05 + 1e-9);
game.resize(s, 400, 300);
for (const r of s.rocks) assert.ok(r.x >= 0 && r.x < 400 && r.y >= 0 && r.y < 300);
assert.ok(typeof x0 === "number");

// Saucers: arrive on a timer, cross once, shoot, and pay out when hit.
s = game.newGame(800, 600, seeded(11), []);
game.start(s);
s.ship.shield = 99;
s.saucerIn = 0.01;
game.step(s, 0.02, {});
assert.ok(s.saucer, "saucer arrives when its timer runs out");
assert.ok(s.saucer.x < 0 || s.saucer.x > 800, "from off the side");
s.rocks = [game.makeRock(s, 1, 400, 550)];
s.rocks[0].vx = s.rocks[0].vy = 0;
s.saucer.fireIn = 0;
game.step(s, 0.02, {});
assert.ok(s.saucerBullets.length === 1 && s.events.includes("saucer-fire"));
// Hit it: big pays 200, small 1000.
s.saucer.size = 2;
s.saucer.x = 300; s.saucer.y = 300; s.saucer.vx = 0; s.saucer.vy = 0;
s.rocks = [game.makeRock(s, 1, 700, 50)];
s.rocks[0].vx = s.rocks[0].vy = 0;
const before = s.score;
s.bullets = [{ x: 300, y: 300, vx: 0, vy: 0, life: 1 }];
game.step(s, 0.01, {});
assert.equal(s.saucer, null);
assert.equal(s.score - before, 200);
assert.ok(s.events.includes("saucer-boom"));
assert.ok(s.saucerIn > 0, "next one is scheduled");
// One that crosses without being hit leaves for nothing.
s.saucerIn = 0;
game.step(s, 0.01, {});
s.saucer.y = 500;
for (let i = 0; i < 400 && s.saucer; i++) { s.saucer.vy = 0; s.saucer.fireIn = 99; game.step(s, 0.05, {}); }
assert.equal(s.saucer, null, "left the field");
// A saucer shot kills an unshielded ship.
s.ship = { x: 400, y: 300, vx: 0, vy: 0, angle: 0, alive: true, thrusting: false, shield: 0 };
s.lives = 3;
s.saucerBullets = [{ x: 400, y: 300, vx: 0, vy: 0, life: 1 }];
game.step(s, 0.01, {});
assert.equal(s.ship.alive, false);
assert.ok(s.events.includes("ship-boom"));
// Saucer shots break rocks for no points.
s = game.newGame(800, 600, seeded(12), []);
game.start(s);
s.ship.shield = 99;
s.rocks = [game.makeRock(s, 3, 100, 100)];
s.rocks[0].vx = s.rocks[0].vy = 0;
s.saucerBullets = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1 }];
game.step(s, 0.01, {});
assert.equal(s.score, 0);
assert.equal(s.rocks.length, 2);
// The small saucer aims; the big one sprays.
s.ship = { x: 400, y: 100, alive: true };
s.level = 50;
const aim = game.saucerAim(s, { x: 400, y: 300, size: 1 });
assert.ok(Math.abs(aim) < 0.1, "small saucer aims up at the ship");
// Game over clears the sky.
s.saucer = { x: 1, y: 1, size: 2, r: 10 };
game.endGame(s);
assert.equal(s.saucer, null);

// Sound events: fire, bangs by size, the heartbeat, extra life.
s = game.newGame(800, 600, seeded(13), []);
game.start(s);
s.ship.shield = 99;
s.saucerIn = 999;
game.step(s, 0.01, { fire: true });
assert.ok(s.events.includes("fire"));
game.step(s, 0.01, {});
assert.ok(!s.events.includes("fire"), "events are per frame");
const heard = [];
for (let i = 0; i < 200; i++) { game.step(s, 0.02, {}); heard.push(...s.events); }
const beats = heard.filter(e => e.startsWith("beat"));
assert.ok(beats.length >= 3 && beats[0] !== beats[1], "two alternating notes");
assert.ok(s.beatEvery < 1, "and they speed up");
s.rocks = [game.makeRock(s, 2, 100, 100)];
s.rocks[0].vx = s.rocks[0].vy = 0;
s.bullets = [{ x: 100, y: 100, vx: 0, vy: 0, life: 1 }];
s.score = 9990;
game.step(s, 0.01, {});
assert.ok(s.events.includes("bang-medium") && s.events.includes("extra-life"));

// A long seeded soak should never throw or leave the field.
s = game.newGame(640, 480, seeded(6), []);
game.start(s);
const rng = seeded(7);
for (let i = 0; i < 20000; i++) {
  if (s.phase === "entry") game.signEntry(s, "d");
  if (s.phase === "over") game.start(s);
  game.step(s, 1 / 60, { left: rng() < 0.3, right: rng() < 0.3, thrust: rng() < 0.4, fire: rng() < 0.5, hyperspace: rng() < 0.002 });
  for (const thing of s.rocks.concat(s.bullets, s.particles, [s.ship])) {
    assert.ok(thing.x >= 0 && thing.x < 640 && thing.y >= 0 && thing.y < 480, "everything stays on the field");
  }
}

assert.ok(s.table.length > 0 && s.table.length <= 10);

console.log("ok");
