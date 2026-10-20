#!/usr/bin/env python3
"""Synthesize the game's sound effects into sounds/*.wav.

Everything is generated from oscillators and noise here, so there are no
samples to license. Re-run after changing a recipe; the output is committed.
Deterministic: the noise generator is seeded.
"""

import math
import os
import random
import struct
import sys
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")
rng = random.Random(1979)  # the year of the cabinet


def write(name, samples, gain=0.6):
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = gain / peak
    frames = b"".join(struct.pack("<h", int(max(-1, min(1, s * scale)) * 32767)) for s in samples)
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)


def n(seconds):
    return int(RATE * seconds)


def square(phase):
    return 1.0 if (phase % 1.0) < 0.5 else -1.0


def lowpass(samples, cutoff):
    # One-pole filter; cutoff may be a function of the sample index.
    out, y = [], 0.0
    for i, x in enumerate(samples):
        c = cutoff(i) if callable(cutoff) else cutoff
        a = 1 - math.exp(-2 * math.pi * c / RATE)
        y += a * (x - y)
        out.append(y)
    return out


def fade(samples, ms=4):
    k = min(len(samples) // 2, n(ms / 1000))
    for i in range(k):
        samples[i] *= i / k
        samples[-1 - i] *= i / k
    return samples


def pew(start, end, seconds):
    total, out, phase = n(seconds), [], 0.0
    for i in range(total):
        t = i / total
        freq = start * (end / start) ** t
        phase += freq / RATE
        out.append(square(phase) * (1 - t) ** 1.5)
    return fade(out)


def bang(seconds, bright, dark):
    total = n(seconds)
    noise = [rng.uniform(-1, 1) * (1 - i / total) ** 2.2 for i in range(total)]
    return fade(lowpass(noise, lambda i: dark + (bright - dark) * (1 - i / total) ** 3))


def thump(freq, seconds):
    total, out, phase = n(seconds), [], 0.0
    for i in range(total):
        t = i / total
        phase += freq * (1 - 0.15 * t) / RATE
        out.append((0.7 * square(phase) + 0.3 * math.sin(2 * math.pi * phase)) * (1 - t) ** 2)
    return fade(lowpass(out, 900))


def siren(low, high, wobble, seconds):
    # A whole number of wobbles so the loop point is seamless.
    total, out, phase = n(seconds), [], 0.0
    for i in range(total):
        t = i / RATE
        freq = low + (high - low) * (0.5 + 0.5 * math.sin(2 * math.pi * wobble * t))
        phase += freq / RATE
        out.append(square(phase))
    return lowpass(out, 2400)


def rumble(seconds):
    total = n(seconds)
    noise = lowpass([rng.uniform(-1, 1) for _ in range(total)], 260)
    # Crossfade the tail into the head so it loops without a click.
    k = n(0.05)
    for i in range(k):
        a = i / k
        noise[i] = noise[i] * a + noise[total - k + i] * (1 - a)
    return noise[: total - k]


def chime():
    out = []
    for freq in (880, 1175, 1568, 1760, 1568, 1760):
        out += pew(freq, freq, 0.07)
    return out


def warp():
    total, out, phase = n(0.35), [], 0.0
    for i in range(total):
        t = i / total
        phase += (300 + 1800 * t) / RATE
        out.append(math.sin(2 * math.pi * phase) * (1 - t))
    return fade(out)


def main():
    os.makedirs(OUT, exist_ok=True)
    write("fire", pew(1400, 260, 0.13), 0.35)
    write("saucer-fire", pew(2000, 900, 0.10), 0.3)
    write("bang-large", bang(0.75, 1800, 120), 0.8)
    write("bang-medium", bang(0.5, 2600, 200), 0.7)
    write("bang-small", bang(0.3, 4000, 400), 0.6)
    write("ship-boom", bang(1.4, 1400, 70), 0.9)
    write("saucer-boom", bang(0.9, 3200, 150), 0.8)
    write("beat1", thump(62, 0.11), 0.75)
    write("beat2", thump(55, 0.11), 0.75)
    write("thrust", rumble(0.6), 0.45)
    write("saucer-big", siren(300, 420, 5, 0.6), 0.22)
    write("saucer-small", siren(700, 1000, 10, 0.4), 0.2)
    write("extra-life", chime(), 0.3)
    write("hyperspace", warp(), 0.35)
    print("wrote", len(os.listdir(OUT)), "sounds to", os.path.normpath(OUT), file=sys.stderr)


if __name__ == "__main__":
    main()
