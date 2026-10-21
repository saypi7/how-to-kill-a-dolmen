import test from 'node:test';
import assert from 'node:assert/strict';
import {Connection, socketUrl} from '../src/modules/connection.ts';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function harness({token, deniedStorage = false, url} = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), sockets = [], statuses = [], states = [], errors = [];
  const values = new Map(token ? [['dino-session', token]] : []);
  const clock = {
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, {callback, at: now + delay});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(duration) {
      const end = now + duration;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
  };
  class FakeWebSocket {
    static OPEN = 1;
    constructor(address) { this.url = String(address); this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; return this.onopen?.(); }
    send(data) {
      if (this.failSend) throw new Error('send failed');
      this.sent.push(JSON.parse(data));
    }
    message(data) { this.onmessage?.({data: JSON.stringify(data)}); }
    ack(index = this.sent.length - 1, data = {}) {
      this.message({event: 'ack', requestId: this.sent[index].requestId, ok: true, ...data});
    }
    close(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({code});
    }
  }
  const storage = {
    getItem(key) { if (deniedStorage) throw Error('storage denied'); return values.get(key) || null; },
    setItem(key, value) { if (deniedStorage) throw Error('storage denied'); values.set(key, value); },
    removeItem(key) { if (deniedStorage) throw Error('storage denied'); values.delete(key); },
  };
  const connection = new Connection(state => states.push(state), status => statuses.push(status), error => errors.push(error), {
    WebSocket: FakeWebSocket, storage, origin: 'http://localhost:5173', url, ...clock,
  });
  return {connection, sockets, statuses, states, errors, values, timers, clock};
}

test('server addresses preserve paths and choose the correct WebSocket protocol', () => {
  assert.equal(String(socketUrl(undefined, 'https://game.example')), 'wss://game.example/ws');
  assert.equal(String(socketUrl('https://server.example/', 'http://localhost')), 'wss://server.example/ws');
  assert.equal(String(socketUrl('ws://localhost:8080/ws', 'http://localhost')), 'ws://localhost:8080/ws');
  assert.equal(String(socketUrl('/api/socket', 'http://localhost:5173')), 'ws://localhost:5173/api/socket');
  assert.throws(() => socketUrl('ftp://example.com', 'http://localhost'), /VITE_SERVER_URL/);
});

test('resume must finish before room creation or gameplay controls are enabled', async () => {
  const h = harness({token: 'session-a'});
  const opening = h.sockets[0].open();
  assert.deepEqual(h.statuses, ['connecting']);
  assert.equal(h.sockets[0].sent[0].event, 'resume');
  await assert.rejects(h.connection.send('create'), /연결을 기다려/);
  h.sockets[0].ack();
  await opening;
  assert.equal(h.statuses.at(-1), 'connected');
  const created = h.connection.send('create');
  h.sockets[0].ack(undefined, {token: 'new-session'});
  assert.equal((await created).ok, true);
  assert.equal(h.values.get('dino-session'), 'new-session');
  h.connection.close();
  assert.equal(h.timers.size, 0);
});

test('an expired resume clears stale game state and permits entering a new room', async () => {
  const h = harness({token: 'expired'});
  const opening = h.sockets[0].open();
  h.sockets[0].ack(0, {ok: false, error: '세션이 만료됐어요.'});
  await opening;
  assert.deepEqual(h.states, [null]);
  assert.equal(h.values.has('dino-session'), false);
  assert.equal(h.statuses.at(-1), 'connected');
  assert.deepEqual(h.errors, ['세션이 만료됐어요.']);
  h.connection.close();
});

test('a resume timeout reconnects without enabling stale game controls', async () => {
  const h = harness({token: 'session-a'});
  h.sockets[0].open();
  h.clock.advance(5000);
  await flush();
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(h.statuses.includes('connected'), false);
  h.clock.advance(500);
  const opening = h.sockets[1].open();
  assert.equal(h.sockets[1].sent[0].token, 'session-a');
  h.sockets[1].ack();
  await opening;
  assert.equal(h.statuses.at(-1), 'connected');
  h.connection.close();
  assert.equal(h.timers.size, 0);
});

