import QtQuick
import QtMultimedia

// The game's sound board. Loaded through a Loader so a system without Qt
// Multimedia (it is not part of a stock Omarchy install) just plays silent.
Item {
  id: root

  property bool active: false     // false stops the loops too
  property bool thrusting: false
  property int saucer: 0          // 0 none, 1 small, 2 big
  property real volume: 0.6

  readonly property url dir: Qt.resolvedUrl("sounds/")

  // Rapid sounds get a few voices each so a new shot doesn't cut off the
  // last one.
  readonly property var voices: ({ "fire": 3, "saucer-fire": 2, "bang-small": 3, "bang-medium": 2, "bang-large": 2 })
  property var pools: ({})
  property var next: ({})

  function play(name) {
    if (!active) return
    var pool = pools[name]
    if (!pool) return
    var i = next[name] || 0
    next[name] = (i + 1) % pool.length
    pool[i].play()
  }

  Component {
    id: effect
    SoundEffect { volume: root.volume }
  }

  Component.onCompleted: {
    var names = ["fire", "saucer-fire", "bang-large", "bang-medium", "bang-small", "ship-boom",
                 "saucer-boom", "beat1", "beat2", "extra-life", "hyperspace"]
    var made = {}
    for (var i = 0; i < names.length; i++) {
      var list = []
      for (var v = 0; v < (voices[names[i]] || 1); v++) {
        list.push(effect.createObject(root, { source: root.dir + names[i] + ".wav" }))
      }
      made[names[i]] = list
    }
    pools = made
  }

  SoundEffect {
    source: root.dir + "thrust.wav"
    loops: SoundEffect.Infinite
    volume: root.volume
    readonly property bool want: root.active && root.thrusting
    onWantChanged: want ? play() : stop()
  }

  SoundEffect {
    source: root.dir + "saucer-big.wav"
    loops: SoundEffect.Infinite
    volume: root.volume
    readonly property bool want: root.active && root.saucer === 2
    onWantChanged: want ? play() : stop()
  }

  SoundEffect {
    source: root.dir + "saucer-small.wav"
    loops: SoundEffect.Infinite
    volume: root.volume
    readonly property bool want: root.active && root.saucer === 1
    onWantChanged: want ? play() : stop()
  }
}
