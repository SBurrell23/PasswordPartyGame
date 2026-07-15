(function () {
  "use strict";

  var STORAGE_KEY = "password.audio.v1";
  var DEFAULTS = { music: 0.3, fx: 0.5 };
  var PLAY_PASS_GAIN = 2.25;

  function clamp01(n, fallback) {
    var x = Number(n);
    if (isNaN(x)) return fallback;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function fxWithGain(baseFx, gain) {
    var g = typeof gain === "number" ? gain : 1;
    return Math.min(1, Math.max(0, baseFx * g));
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { music: DEFAULTS.music, fx: DEFAULTS.fx };
      var parsed = JSON.parse(raw);
      return {
        music: clamp01(parsed.music, DEFAULTS.music),
        fx: clamp01(parsed.fx, DEFAULTS.fx),
      };
    } catch (e) {
      return { music: DEFAULTS.music, fx: DEFAULTS.fx };
    }
  }

  function SoundManager() {
    this.settings = loadSettings();
    this.lastCueId = null;

    this.effects = {
      correct: new Audio("assets/sounds/effects/correct.wav"),
      playPass: new Audio("assets/sounds/effects/play-pass.wav"),
      skip: new Audio("assets/sounds/effects/skip.wav"),
      nextTurn: new Audio("assets/sounds/effects/next-turn.wav"),
      wrongTimeout: new Audio("assets/sounds/effects/wrong-timeout.wav"),
    };

    this.tick = new Audio("assets/sounds/effects/clock-ticking.mp3");
    this.tick.loop = true;

    this.music = new Audio("assets/sounds/music/password-music-looping.mp3");
    this.music.loop = true;

    this._forEachAudio(function (a) {
      a.preload = "auto";
    });

    this.applyVolumes();
    this.prime();
    this.startMusic();
    this.installAutoplayRecovery();
  }

  SoundManager.prototype._forEachAudio = function (fn) {
    fn(this.effects.correct);
    fn(this.effects.playPass);
    fn(this.effects.skip);
    fn(this.effects.nextTurn);
    fn(this.effects.wrongTimeout);
    fn(this.tick);
    fn(this.music);
  };

  SoundManager.prototype.prime = function () {
    this._forEachAudio(function (a) {
      try {
        a.load();
      } catch (e) {}
    });
  };

  SoundManager.prototype.saveSettings = function () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {}
  };

  SoundManager.prototype.applyVolumes = function () {
    this.music.volume = this.settings.music;
    this.tick.volume = this.settings.fx;
    this.effects.correct.volume = this.settings.fx;
    this.effects.playPass.volume = fxWithGain(this.settings.fx, PLAY_PASS_GAIN);
    this.effects.skip.volume = this.settings.fx;
    this.effects.nextTurn.volume = this.settings.fx;
    this.effects.wrongTimeout.volume = this.settings.fx;
  };

  SoundManager.prototype.setMusicVolume = function (v) {
    this.settings.music = clamp01(v, this.settings.music);
    this.music.volume = this.settings.music;
    this.saveSettings();
  };

  SoundManager.prototype.setFxVolume = function (v) {
    this.settings.fx = clamp01(v, this.settings.fx);
    this.tick.volume = this.settings.fx;
    this.effects.correct.volume = this.settings.fx;
    this.effects.playPass.volume = fxWithGain(this.settings.fx, PLAY_PASS_GAIN);
    this.effects.skip.volume = this.settings.fx;
    this.effects.nextTurn.volume = this.settings.fx;
    this.effects.wrongTimeout.volume = this.settings.fx;
    this.saveSettings();
  };

  SoundManager.prototype.playLocal = function (name) {
    if (name === "correct") this._playEffect(this.effects.correct);
    else if (name === "play-pass")
      this._playEffect(this.effects.playPass, PLAY_PASS_GAIN);
    else if (name === "skip") this._playEffect(this.effects.skip);
    else if (name === "next-turn") this._playEffect(this.effects.nextTurn);
    else if (name === "wrong-timeout")
      this._playEffect(this.effects.wrongTimeout);
  };

  SoundManager.prototype.startMusic = function () {
    var p;
    try {
      p = this.music.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  };

  SoundManager.prototype.installAutoplayRecovery = function () {
    var self = this;
    function resume() {
      self.startMusic();
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      document.removeEventListener("touchstart", resume);
    }
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    document.addEventListener("touchstart", resume);
  };

  SoundManager.prototype._playEffect = function (audio, gain) {
    if (!audio) return;
    audio.currentTime = 0;
    audio.volume = fxWithGain(this.settings.fx, gain);
    var p;
    try {
      p = audio.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  };

  SoundManager.prototype.consumeCue = function (cue) {
    if (!cue || typeof cue.id === "undefined") return;
    if (this.lastCueId === cue.id) return;
    this.lastCueId = cue.id;

    // Ignore old cues received during a reconnect/join snapshot.
    if (cue.ts && Date.now() - cue.ts > 4000) return;

    if (cue.name === "correct") this._playEffect(this.effects.correct);
    else if (cue.name === "play-pass")
      this._playEffect(this.effects.playPass, PLAY_PASS_GAIN);
    else if (cue.name === "skip") this._playEffect(this.effects.skip);
    else if (cue.name === "next-turn") this._playEffect(this.effects.nextTurn);
    else if (cue.name === "wrong-timeout")
      this._playEffect(this.effects.wrongTimeout);
  };

  SoundManager.prototype.startTicking = function () {
    if (!this.tick.paused) return;
    this.tick.currentTime = 0;
    var p;
    try {
      p = this.tick.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  };

  SoundManager.prototype.stopTicking = function () {
    if (this.tick.paused) return;
    this.tick.pause();
    this.tick.currentTime = 0;
  };

  window.SoundManager = SoundManager;
})();