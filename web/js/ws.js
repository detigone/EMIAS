/* ЕМИАС — WebSocket helper (window.WS) */
(function () {
  'use strict';

  var handlers = {};
  var socket = null;
  var reconnectTimer = null;

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws';

    try {
      socket = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    socket.onopen = function () {
      emit('connect');
    };

    socket.onclose = function () {
      emit('disconnect');
      scheduleReconnect();
    };

    socket.onerror = function () {
      socket.close();
    };

    socket.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.event) {
          emit(msg.event, msg.data);
        }
      } catch (e) { /* ignore */ }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function emit(event, data) {
    var list = handlers[event];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { /* ignore */ }
    }
  }

  window.WS = {
    /**
     * Subscribe to a WebSocket event.
     * Events: queue.updated, appointment.created, appointment.status.updated,
     *         doctor.status.updated, patient.created, emr.updated,
     *         connect, disconnect
     */
    on: function (event, fn) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
    },

    /** Send a message (if needed). */
    send: function (data) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(typeof data === 'string' ? data : JSON.stringify(data));
      }
    },

    /** Force reconnect. */
    reconnect: function () {
      if (socket) socket.close();
      connect();
    }
  };

  /* Auto-connect when DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
