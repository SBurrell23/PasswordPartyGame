/*
 * game.js — authoritative game engine (runs on the HOST only).
 *
 * The engine owns the single source of truth (`this.state`). Clients never run
 * the engine; they only render whatever filtered state the host sends them.
 *
 * Every mutating method ends by calling `this.change()`, which notifies the
 * host app so it can re-broadcast state to all peers and re-render itself.
 */
(function () {
  "use strict";

  var TEAMS = ["red", "blue"];

  function otherTeam(team) {
    return team === "red" ? "blue" : "red";
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function GameEngine(onChange) {
    this.onChange = onChange || function () {};
    this.usedWords = {}; // words already used this game (kept off the wire)
    this.timer = null; // single active phase timer handle
    this.pendingDecider = null; // team whose giver decides next round (last scorer)
    this.state = GameEngine.initialState();
  }

  GameEngine.initialState = function () {
    return {
      phase: "lobby", // lobby | decision | turn | roundEnd | halftime | gameEnd
      config: {
        turnSeconds: 16,
        decisionSeconds: 12,
        totalRounds: 14,
        turnsPerTeam: 4,
        fullPoints: 7,
        roundEndSeconds: 6,
        halftimeSeconds: 6,
      },
      players: {}, // id -> { id, name, team, role, connected }
      order: [], // join order of player ids
      hostId: null,
      round: 0,
      half: 1,
      scores: { red: 0, blue: 0 },
      history: [], // { round, half, word, scoringTeam, points, wrongs, turnsUsed }

      // round-scoped fields
      word: null,
      firstGiverTeam: null,
      decisions: {}, // team -> 'play'|'pass'|'skip'
      startingTeam: null,
      currentTeam: null,
      turnsUsed: { red: 0, blue: 0 },
      wrongs: { red: 0, blue: 0 },
      ready: { red: false, blue: false }, // givers ready for next round / 2nd half
      deadline: null, // epoch ms for the active timer
      lastResult: null, // { scoringTeam, points, word }
      message: null,
      soundCue: null, // { type: 'correct'|'wrong', seq: number }
    };
  };

  var P = GameEngine.prototype;

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */

  P.change = function () {
    this.onChange(this.state);
  };

  P.clearTimer = function () {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  };

  P.schedule = function (fn, ms) {
    this.clearTimer();
    var self = this;
    this.timer = setTimeout(function () {
      self.timer = null;
      fn.call(self);
    }, ms);
  };

  P.bumpSound = function (type) {
    var s = this.state;
    var seq = (s.soundCue && s.soundCue.seq) || 0;
    s.soundCue = { type: type, seq: seq + 1 };
  };

  P.playerAt = function (team, role) {
    var players = this.state.players;
    for (var id in players) {
      if (players[id].team === team && players[id].role === role) {
        return players[id];
      }
    }
    return null;
  };

  P.giverOf = function (team) {
    return this.playerAt(team, "giver");
  };

  P.guesserOf = function (team) {
    return this.playerAt(team, "guesser");
  };

  P.teamsReady = function () {
    return (
      this.giverOf("red") &&
      this.guesserOf("red") &&
      this.giverOf("blue") &&
      this.guesserOf("blue")
    );
  };

  P.pickWord = function () {
    var list = window.WORD_LIST || [];
    if (!list.length) return "MISSING WORD LIST";
    var word;
    var guard = 0;
    do {
      word = list[Math.floor(Math.random() * list.length)];
      guard++;
    } while (this.usedWords[word] && guard < 50);
    // If random keeps landing on already-used words, scan for a guaranteed
    // unused one so a word never repeats within a host's session.
    if (this.usedWords[word]) {
      var unused = [];
      for (var i = 0; i < list.length; i++) {
        if (!this.usedWords[list[i]]) unused.push(list[i]);
      }
      if (unused.length) {
        word = unused[Math.floor(Math.random() * unused.length)];
      } else {
        // Every word has been used this session — reset the pool.
        this.usedWords = {};
        word = list[Math.floor(Math.random() * list.length)];
      }
    }
    this.usedWords[word] = true;
    return word;
  };

  /* ------------------------------------------------------------------ */
  /* action dispatch (called by host with the sender's player id)        */
  /* ------------------------------------------------------------------ */

  P.dispatch = function (senderId, action) {
    if (!action || !action.type) return;
    var isHost = senderId === this.state.hostId;
    switch (action.type) {
      case "rename":
        this.rename(senderId, action.name);
        break;
      case "pickTeam":
        this.pickTeam(senderId, action.team, action.role);
        break;
      case "leaveTeam":
        this.leaveTeam(senderId);
        break;
      case "setConfig":
        if (isHost) this.setConfig(action.config);
        break;
      case "resetConfig":
        if (isHost) this.resetConfig();
        break;
      case "start":
        if (isHost) this.startGame();
        break;
      case "decision":
        this.submitDecision(senderId, action.choice);
        break;
      case "turnResult":
        this.submitTurnResult(senderId, action.result);
        break;
      case "ready":
        this.submitReady(senderId);
        break;
      case "returnLobby":
        if (isHost) this.returnToLobby();
        break;
      default:
        break;
    }
  };

  /* ------------------------------------------------------------------ */
  /* lobby / membership                                                 */
  /* ------------------------------------------------------------------ */

  P.setHost = function (id, name) {
    this.state.hostId = id;
    this.addPlayer(id, name);
  };

  P.addPlayer = function (id, name) {
    if (this.state.players[id]) {
      this.state.players[id].connected = true;
      this.state.players[id].name = name || this.state.players[id].name;
    } else {
      this.state.players[id] = {
        id: id,
        name: name || "Player",
        team: null,
        role: null,
        connected: true,
      };
      this.state.order.push(id);
    }
    this.change();
  };

  P.removePlayer = function (id) {
    var p = this.state.players[id];
    if (!p) return;
    if (this.state.phase === "lobby") {
      delete this.state.players[id];
      var i = this.state.order.indexOf(id);
      if (i >= 0) this.state.order.splice(i, 1);
    } else {
      p.connected = false;
    }
    this.change();
  };

  P.rename = function (id, name) {
    var p = this.state.players[id];
    if (p && name) {
      p.name = String(name).slice(0, 20);
      this.change();
    }
  };

  P.pickTeam = function (id, team, role) {
    if (this.state.phase !== "lobby") return;
    var p = this.state.players[id];
    if (!p) return;
    if (TEAMS.indexOf(team) < 0 || (role !== "giver" && role !== "guesser"))
      return;
    // Slot must be free (or already mine).
    var occupant = this.playerAt(team, role);
    if (occupant && occupant.id !== id) return;
    p.team = team;
    p.role = role;
    this.change();
  };

  P.leaveTeam = function (id) {
    if (this.state.phase !== "lobby") return;
    var p = this.state.players[id];
    if (!p) return;
    p.team = null;
    p.role = null;
    this.change();
  };

  P.setConfig = function (cfg) {
    if (this.state.phase !== "lobby" || !cfg) return;
    var c = this.state.config;
    if (cfg.turnSeconds) c.turnSeconds = clamp(cfg.turnSeconds, 10, 30);
    if (cfg.decisionSeconds) c.decisionSeconds = clamp(cfg.decisionSeconds, 8, 20);
    if (cfg.totalRounds) c.totalRounds = clampEven(cfg.totalRounds, 6, 20);
    if (cfg.turnsPerTeam) c.turnsPerTeam = clamp(cfg.turnsPerTeam, 1, 7);
    if (cfg.fullPoints) c.fullPoints = clamp(cfg.fullPoints, 1, 10);
    this.change();
  };

  P.resetConfig = function () {
    if (this.state.phase !== "lobby") return;
    var c = this.state.config;
    c.turnSeconds = 16;
    c.decisionSeconds = 12;
    c.totalRounds = 14;
    c.turnsPerTeam = 4;
    c.fullPoints = 7;
    this.change();
  };

  function clamp(n, lo, hi) {
    n = parseInt(n, 10);
    if (isNaN(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  // Clamp to range, then force to an even number (rounds down) so halves split
  // evenly. Used for Total Rounds.
  function clampEven(n, lo, hi) {
    n = clamp(n, lo, hi);
    if (n % 2 !== 0) n -= 1;
    return Math.max(lo, n);
  }

  /* ------------------------------------------------------------------ */
  /* game flow                                                          */
  /* ------------------------------------------------------------------ */

  P.startGame = function () {
    if (this.state.phase !== "lobby" || !this.teamsReady()) return;
    // Note: usedWords persists across games for this host session so a word is
    // never repeated until the host reloads the page.
    this.pendingDecider = null;
    this.state.scores = { red: 0, blue: 0 };
    this.state.history = [];
    this.state.half = 1;
    this.beginRound(1);
  };

  P.beginRound = function (roundNumber) {
    this.clearTimer();
    var s = this.state;
    s.round = roundNumber;
    s.phase = "decision";
    s.word = this.pickWord();
    // The team that last scored decides first; otherwise pick at random.
    s.firstGiverTeam =
      this.pendingDecider || (Math.random() < 0.5 ? "red" : "blue");
    s.decisions = {};
    s.startingTeam = null;
    s.currentTeam = null;
    s.turnsUsed = { red: 0, blue: 0 };
    s.wrongs = { red: 0, blue: 0 };
    s.ready = { red: false, blue: false };
    s.lastResult = null;
    s.message = null;
    s.deadline = Date.now() + s.config.decisionSeconds * 1000;
    this.schedule(this.resolveDecision, s.config.decisionSeconds * 1000);
    this.change();
  };

  P.submitDecision = function (id, choice) {
    var s = this.state;
    if (s.phase !== "decision") return;
    var p = s.players[id];
    if (!p || p.role !== "giver") return;
    var first = s.firstGiverTeam;
    var other = otherTeam(first);

    if (p.team === first) {
      // Starting giver: full choice.
      if (["play", "pass", "skip"].indexOf(choice) < 0) return;
      s.decisions[first] = choice;
    } else {
      // Other giver: may only vote to SKIP.
      if (choice !== "skip") return;
      s.decisions[other] = "skip";
    }

    // A definite PLAY/PASS from the starter resolves immediately.
    if (s.decisions[first] === "play" || s.decisions[first] === "pass") {
      this.clearTimer();
      this.resolveDecision();
      return;
    }
    // Once both givers have voted SKIP, cap the remaining countdown at 7s so a
    // doomed word doesn't linger — but still give a moment before the reroll.
    if (s.decisions[first] === "skip" && s.decisions[other] === "skip") {
      if (s.deadline - Date.now() > 7000) {
        s.deadline = Date.now() + 7000;
        this.schedule(this.resolveDecision, 7000);
      }
    }
    // Otherwise (including a mutual SKIP) let the decision timer run out before
    // resolving — so a skipped word isn't replaced instantly.
    this.change();
  };

  P.resolveDecision = function () {
    var s = this.state;
    var first = s.firstGiverTeam;
    var other = otherTeam(first);
    var fc = s.decisions[first]; // starter choice (maybe undefined on timeout)
    var oc = s.decisions[other]; // other giver: 'skip' or undefined

    // Skip only happens if BOTH givers skip.
    if (fc === "skip" && oc === "skip") {
      s.message = "Both givers skipped — new word!";
      this.change();
      var self = this;
      this.schedule(function () {
        self.beginRound(s.round);
      }, 1200);
      return;
    }

    // Only the starting giver decides play vs pass. A lone skip or a timeout
    // defaults to PLAY (the starter's team gives clues).
    var starting = fc === "pass" ? other : first;
    this.startTurn(starting, true);
  };

  P.startTurn = function (team, isStart) {
    var s = this.state;
    s.phase = "turn";
    if (isStart) s.startingTeam = team;
    s.currentTeam = team;
    s.message = null;
    s.deadline = Date.now() + s.config.turnSeconds * 1000;
    this.schedule(this.timeoutTurn, s.config.turnSeconds * 1000);
    this.change();
  };

  P.submitTurnResult = function (id, result) {
    var s = this.state;
    if (s.phase !== "turn") return;
    var giver = this.giverOf(s.currentTeam);
    if (!giver || giver.id !== id) return; // only the active giver decides
    this.clearTimer();
    var team = s.currentTeam;
    if (result === "correct") {
      // Score drops by one for every prior turn this team spent (a wrong guess
      // OR a timed-out turn). Full points only if they nail it on the first try.
      var points = Math.max(0, s.config.fullPoints - s.turnsUsed[team]);
      s.scores[team] += points;
      this.bumpSound("correct");
      this.endRound(team, points);
    } else {
      // 'wrong'
      s.wrongs[team] += 1;
      s.turnsUsed[team] += 1;
      this.bumpSound("wrong");
      this.advanceTurn();
    }
  };

  P.timeoutTurn = function () {
    var s = this.state;
    // Timeout counts as a used turn but is NOT a wrong answer.
    s.turnsUsed[s.currentTeam] += 1;
    this.bumpSound("wrong");
    this.advanceTurn();
  };

  P.advanceTurn = function () {
    var s = this.state;
    var max = s.config.turnsPerTeam;
    if (s.turnsUsed.red >= max && s.turnsUsed.blue >= max) {
      this.endRound(null, 0);
      return;
    }
    var next = otherTeam(s.currentTeam);
    if (s.turnsUsed[next] < max) {
      this.startTurn(next, false);
    } else if (s.turnsUsed[s.currentTeam] < max) {
      this.startTurn(s.currentTeam, false);
    } else {
      this.endRound(null, 0);
    }
  };

  P.endRound = function (scoringTeam, points) {
    var s = this.state;
    s.phase = "roundEnd";
    // Next round is decided by the team that scored (else random next round).
    this.pendingDecider = scoringTeam || null;
    s.lastResult = { scoringTeam: scoringTeam, points: points, word: s.word };
    s.history.push({
      round: s.round,
      half: s.half,
      word: s.word,
      scoringTeam: scoringTeam,
      points: points,
      wrongs: clone(s.wrongs),
      turnsUsed: clone(s.turnsUsed),
    });
    s.ready = { red: false, blue: false };
    var isFinal = s.round >= s.config.totalRounds;
    if (isFinal) {
      // No "next round" to gate — briefly show the result, then final scores.
      s.deadline = Date.now() + s.config.roundEndSeconds * 1000;
      this.schedule(this.advanceFromRoundEnd, s.config.roundEndSeconds * 1000);
    } else {
      // Wait for both clue givers to click "Start next round".
      s.deadline = null;
      this.clearTimer();
    }
    this.change();
  };

  P.submitReady = function (id) {
    var s = this.state;
    if (s.phase !== "roundEnd" && s.phase !== "halftime") return;
    var p = s.players[id];
    if (!p || p.role !== "giver") return;
    s.ready[p.team] = true;
    if (s.ready.red && s.ready.blue) {
      if (s.phase === "roundEnd") this.advanceFromRoundEnd();
      else this.beginRound(s.round + 1);
    } else {
      this.change();
    }
  };

  P.advanceFromRoundEnd = function () {
    var s = this.state;
    var total = s.config.totalRounds;
    var halfPoint = Math.floor(total / 2);
    if (s.round >= total) {
      s.phase = "gameEnd";
      s.deadline = null;
      this.change();
      return;
    }
    if (s.round === halfPoint && s.half === 1) {
      // Enter halftime: swap roles, then wait for the NEW givers to be ready.
      s.half = 2;
      s.phase = "halftime";
      this.swapRoles();
      s.ready = { red: false, blue: false };
      s.deadline = null;
      this.clearTimer();
      this.change();
      return;
    }
    this.beginRound(s.round + 1);
  };

  P.swapRoles = function () {
    var players = this.state.players;
    for (var id in players) {
      var p = players[id];
      if (p.role === "giver") p.role = "guesser";
      else if (p.role === "guesser") p.role = "giver";
    }
  };

  P.returnToLobby = function () {
    this.clearTimer();
    var s = this.state;
    s.phase = "lobby";
    s.round = 0;
    s.half = 1;
    s.scores = { red: 0, blue: 0 };
    s.history = [];
    s.word = null;
    s.decisions = {};
    s.firstGiverTeam = null;
    s.startingTeam = null;
    s.currentTeam = null;
    s.turnsUsed = { red: 0, blue: 0 };
    s.wrongs = { red: 0, blue: 0 };
    s.ready = { red: false, blue: false };
    s.lastResult = null;
    s.message = null;
    s.deadline = null;
    this.pendingDecider = null;
    this.change();
  };

  /* ------------------------------------------------------------------ */
  /* per-recipient view filtering (hide the word from guessers)          */
  /* ------------------------------------------------------------------ */

  GameEngine.viewFor = function (state, playerId) {
    var v = clone(state);
    v.serverNow = Date.now();
    v.you = playerId;
    var me = state.players[playerId];
    var amGiver = me && me.role === "giver";
    if ((state.phase === "decision" || state.phase === "turn") && !amGiver) {
      v.word = null; // guessers never see the live word
    }
    // Expose only locked-in status, not the actual choice — except SKIP, which
    // is shown openly so everyone sees who voted to skip.
    v.decided = {
      red: !!(state.decisions && state.decisions.red),
      blue: !!(state.decisions && state.decisions.blue),
    };
    v.skipVotes = {
      red: !!(state.decisions && state.decisions.red === "skip"),
      blue: !!(state.decisions && state.decisions.blue === "skip"),
    };
    delete v.decisions;
    return v;
  };

  window.GameEngine = GameEngine;
})();
