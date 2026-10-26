import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokFeed } from '../src/tiktok.js';

// The feed only needs the WebSocket surface it assigns to, so a stub keeps the
// test offline and lets it push bridge messages by hand.
class FakeSocket {
  static last = null;
  constructor() {
    this.readyState = 1;
    FakeSocket.last = this;
  }
  close() {
    this.readyState = 3;
  }
}

function connect() {
  globalThis.WebSocket = FakeSocket;
  const gifts = [];
  const feed = createTikTokFeed({ onGift: (effect, viewer, count) => gifts.push({ effect, viewer, count }) });
  feed.setEnabled(true);
  const socket = FakeSocket.last;
  socket.onopen();
  return { feed, socket, gifts };
}

const send = (socket, giftId, count = 1, uniqueId = 'viewer') =>
  socket.onmessage({ data: JSON.stringify({ t: 'gift', giftId, user: { uniqueId }, count }) });

test('gift ids carry their own effect and item count', () => {
  const { socket, gifts } = connect();
  send(socket, 6064);
  send(socket, 5487);
  send(socket, 8913);
  send(socket, 5879);
  send(socket, 5659);
  send(socket, 10802);

  assert.deepEqual(gifts, [
    { effect: 'bomb', viewer: 'viewer', count: 5 },
    { effect: 'apple', viewer: 'viewer', count: 20 },
    { effect: 'bomb', viewer: 'viewer', count: 20 },
    { effect: 'bomb', viewer: 'viewer', count: 50 },
    { effect: 'taller', viewer: 'viewer', count: 1 },
    { effect: 'widen', viewer: 'viewer', count: 1 },
  ]);
});

test('an apple gift with no rule still feeds five apples', () => {
  const { socket, gifts } = connect();
  socket.onmessage({ data: JSON.stringify({ t: 'catalog', gifts: [{ id: 5269, name: 'TikTok' }] }) });
  send(socket, 5269, 1, 'tiktok-fan');
  assert.deepEqual(gifts, [{ effect: 'apple', viewer: 'tiktok-fan', count: 5 }]);
});

test('a combo pays out once, whatever the tap count', () => {
  const { socket, gifts } = connect();
  send(socket, 5879, 3);
  assert.equal(gifts[0].count, 50);
  send(socket, 5879, 9);
  assert.equal(gifts[1].count, 50);
});

test('an unmapped gift is ignored and reported', () => {
  const { feed, socket, gifts } = connect();
  send(socket, 999999);
  assert.deepEqual(gifts, []);
  assert.equal(feed.status().ignored, 1);
  assert.deepEqual(feed.unknown()[0], { giftId: 999999, name: '' });
});

test('the bridge panel rules override the baked-in table', () => {
  const { socket, gifts } = connect();
  socket.onmessage({
    data: JSON.stringify({ t: 'rules', rules: { '5879': { effect: 'speed', count: 2 }, '12': { effect: 'nope', count: 3 } } }),
  });
  send(socket, 5879);
  send(socket, 6064);
  send(socket, 12);
  assert.deepEqual(gifts, [
    { effect: 'speed', viewer: 'viewer', count: 2 },
    { effect: 'bomb', viewer: 'viewer', count: 5 },
  ]);
});

test('an interaction only fires when the panel maps its kind', () => {
  const { feed, socket, gifts } = connect();
  const sendInteraction = (kind) =>
    socket.onmessage({ data: JSON.stringify({ t: 'interaction', kind, user: { uniqueId: 'nova' } }) });

  sendInteraction('follow');
  assert.deepEqual(gifts, []);
  assert.equal(feed.status().ignored, 0, 'an unmapped interaction is not an ignored gift');

  socket.onmessage({ data: JSON.stringify({ t: 'rules', rules: { follow: { effect: 'apple', count: 3 } } }) });
  sendInteraction('follow');
  sendInteraction('share');
  assert.deepEqual(gifts, [{ effect: 'apple', viewer: 'nova', count: 3 }]);
});

test('an interaction without a count falls back like a gift does', () => {
  const { socket, gifts } = connect();
  socket.onmessage({ data: JSON.stringify({ t: 'rules', rules: { like: { effect: 'apple' } } }) });
  socket.onmessage({ data: JSON.stringify({ t: 'interaction', kind: 'like', count: 12, user: { uniqueId: 'kito' } }) });
  assert.deepEqual(gifts, [{ effect: 'apple', viewer: 'kito', count: 5 }]);
});

test('the room from the bridge reaches the debug menu', () => {
  const { feed, socket } = connect();
  socket.onmessage({ data: JSON.stringify({ t: 'status', state: 'live', user: 'quwleqxr91m' }) });
  assert.equal(feed.status().room, 'quwleqxr91m');
});

test('reconnect sends the typed room over the socket', () => {
  const { feed, socket } = connect();
  const sent = [];
  socket.send = (data) => sent.push(JSON.parse(data));

  assert.equal(feed.reconnect(' @newroom '), true);
  assert.deepEqual(sent, [{ t: 'reconnect', user: '@newroom' }]);

  assert.equal(feed.reconnect(''), true);
  assert.deepEqual(sent[1], { t: 'reconnect', user: '' });
});

test('reconnect refuses when the socket is closed', () => {
  globalThis.WebSocket = FakeSocket;
  const feed = createTikTokFeed({});
  assert.equal(feed.reconnect('room'), false);
});