test('disconnection rejects every pending action and ignores old socket events', async () => {
  const h = harness();
  await h.sockets[0].open();
  const old = h.sockets[0];
  const rejected = assert.rejects(h.connection.send('collect', {id: 's1'}), /연결이 끊겼/);
  old.close();
  await rejected;
  assert.equal(h.connection.pending.size, 0);
  h.clock.advance(500);
  await h.sockets[1].open();
  const statusesBefore = [...h.statuses];
  old.readyState = 1; // Simulate a browser callback already queued before replacement.
  old.message({event: 'state', code: 'STALE'});
  old.ack(0, {token: 'stale-token'});
  old.onclose({code: 1006});
  assert.deepEqual(h.states, []);
  assert.deepEqual(h.statuses, statusesBefore);
  assert.equal(h.values.has('dino-session'), false);
  h.connection.close();
  assert.equal(h.timers.size, 0);
});

test('another tab taking the session cannot cause an automatic takeover loop', async () => {
  const h = harness({token: 'shared'});
  const opening = h.sockets[0].open();
  h.sockets[0].ack();
  await opening;
  h.sockets[0].close(4001);
  assert.equal(h.values.has('dino-session'), false);
  assert.equal(h.states.at(-1), null);
  assert.match(h.errors.at(-1), /다른 탭/);
  h.clock.advance(500);
  await h.sockets[1].open();
  assert.deepEqual(h.sockets[1].sent, []); // New anonymous connection cannot steal the session back.
  assert.equal(h.statuses.at(-1), 'connected');
  h.connection.close();
});

test('denied browser storage still allows acknowledgements and same-tab reconnect', async () => {
  const h = harness({deniedStorage: true});
  await h.sockets[0].open();
  const request = h.connection.send('create');
  h.sockets[0].ack(0, {token: 'memory-session'});
  assert.equal((await request).ok, true);
  h.sockets[0].close();
  h.clock.advance(500);
  const opening = h.sockets[1].open();
  assert.equal(h.sockets[1].sent[0].token, 'memory-session');
  h.sockets[1].ack();
  await opening;
  h.connection.close();
});

test('leaving clears the connection token before any reconnect', async () => {
  const h = harness({token: 'session-a'});
  const opening = h.sockets[0].open();
  h.sockets[0].ack();
  await opening;
  const leaving = h.connection.send('leave');
  h.sockets[0].ack();
  await leaving;
  assert.equal(h.values.has('dino-session'), false);
  h.sockets[0].close();
  h.clock.advance(500);
  await h.sockets[1].open();
  assert.deepEqual(h.sockets[1].sent, []);
  h.connection.close();
});

test('synchronous send failure leaves no orphaned promise or timeout', async () => {
  const h = harness();
  await h.sockets[0].open();
  h.sockets[0].failSend = true;
  await assert.rejects(h.connection.send('ready'), /send failed/);
  assert.equal(h.connection.pending.size, 0);
  assert.equal(h.timers.size, 0);
  h.connection.close();
});

test('timed-out and malformed replies cannot mutate a new session', async () => {
  const h = harness();
  await h.sockets[0].open();
  const timeout = assert.rejects(h.connection.send('create'), /응답이 늦어/);
  h.clock.advance(5000);
  await timeout;
  h.sockets[0].ack(0, {token: 'late-session'});
  h.sockets[0].onmessage({data: 'not-json'});
  h.sockets[0].message(null);
  assert.equal(h.connection.pending.size, 0);
  assert.equal(h.values.has('dino-session'), false);
  assert.deepEqual(h.errors, ['서버 응답을 읽을 수 없습니다.']);
  h.connection.close();
});

test('closing while connecting suppresses queued open callbacks and reconnect timers', async () => {
  const h = harness();
  h.connection.close();
  await h.sockets[0].open();
  h.sockets[0].message({event: 'state', code: 'LATE'});
  h.clock.advance(20000);
  assert.deepEqual(h.states, []);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.connection.send('create'), /연결을 기다려/);
});

test('invalid server configuration is reported without crashing the React effect', () => {
  const h = harness({url: 'not a server address'});
  assert.deepEqual(h.statuses, ['connecting', 'disconnected']);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.errors.length, 1);
  h.connection.close();
});
