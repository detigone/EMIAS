'use strict';

/**
 * WebSocket-хаб (путь /ws): двусторонний канал real-time.
 * Клиенты — веб-панель, будущий Discord-бот и планировщик напоминаний.
 * Сервер broadcast'ит события из shared/constants.WS_EVENTS всем
 * подключённым клиентам; клиент может фильтровать их сам.
 */

const { WebSocketServer } = require('ws');
const { WS_EVENTS } = require('../../shared/constants');

const clients = new Set();
const listeners = new Set();
let wss = null;
let heartbeat = null;

function attach(httpServer) {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    // Аутентификация по сессионной cookie (веб-панель).
    // Бот (фаза 2) будет подключаться со служебным заголовком X-Bot-Key.
    const cookies = req.headers.cookie || '';
    const hasSession = /(?:^|;\s*)emias_session=[^;]+/.test(cookies);
    const botKey = process.env.BOT_SHARED_SECRET || '';
    const hasBotKey = botKey && req.headers['x-bot-key'] === botKey;
    if (!hasSession && !hasBotKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.send(JSON.stringify({ event: WS_EVENTS.QUEUE_UPDATED, data: { hello: true } }));
  });

  heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
}

/** Рассылка события всем подключённым клиентам (бот + веб-панели). */
function broadcast(event, data = {}) {
  // Листенеры (вебхуки и пр.) вызываются всегда, даже если WS-сервер не запущен.
  for (const fn of listeners) {
    try { fn(event, data); } catch (_) { /* swallow */ }
  }
  if (!wss) return;
  const payload = JSON.stringify({ event, data, ts: Date.now() });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

/** Подписка на события (для вебхуков, планировщиков и пр.). Возвращает unsubscribe. */
function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function close() {
  clearInterval(heartbeat);
  if (wss) wss.close();
}

module.exports = { attach, broadcast, on, close };
