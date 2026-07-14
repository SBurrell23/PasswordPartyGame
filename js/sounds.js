/*
 * sounds.js — short feedback tones via Web Audio (no asset files).
 */
(function () {
  "use strict";

  var ctx = null;
  var unlocked = false;

  function ensureCtx() {
    if (!ctx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(ac, freq, start, duration, type, volume) {
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  function playCorrect() {
    var ac = ensureCtx();
    if (!ac) return;
    var t = ac.currentTime;
    tone(ac, 523.25, t, 0.14, "sine", 0.28);
    tone(ac, 659.25, t + 0.11, 0.18, "sine", 0.32);
    tone(ac, 783.99, t + 0.22, 0.32, "sine", 0.36);
  }

  function playWrong() {
    var ac = ensureCtx();
    if (!ac) return;
    var t = ac.currentTime;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.35);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensureCtx();
  }

  document.addEventListener(
    "click",
    function () {
      unlock();
    },
    { once: true }
  );
  document.addEventListener(
    "keydown",
    function () {
      unlock();
    },
    { once: true }
  );

  window.Sounds = {
    playCorrect: playCorrect,
    playWrong: playWrong,
    unlock: unlock,
  };
})();
