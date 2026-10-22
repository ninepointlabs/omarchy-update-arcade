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

// The update ending mid-round keeps the game up; nothing to lose closes it.
assert.equal(model.keepAfterUpdate(true, "playing"), true, "round in play, paused or not");
assert.equal(model.keepAfterUpdate(true, "entry"), true, "a high score being signed");
assert.equal(model.keepAfterUpdate(true, "title"), false, "no round started");
assert.equal(model.keepAfterUpdate(true, "over"), false, "already game over");
assert.equal(model.keepAfterUpdate(false, "playing"), false, "game not shown");

// The shell restart at the very end of an update, as omarchy-update-restart prints it.
assert.equal(model.restartingShell(`Keeping orphaned packages.\r\n\r\n${ESC}[32m\r\nRestarting shell${ESC}[0m\r\nAll plugins have been reloaded\r\n`), true);
assert.equal(model.restartingShell(`${ESC}[32m\r\nRestarting shell${ESC}[0m`), true, "before the next line lands");
assert.equal(model.restartingShell("Restarting walker\r\n"), false, "another service");
assert.equal(model.restartingShell("(3/7) Restarting shell services in the background\n"), false, "not on its own line");
assert.equal(model.restartingShell(""), false);

// A resumed game with no terminal to cover sits mid-screen.
assert.deepEqual(JSON.parse(JSON.stringify(model.centred("DP-1", 2560, 1440))),
  { screen: "DP-1", address: "", x: 512, y: 288, width: 1536, height: 864 });
assert.deepEqual(JSON.parse(JSON.stringify(model.centred("eDP-1", 700, 500))),
  { screen: "eDP-1", address: "", x: 40, y: 40, width: 620, height: 420 }, "small screen: leaves a margin");
assert.equal(model.centred("", 1920, 1080), null);
assert.equal(model.centred("DP-1", 0, 0), null);

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

// --------------------------------------------------- save and resume --
const NOW = 1792630000000;
s = game.newGame(800, 600, seeded(21), []);
assert.equal(game.snapshot(s, NOW), null, "nothing to save on the title screen");
game.start(s);
for (let i = 0; i < 60; i++) game.step(s, 0.016, { thrust: true, left: true });
s.score = 12340; s.lives = 2; s.level = 3;
let saved = JSON.stringify(game.snapshot(s, NOW));
let back = game.readSave(saved, NOW + 5000);
assert.ok(back, "a fresh save reads back");
assert.equal(back.phase, "playing");
assert.equal(back.score, 12340);
assert.equal(back.rocks.length, s.rocks.length);
assert.ok(back.ship && Math.abs(back.ship.x - s.ship.x) < 1e-9);

// Resumed into a bigger overlay: same round, scaled to fit, shielded ship.
let r2 = game.newGame(1600, 1200, seeded(22), []);
game.resume(r2, back);
assert.equal(r2.phase, "playing");
assert.equal(r2.score, 12340);
assert.equal(r2.lives, 2);
assert.equal(r2.level, 3);
assert.equal(r2.nextLifeAt, 20000);
assert.equal(r2.rocks.length, s.rocks.length);
assert.ok(Math.abs(r2.rocks[0].x - s.rocks[0].x * 2) < 1e-6, "positions scale with the overlay");
assert.equal(r2.rocks[0].r, 42 * r2.scale, "radius from the size, not the file");
assert.ok(Math.abs(r2.ship.x - s.ship.x * 2) < 1e-6);
assert.equal(r2.ship.shield > 0, true);
assert.equal(r2.saucer, null);
game.step(r2, 0.016, {});
assert.equal(r2.phase, "playing", "it plays on");

// A dead ship waiting to respawn saves no ship; resume brings a new one.
s.ship.alive = false;
back = game.readSave(JSON.stringify(game.snapshot(s, NOW)), NOW);
assert.equal(back.ship, null);
r2 = game.newGame(800, 600, seeded(23), []);
game.resume(r2, back);
assert.ok(r2.ship.alive);

