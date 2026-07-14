/*
 * app.js — glue between networking, the engine, and the UI.
 *
 * Host runs the GameEngine and broadcasts a per-player filtered view whenever
 * state changes. Clients just receive views and render them. All UI buttons are
 * delegated through data-act attributes handled here.
 */
(function () {
  "use strict";

  var CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  var net = null;
  var engine = null; // host only
  var currentView = null;
  var timeOffset = 0; // serverNow - clientNow
  var timerInterval = null;
  var myName = "";

  var $ = function (id) {
    return document.getElementById(id);
  };

  function genCode(len) {
    var s = "";
    for (var i = 0; i < (len || 4); i++) {
      s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return s;
  }

  function setStatus(msg, isError) {
    var el = $("status");
    el.textContent = msg || "";
    el.className = "status" + (isError ? " error" : "") + (msg ? " show" : "");
  }

  function showApp() {
    $("home").classList.add("hidden");
    $("app").classList.remove("hidden");
  }

  /* ----------------------------- host path ---------------------------- */

  function createLobby(name, attempt) {
    attempt = attempt || 0;
    var code = genCode(4);
    setStatus("Creating lobby…");
    if (net) net.destroy();
    net = new Net();

    engine = new GameEngine(onEngineChange);

    net.on("data", function (peerId, msg) {
      if (!msg) return;
      if (msg.type === "hello") {
        engine.addPlayer(peerId, msg.name);
      } else if (msg.type === "action") {
        engine.dispatch(peerId, msg.action);
      }
    });
    net.on("peerclose", function (peerId) {
      engine.removePlayer(peerId);
    });
    net.on("error", function (err) {
      setStatus("Network error: " + (err && err.type ? err.type : err), true);
    });

    net
      .host(code)
      .then(function (id) {
        engine.setHost(id, name);
        setStatus("");
        showApp();
      })
      .catch(function (err) {
        if (err && err.type === "unavailable-id" && attempt < 6) {
          createLobby(name, attempt + 1);
        } else {
          setStatus(
            "Could not create lobby: " + (err && err.type ? err.type : err),
            true
          );
        }
      });
  }

  function onEngineChange(state) {
    // Host renders its own filtered view and pushes views to everyone else.
    currentView = GameEngine.viewFor(state, net.myId);
    timeOffset = 0;
    renderApp();
    net.broadcast(function (peerId) {
      return { type: "state", state: GameEngine.viewFor(state, peerId) };
    });
  }

  /* ---------------------------- client path --------------------------- */

  function joinLobby(code, name) {
    code = String(code || "").trim().toUpperCase();
    if (!code) {
      setStatus("Enter a room code to join.", true);
      return;
    }
    setStatus("Joining " + code + "…");
    if (net) net.destroy();
    net = new Net();

    net.on("data", function (peerId, msg) {
      if (msg && msg.type === "state") applyState(msg.state);
    });
    net.on("hostclose", function () {
      setStatus("Lost connection to the host.", true);
    });
    net.on("error", function (err) {
      setStatus("Network error: " + (err && err.type ? err.type : err), true);
    });

    net
      .join(code)
      .then(function () {
        net.sendToHost({ type: "hello", name: name });
        setStatus("");
        showApp();
      })
      .catch(function (err) {
        var t = err && err.type ? err.type : err;
        var friendly =
          t === "peer-unavailable"
            ? "No lobby found with that code."
            : "Could not join: " + t;
        setStatus(friendly, true);
      });
  }

  function applyState(view) {
    currentView = view;
    timeOffset = (view.serverNow || Date.now()) - Date.now();
    renderApp();
  }

  /* --------------------------- action sending ------------------------- */

  function sendAction(action) {
    if (!net) return;
    if (net.isHost) engine.dispatch(net.myId, action);
    else net.sendToHost({ type: "action", action: action });
  }

  /* ------------------------------ rendering --------------------------- */

  function renderApp() {
    if (!currentView) return;
    var ctx = { myId: net.myId, isHost: net.isHost };
    $("app").innerHTML = UI.render(currentView, ctx);
    var foot = $("footer");
    if (foot) foot.style.display = currentView.phase === "lobby" ? "" : "none";
    startTimerTick();
  }

  function startTimerTick() {
    if (timerInterval) clearInterval(timerInterval);
    updateTimer();
    timerInterval = setInterval(updateTimer, 100);
  }

  function updateTimer() {
    var fill = $("timerFill");
    var text = $("timerText");
    var box = document.querySelector(".timer");
    if (!currentView || !currentView.deadline || !fill || !box) return;
    var total = parseInt(box.getAttribute("data-total"), 10) || 1;
    var remaining = currentView.deadline - (Date.now() + timeOffset);
    if (remaining < 0) remaining = 0;
    var pct = Math.max(0, Math.min(1, remaining / total));
    fill.style.width = pct * 100 + "%";
    if (text) text.textContent = Math.ceil(remaining / 1000) + "s";
    if (pct < 0.34) fill.classList.add("low");
    else fill.classList.remove("low");
  }

  /* --------------------------- event wiring --------------------------- */

  function onAppClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    switch (act) {
      case "pick":
        sendAction({
          type: "pickTeam",
          team: btn.getAttribute("data-team"),
          role: btn.getAttribute("data-role"),
        });
        break;
      case "leave":
        sendAction({ type: "leaveTeam" });
        break;
      case "start":
        sendAction({ type: "start" });
        break;
      case "decision":
        sendAction({ type: "decision", choice: btn.getAttribute("data-choice") });
        break;
      case "result":
        sendAction({ type: "turnResult", result: btn.getAttribute("data-result") });
        break;
      case "ready":
        sendAction({ type: "ready" });
        break;
      case "returnLobby":
        sendAction({ type: "returnLobby" });
        break;
      case "resetDefaults":
        sendAction({ type: "resetConfig" });
        break;
      case "rename":
        var input = $("nameInput");
        if (input && input.value.trim()) {
          myName = input.value.trim();
          sendAction({ type: "rename", name: myName });
        }
        break;
      case "copyCode":
        copyText(currentView.hostId, btn, "Copied!");
        break;
      case "copyLink":
        copyText(btn.getAttribute("data-link"), btn, "Copied!");
        break;
      default:
        break;
    }
  }

  function onAppChange(e) {
    var input = e.target.closest("[data-cfg]");
    if (!input) return;
    var cfg = {};
    document.querySelectorAll("[data-cfg]").forEach(function (el) {
      cfg[el.getAttribute("data-cfg")] = el.value;
    });
    sendAction({ type: "setConfig", config: cfg });
  }

  // Live-update a slider's value readout while dragging (no network traffic).
  function onAppInput(e) {
    var input = e.target.closest("[data-cfg]");
    if (!input) return;
    var key = input.getAttribute("data-cfg");
    var unit = input.getAttribute("data-unit") || "";
    var out = document.querySelector('[data-cfg-val="' + key + '"]');
    if (out) out.textContent = input.value + unit;
  }

  function copyText(text, btn, okLabel) {
    var restore = btn.textContent;
    function done() {
      btn.textContent = okLabel;
      setTimeout(function () {
        btn.textContent = restore;
      }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  /* ------------------------------- boot ------------------------------- */

  function boot() {
    var params = new URLSearchParams(location.search);
    var presetRoom = params.get("room");
    if (presetRoom) $("joinCode").value = presetRoom.toUpperCase();

    $("createBtn").addEventListener("click", function () {
      var name = $("hostName").value.trim() || "Host";
      myName = name;
      createLobby(name);
    });
    $("joinBtn").addEventListener("click", function () {
      var name = $("joinName").value.trim() || "Player";
      myName = name;
      joinLobby($("joinCode").value, name);
    });

    document.addEventListener("click", function (e) {
      if (e.target.closest("#app")) onAppClick(e);
    });
    $("app").addEventListener("change", onAppChange);
    $("app").addEventListener("input", onAppInput);

    // Enter-to-submit conveniences.
    $("hostName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("createBtn").click();
    });
    $("joinCode").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("joinBtn").click();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
