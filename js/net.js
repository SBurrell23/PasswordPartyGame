/*
 * net.js — thin PeerJS wrapper for host-authoritative P2P.
 *
 * Host: creates a Peer whose id IS the room code; accepts connections from
 *       clients and keeps them in `conns`.
 * Client: creates a Peer with a random id and connects to the host's room code.
 *
 * Message shapes on the wire:
 *   client -> host : { type:'hello', name }          (sent right after connect)
 *                    { type:'action', action:{...} }
 *   host   -> client: { type:'state', state:{...} }
 */
(function () {
  "use strict";

  // Default PeerJS cloud signalling server. No account required.
  var PEER_OPTS = { debug: 1 };

  function Net() {
    this.peer = null;
    this.isHost = false;
    this.myId = null;
    this.hostConn = null; // client only
    this.conns = {}; // host only: peerId -> DataConnection
    this.handlers = {};
  }

  Net.prototype.on = function (event, cb) {
    this.handlers[event] = cb;
    return this;
  };

  Net.prototype._emit = function (event) {
    var cb = this.handlers[event];
    if (cb) cb.apply(null, Array.prototype.slice.call(arguments, 1));
  };

  /* ---------------------------- host ---------------------------- */

  Net.prototype.host = function (roomCode) {
    var self = this;
    this.isHost = true;
    return new Promise(function (resolve, reject) {
      self.peer = new Peer(roomCode, PEER_OPTS);
      self.peer.on("open", function (id) {
        self.myId = id;
        resolve(id);
      });
      self.peer.on("error", function (err) {
        if (self.myId) self._emit("error", err);
        else reject(err);
      });
      self.peer.on("connection", function (conn) {
        self._onHostConn(conn);
      });
      self.peer.on("disconnected", function () {
        // Try to keep the signalling link alive so new players can join.
        try {
          self.peer.reconnect();
        } catch (e) {}
      });
    });
  };

  Net.prototype._onHostConn = function (conn) {
    var self = this;
    conn.on("open", function () {
      self.conns[conn.peer] = conn;
      self._emit("peeropen", conn.peer);
    });
    conn.on("data", function (data) {
      self._emit("data", conn.peer, data);
    });
    conn.on("close", function () {
      delete self.conns[conn.peer];
      self._emit("peerclose", conn.peer);
    });
    conn.on("error", function () {});
  };

  /* --------------------------- client --------------------------- */

  Net.prototype.join = function (roomCode) {
    var self = this;
    this.isHost = false;
    return new Promise(function (resolve, reject) {
      self.peer = new Peer(PEER_OPTS);
      var settled = false;
      self.peer.on("open", function (id) {
        self.myId = id;
        var conn = self.peer.connect(roomCode, { reliable: true });
        self.hostConn = conn;
        conn.on("open", function () {
          settled = true;
          self._emit("joined");
          resolve(id);
        });
        conn.on("data", function (data) {
          self._emit("data", roomCode, data);
        });
        conn.on("close", function () {
          self._emit("hostclose");
        });
        conn.on("error", function (err) {
          if (!settled) reject(err);
        });
      });
      self.peer.on("error", function (err) {
        if (!settled) reject(err);
        else self._emit("error", err);
      });
    });
  };

  /* --------------------------- sending -------------------------- */

  Net.prototype.sendToHost = function (msg) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  };

  Net.prototype.sendTo = function (peerId, msg) {
    var c = this.conns[peerId];
    if (c && c.open) c.send(msg);
  };

  // build(peerId) -> message; lets the host send a filtered view per peer.
  Net.prototype.broadcast = function (build) {
    for (var id in this.conns) {
      var c = this.conns[id];
      if (c && c.open) c.send(build(id));
    }
  };

  Net.prototype.destroy = function () {
    try {
      if (this.peer) this.peer.destroy();
    } catch (e) {}
  };

  window.Net = Net;
})();