// A high score half signed comes back on the entry screen.
s = game.newGame(800, 600, seeded(24), []);
game.start(s);
s.score = 5000; s.lives = 0;
game.endGame(s);
assert.equal(s.phase, "entry");
game.entryType(s.entry, "t");
back = game.readSave(JSON.stringify(game.snapshot(s, NOW)), NOW);
assert.equal(back.phase, "entry");
assert.deepEqual(JSON.parse(JSON.stringify(back.entry)), { initials: "TAA", pos: 1 });
r2 = game.newGame(800, 600, seeded(25), []);
game.resume(r2, back);
assert.equal(r2.phase, "entry");
assert.equal(r2.entry.initials, "TAA");
assert.equal(r2.score, 5000);
assert.equal(game.signEntry(r2, "2026-10-21")[0].score, 5000);

// Stale, corrupt or hostile files are refused.
s = game.newGame(800, 600, seeded(26), []);
game.start(s);
const good = game.snapshot(s, NOW);
const variant = (change) => { const v = JSON.parse(JSON.stringify(good)); change(v); return JSON.stringify(v); };
assert.ok(game.readSave(JSON.stringify(good), NOW));
assert.equal(game.readSave(JSON.stringify(good), NOW + 10 * 60 * 1000 + 1), null, "older than ten minutes");
assert.equal(game.readSave(JSON.stringify(good), NOW - 2 * 60 * 1000), null, "from the future");
assert.equal(game.readSave("", NOW), null);
assert.equal(game.readSave("{not json", NOW), null);
assert.equal(game.readSave("[]", NOW), null);
assert.equal(game.readSave("null", NOW), null);
assert.equal(game.readSave(" ".repeat(70000) + JSON.stringify(good), NOW), null, "size cap");
assert.equal(game.readSave(variant(v => v.version = 2), NOW), null);
assert.equal(game.readSave(variant(v => v.phase = "over"), NOW), null);
assert.equal(game.readSave(variant(v => v.score = -1), NOW), null);
assert.equal(game.readSave(variant(v => v.score = 1.5), NOW), null);
assert.equal(game.readSave(variant(v => v.score = "100"), NOW), null);
assert.equal(game.readSave(variant(v => v.lives = 0), NOW), null, "no ships left is not a round in play");
assert.equal(game.readSave(variant(v => v.level = 0), NOW), null);
assert.equal(game.readSave(variant(v => v.w = 10), NOW), null);
assert.equal(game.readSave(variant(v => v.ship = { x: 1, y: 2 }), NOW), null);
assert.equal(game.readSave(variant(v => v.ship.vx = 1e300), NOW), null);
assert.equal(game.readSave(variant(v => v.rocks[0].size = 4), NOW), null);
assert.equal(game.readSave(variant(v => v.rocks[0].outline = []), NOW), null);
assert.equal(game.readSave(variant(v => v.rocks[0].outline[0] = "x"), NOW), null);
assert.equal(game.readSave(variant(v => v.rocks = Array.from({ length: 101 }, () => v.rocks[0])), NOW), null);
assert.equal(game.readSave(variant(v => v.rocks = {}), NOW), null);
assert.equal(game.readSave(variant(v => { v.phase = "entry"; v.entry = { initials: "<b>", pos: 0 }; }), NOW), null);
assert.equal(game.readSave(variant(v => { v.phase = "entry"; v.entry = { initials: "TIM", pos: 3 }; }), NOW), null);
assert.equal(game.readSave(variant(v => { v.phase = "entry"; v.entry = null; }), NOW), null);
// Extra fields are dropped, not carried along.
back = game.readSave(variant(v => { v.extra = "x"; v.rocks[0].evil = "y"; }), NOW);
assert.equal(back.extra, undefined);
assert.equal(back.rocks[0].evil, undefined);

console.log("ok");
