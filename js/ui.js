/*
 * ui.js — pure rendering. Given a filtered `view` (state) and a `ctx`, it
 * produces the HTML for #app. All interactivity is delegated: buttons carry
 * data-* attributes that app.js listens for. No game logic lives here.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function playerAt(view, team, role) {
    var players = view.players;
    for (var id in players) {
      if (players[id].team === team && players[id].role === role)
        return players[id];
    }
    return null;
  }

  function teamLabel(team) {
    return team === "red" ? "Red" : team === "blue" ? "Blue" : "";
  }

  function nameFor(view, team, role) {
    var p = playerAt(view, team, role);
    return p ? p.name : null;
  }

  /* ------------------------------- header ------------------------------ */

  function header(view) {
    if (view.phase === "lobby") return "";
    return (
      '<div class="scoreboard">' +
      '<div class="score red"><span class="dot"></span>Red<b>' +
      view.scores.red +
      "</b></div>" +
      '<div class="round-info">Round ' +
      view.round +
      " / " +
      view.config.totalRounds +
      '<span class="half">Half ' +
      view.half +
      "</span></div>" +
      '<div class="score blue"><span class="dot"></span>Blue<b>' +
      view.scores.blue +
      "</b></div>" +
      "</div>"
    );
  }

  function timerBlock(view, seconds) {
    if (!view.deadline) return "";
    return (
      '<div class="timer" data-total="' +
      seconds * 1000 +
      '"><div class="timer-fill" id="timerFill"></div>' +
      '<span class="timer-text" id="timerText"></span></div>'
    );
  }

  /* -------------------------------- lobby ------------------------------ */

  function slot(view, ctx, team, role) {
    var p = playerAt(view, team, role);
    var mine = p && p.id === ctx.myId;
    var label = role === "giver" ? "Clue Giver" : "Guesser";
    var inner;
    if (p) {
      inner =
        '<span class="slot-name">' +
        esc(p.name) +
        (p.connected === false ? " (offline)" : "") +
        (p.id === view.hostId ? " 👑" : "") +
        "</span>";
      if (mine)
        inner +=
          '<button class="mini" data-act="leave">Leave</button>';
    } else {
      inner =
        '<button class="join-slot" data-act="pick" data-team="' +
        team +
        '" data-role="' +
        role +
        '">Join</button>';
    }
    return (
      '<div class="slot ' +
      (p ? "filled" : "") +
      '"><div class="slot-role">' +
      label +
      "</div>" +
      inner +
      "</div>"
    );
  }

  function lobby(view, ctx) {
    var me = view.players[ctx.myId] || {};
    var roomCode = view.hostId;
    var shareUrl =
      location.origin + location.pathname + "?room=" + roomCode;
    var unassigned = [];
    view.order.forEach(function (id) {
      var p = view.players[id];
      if (p && !p.team) unassigned.push(p);
    });

    var isHost = ctx.myId === view.hostId;
    var ready =
      playerAt(view, "red", "giver") &&
      playerAt(view, "red", "guesser") &&
      playerAt(view, "blue", "giver") &&
      playerAt(view, "blue", "guesser");

    var cfg = view.config;
    var sliderRow = function (name, key, min, max, step, unit, disabled) {
      var val = cfg[key];
      return (
        '<label class="cfg-row' +
        (disabled ? " disabled" : "") +
        '"><span class="cfg-name">' +
        name +
        "</span>" +
        '<input type="range" min="' +
        min +
        '" max="' +
        max +
        '" step="' +
        step +
        '" value="' +
        val +
        '" data-cfg="' +
        key +
        '" data-unit="' +
        (unit || "") +
        '"' +
        (disabled ? " disabled" : "") +
        ">" +
        '<span class="cfg-val" data-cfg-val="' +
        key +
        '">' +
        val +
        (unit || "") +
        "</span>" +
        "</label>"
      );
    };
    var ro = !isHost;
    var sliders =
      sliderRow("Turn timer", "turnSeconds", 10, 30, 1, "s", ro) +
      sliderRow("Decision timer", "decisionSeconds", 8, 20, 1, "s", ro) +
      sliderRow("Total rounds", "totalRounds", 6, 20, 2, "", ro) +
      sliderRow("Turns per team / round", "turnsPerTeam", 1, 7, 1, "", ro) +
      sliderRow("Full points (perfect round)", "fullPoints", 1, 10, 1, "", ro);
    var configHtml =
      '<div class="config card"><h3>Game Settings</h3>' +
      sliders +
      (isHost
        ? '<button class="mini set-defaults" data-act="resetDefaults">Set to defaults</button>'
        : '<p class="muted small center">Only the host can change these.</p>') +
      "</div>";

    return (
      '<div class="lobby">' +
      '<div class="room-banner card">' +
      "<div>Room code<br><span class=\"room-code\">" +
      esc(roomCode) +
      "</span></div>" +
      '<button class="mini" data-act="copyCode">Copy code</button>' +
      '<button class="mini" data-act="copyLink" data-link="' +
      esc(shareUrl) +
      '">Copy invite link</button>' +
      "</div>" +
      '<div class="name-row card"><label>Your name <input id="nameInput" type="text" maxlength="20" value="' +
      esc(me.name || "") +
      '"></label><button class="mini" data-act="rename">Save</button></div>' +
      '<div class="teams">' +
      '<div class="team-col red"><h2>Red Team</h2>' +
      slot(view, ctx, "red", "giver") +
      slot(view, ctx, "red", "guesser") +
      "</div>" +
      '<div class="team-col blue"><h2>Blue Team</h2>' +
      slot(view, ctx, "blue", "giver") +
      slot(view, ctx, "blue", "guesser") +
      "</div>" +
      "</div>" +
      (unassigned.length
        ? '<div class="card unassigned"><h3>Not on a team</h3><p>' +
          unassigned
            .map(function (p) {
              return esc(p.name) + (p.id === ctx.myId ? " (you)" : "");
            })
            .join(", ") +
          "</p></div>"
        : "") +
      configHtml +
      (isHost
        ? '<button class="primary big" data-act="start"' +
          (ready ? "" : " disabled") +
          ">" +
          (ready ? "Start Game" : "Waiting for 4 players…") +
          "</button>"
        : '<div class="card muted center">Waiting for the host to start…</div>') +
      "</div>"
    );
  }

  /* ------------------------------ decision ----------------------------- */

  function decision(view, ctx) {
    var me = view.players[ctx.myId] || {};
    var amGiver = me.role === "giver";
    var amStarter = amGiver && me.team === view.firstGiverTeam;
    var locked = view.decided[me.team];
    var starter = playerAt(view, view.firstGiverTeam, "giver");
    var starterName = starter ? starter.name : teamLabel(view.firstGiverTeam);

    var body;
    if (amStarter) {
      var choiceButtons = locked
        ? '<div class="waiting">Locked in ✓ — starting the round…</div>'
        : '<div class="choices">' +
          '<button class="choice play" data-act="decision" data-choice="play">PLAY<small>My team gives clues</small></button>' +
          '<button class="choice pass" data-act="decision" data-choice="pass">PASS<small>Other team gives clues</small></button>' +
          '<button class="choice skip" data-act="decision" data-choice="skip">SKIP<small>New word (both must skip)</small></button>' +
          "</div>";
      body =
        '<div class="word-card ' +
        me.team +
        '"><div class="word-label">The word is</div><div class="the-word">' +
        esc(view.word) +
        "</div></div>" +
        '<p class="decide-note">You decide first…</p>' +
        choiceButtons;
    } else if (amGiver) {
      // The other giver can only vote to SKIP.
      var skipBtn = locked
        ? '<div class="waiting">SKIP vote locked ✓</div>'
        : '<div class="choices one">' +
          '<button class="choice skip" data-act="decision" data-choice="skip">SKIP<small>Only if you also want a new word</small></button>' +
          "</div>";
      body =
        '<div class="word-card ' +
        me.team +
        '"><div class="word-label">The word is</div><div class="the-word">' +
        esc(view.word) +
        "</div></div>" +
        '<p class="decide-note"><b>' +
        esc(starterName) +
        "</b> decides play or pass. You may vote to SKIP.</p>" +
        skipBtn;
    } else {
      body =
        '<div class="word-card hidden-word"><div class="word-label">The word is hidden from guessers</div><div class="the-word">? ? ?</div></div>' +
        '<p class="decide-note"><b>' +
        esc(starterName) +
        "</b> is deciding whether to play this word…</p>";
    }

    return (
      header(view) +
      '<div class="phase decision-phase">' +
      "<h2>Round " +
      view.round +
      " — " +
      teamLabel(view.firstGiverTeam) +
      " decides</h2>" +
      timerBlock(view, view.config.decisionSeconds) +
      '<div class="lock-status">' +
      lockPill(view, "red") +
      lockPill(view, "blue") +
      "</div>" +
      body +
      (view.message ? '<div class="banner">' + esc(view.message) + "</div>" : "") +
      "</div>"
    );
  }

  function lockPill(view, team) {
    var g = playerAt(view, team, "giver");
    var name = g ? g.name : teamLabel(team) + " giver";
    var on = view.decided[team];
    var skipped = view.skipVotes && view.skipVotes[team];
    var text = skipped
      ? esc(name) + " votes to SKIP!"
      : esc(name) + " " + (on ? "✓" : "…");
    return (
      '<span class="pill ' +
      team +
      (on ? " on" : "") +
      '">' +
      text +
      "</span>"
    );
  }

  /* -------------------------------- turn ------------------------------- */

  function turn(view, ctx) {
    var me = view.players[ctx.myId] || {};
    var team = view.currentTeam;
    var giver = playerAt(view, team, "giver");
    var guesser = playerAt(view, team, "guesser");
    var amActiveGiver = giver && giver.id === ctx.myId;
    var amGiver = me.role === "giver";
    var myTeamTurn = me.team === team;

    var main;
    if (amActiveGiver) {
      main =
        '<div class="word-card ' +
        team +
        '"><div class="word-label">Give a one-word clue for</div><div class="the-word">' +
        esc(view.word) +
        "</div></div>" +
        '<p class="turn-note">Did <b>' +
        esc(guesser ? guesser.name : "your guesser") +
        "</b> guess the password?</p>" +
        '<div class="result-buttons">' +
        '<button class="result correct" data-act="result" data-result="correct">CORRECT</button>' +
        '<button class="result wrong" data-act="result" data-result="wrong">WRONG</button>' +
        "</div>";
    } else if (amGiver) {
      // The other giver already knows the word.
      main =
        '<div class="word-card ' +
        me.team +
        ' dim"><div class="word-label">The word</div><div class="the-word">' +
        esc(view.word) +
        "</div></div>" +
        '<p class="turn-note">' +
        teamLabel(team) +
        "'s clue giver is up. Wait your turn.</p>";
    } else {
      // A guesser.
      main =
        '<div class="word-card hidden-word"><div class="word-label">Listen for the clue</div><div class="the-word">? ? ?</div></div>' +
        '<p class="turn-note big">' +
        (myTeamTurn
          ? "🎤 YOUR TURN — guess out loud!"
          : "Opponent is guessing…") +
        "</p>";
    }

    return (
      header(view) +
      '<div class="phase turn-phase ' +
      team +
      '-turn">' +
      '<h2 class="whose-turn ' +
      team +
      '">' +
      teamLabel(team) +
      "'s turn — " +
      esc(giver ? giver.name : "") +
      " → " +
      esc(guesser ? guesser.name : "") +
      "</h2>" +
      timerBlock(view, view.config.turnSeconds) +
      main +
      turnTracker(view) +
      "</div>"
    );
  }

  function turnTracker(view) {
    var max = view.config.turnsPerTeam;
    var full = view.config.fullPoints;
    function pips(team) {
      var used = view.turnsUsed[team];
      var out = "";
      for (var i = 0; i < max; i++) {
        out +=
          '<span class="pip ' + (i < used ? "used " + team : "") + '"></span>';
      }
      return out;
    }
    return (
      '<div class="tracker">' +
      '<div class="track red"><span>Red</span>' +
      pips("red") +
      '<em>worth ' +
      Math.max(0, full - view.turnsUsed.red) +
      " pts</em></div>" +
      '<div class="track blue"><span>Blue</span>' +
      pips("blue") +
      '<em>worth ' +
      Math.max(0, full - view.turnsUsed.blue) +
      " pts</em></div>" +
      "</div>"
    );
  }

  /* ------------------------------ roundEnd ----------------------------- */

  // Shows each clue giver's readiness plus a button for the giver(s) to click.
  function readyPanel(view, ctx, buttonLabel) {
    var me = view.players[ctx.myId] || {};
    var amGiver = me.role === "giver";
    var ready = view.ready || { red: false, blue: false };
    var myReady = amGiver && ready[me.team];

    function pill(team) {
      var g = playerAt(view, team, "giver");
      var name = g ? g.name : teamLabel(team);
      var on = ready[team];
      return (
        '<span class="pill ' +
        team +
        (on ? " on" : "") +
        '">' +
        esc(name) +
        " " +
        (on ? "✓ READY" : "…") +
        "</span>"
      );
    }

    var control;
    if (amGiver && !myReady) {
      control =
        '<button class="primary ready-btn" data-act="ready">' +
        buttonLabel +
        "</button>";
    } else if (amGiver && myReady) {
      control =
        '<div class="waiting">You\'re ready ✓ — waiting for the other clue giver…</div>';
    } else {
      control =
        '<div class="muted center">Waiting for both clue givers to be ready…</div>';
    }

    return (
      '<div class="ready-status">' +
      pill("red") +
      pill("blue") +
      "</div>" +
      control
    );
  }

  function roundEnd(view, ctx) {
    var r = view.lastResult || {};
    var scored = r.scoringTeam;
    var isFinal = view.round >= view.config.totalRounds;
    var banner = scored
      ? '<div class="result-banner ' +
        scored +
        '">' +
        teamLabel(scored) +
        " scores " +
        r.points +
        " point" +
        (r.points === 1 ? "" : "s") +
        "!</div>"
      : '<div class="result-banner none">No score this round</div>';
    var footer = isFinal
      ? timerBlock(view, view.config.roundEndSeconds) +
        '<p class="muted center">Calculating final scores…</p>'
      : readyPanel(view, ctx, "Next Round →");
    return (
      header(view) +
      '<div class="phase round-end">' +
      "<h2>Round " +
      view.round +
      " complete</h2>" +
      '<div class="word-card reveal"><div class="word-label">The word was</div><div class="the-word">' +
      esc(r.word) +
      "</div></div>" +
      banner +
      footer +
      "</div>"
    );
  }

  /* ------------------------------ halftime ----------------------------- */

  function halftime(view, ctx) {
    var me = view.players[ctx.myId] || {};
    return (
      header(view) +
      '<div class="phase halftime">' +
      "<h1>Halftime!</h1>" +
      "<p>Clue givers and guessers have swapped roles.</p>" +
      '<div class="role-cards">' +
      roleCard(view, "red") +
      roleCard(view, "blue") +
      "</div>" +
      '<div class="banner">You are now the <b>' +
      (me.role === "giver" ? "Clue Giver" : "Guesser") +
      "</b> for " +
      teamLabel(me.team) +
      ".</div>" +
      readyPanel(view, ctx, "Start second half") +
      "</div>"
    );
  }

  function roleCard(view, team) {
    return (
      '<div class="role-card ' +
      team +
      '"><h3>' +
      teamLabel(team) +
      "</h3>" +
      "<div>Giver: <b>" +
      esc(nameFor(view, team, "giver") || "—") +
      "</b></div>" +
      "<div>Guesser: <b>" +
      esc(nameFor(view, team, "guesser") || "—") +
      "</b></div></div>"
    );
  }

  /* ------------------------------ gameEnd ------------------------------ */

  function gameEnd(view, ctx) {
    var isHost = ctx.myId === view.hostId;
    var red = view.scores.red;
    var blue = view.scores.blue;
    var title =
      red === blue
        ? "It's a tie!"
        : (red > blue ? "Red" : "Blue") + " team wins!";
    var winClass = red === blue ? "tie" : red > blue ? "red" : "blue";

    var rows = view.history
      .map(function (h) {
        return (
          "<tr>" +
          "<td>" +
          h.round +
          "</td>" +
          "<td>" +
          h.half +
          "</td>" +
          "<td>" +
          esc(h.word) +
          "</td>" +
          '<td class="' +
          (h.scoringTeam || "") +
          '">' +
          (h.scoringTeam ? teamLabel(h.scoringTeam) : "—") +
          "</td>" +
          "<td>" +
          (h.points || 0) +
          "</td>" +
          '<td class="red">' +
          h.turnsUsed.red +
          "</td>" +
          '<td class="blue">' +
          h.turnsUsed.blue +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="phase game-end">' +
      '<div class="winner ' +
      winClass +
      '">' +
      title +
      "</div>" +
      '<div class="final-scores">' +
      '<div class="fs red">Red<b>' +
      red +
      "</b></div>" +
      '<div class="fs blue">Blue<b>' +
      blue +
      "</b></div>" +
      "</div>" +
      '<div class="card stats"><h3>Round-by-round</h3>' +
      '<table class="stats-table"><thead><tr>' +
      "<th>Rd</th><th>Half</th><th>Word</th><th>Scored</th><th>Pts</th><th>Red&nbsp;tries</th><th>Blue&nbsp;tries</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      '<p class="muted small legend">Tries = the number of clue attempts each team used that round. The first correct guess scores full points; every extra try (a wrong guess or a timed-out turn) lowers that round\'s points by one.</p>' +
      "</div>" +
      (isHost
        ? '<button class="primary big" data-act="returnLobby">Return to Lobby</button>'
        : '<div class="card muted center">Waiting for the host to return to the lobby…</div>') +
      "</div>"
    );
  }

  /* ------------------------------- render ------------------------------ */

  function render(view, ctx) {
    switch (view.phase) {
      case "lobby":
        return lobby(view, ctx);
      case "decision":
        return decision(view, ctx);
      case "turn":
        return turn(view, ctx);
      case "roundEnd":
        return roundEnd(view, ctx);
      case "halftime":
        return halftime(view, ctx);
      case "gameEnd":
        return gameEnd(view, ctx);
      default:
        return "<p>Loading…</p>";
    }
  }

  window.UI = { render: render };
})();
