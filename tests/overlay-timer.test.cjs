const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../data/overlay/script.js"), "utf8");

function state(mode = "countup", running = false, remaining = 0, tick = 0) {
  return {
    home: {},
    timers: [{ mode, running, remaining_ms: String(remaining), last_tick_ms: String(tick) }],
  };
}

async function overlay(fileState = state()) {
  let now = 100000;
  let fetches = 0;
  let fetchImpl = async () => ({ ok: true, json: async () => fileState });
  const sockets = [];
  const textNode = { nodeValue: "{{ timers[0].mmss }}" };
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = Socket.CONNECTING;
    listeners = {};
    constructor() { sockets.push(this); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    send() {}
    open() { this.readyState = Socket.OPEN; this.listeners.open(); }
    message(payload) { this.listeners.message({ data: JSON.stringify(payload) }); }
    close() { this.readyState = Socket.CLOSED; this.listeners.close(); }
  }
  const context = vm.createContext({
    Date: { now: () => now },
    URLSearchParams,
    WebSocket: Socket,
    window: { location: { search: "" } },
    NodeFilter: { SHOW_TEXT: 4 },
    document: {
      body: {},
      createTreeWalker: () => {
        let visited = false;
        return { nextNode: () => visited ? null : (visited = true, textNode) };
      },
      querySelectorAll: () => [],
    },
    fetch: (...args) => { fetches++; return fetchImpl(...args); },
    setTimeout: () => 1,
    requestAnimationFrame: () => {},
  });
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return {
    context,
    sockets,
    get fetches() { return fetches; },
    advance: (ms) => { now += ms; },
    setFile: (value) => { fileState = value; },
    setFetch: (callback) => { fetchImpl = callback; },
    display: () => { context.renderFrame(); return textNode.nodeValue; },
  };
}

for (const mode of ["countup", "countdown"]) {
  test(`${mode} continues past three seconds on an idle live connection`, async () => {
    const initial = mode === "countup" ? 0 : 60000;
    const app = await overlay(state(mode, false, initial));
    const socket = app.sockets[0];
    socket.open();
    socket.message({ type: "state", state: state(mode, true, initial, 100000) });
    app.advance(2000);
    assert.equal(app.display(), mode === "countup" ? "00:02" : "00:58");
    for (let seconds = 3; seconds <= 10; seconds++) {
      app.advance(1000);
      await app.context.pollLoop();
      assert.equal(app.display(), `00:${String(mode === "countup" ? seconds : 60 - seconds).padStart(2, "0")}`);
    }
    assert.equal(app.fetches, 1, "an idle connection must not trigger file fallback");
  });
}

test("live pause, resume and explicit reset still apply", async () => {
  const app = await overlay();
  const socket = app.sockets[0];
  socket.open();
  socket.message(state("countup", true, 0, 100000));
  app.advance(5000);
  assert.equal(app.display(), "00:05");
  socket.message(state("countup", false, 5000));
  app.advance(5000);
  await app.context.pollLoop();
  assert.equal(app.display(), "00:05");
  socket.message(state("countup", true, 5000, 110000));
  app.advance(5000);
  assert.equal(app.display(), "00:10");
  socket.message(state());
  assert.equal(app.display(), "00:00");
});

test("file polling works before the first socket state and after disconnect", async () => {
  const app = await overlay(state("countup", true, 0, 100000));
  const socket = app.sockets[0];
  socket.open();
  socket.message({ type: "ack" });
  app.advance(4000);
  await app.context.pollLoop();
  assert.equal(app.fetches, 2);
  assert.equal(app.display(), "00:04");
  socket.message(state("countup", true, 10000, 104000));
  socket.close();
  app.setFile(state("countup", false, 12000));
  await app.context.pollLoop();
  assert.equal(app.display(), "00:12");
});

test("reconnected socket uses file fallback until it receives its own state", async () => {
  const app = await overlay();
  app.sockets[0].open();
  app.sockets[0].message(state("countup", true, 0, 100000));
  app.sockets[0].close();
  app.context.connectSocket();
  app.sockets[1].open();
  app.setFile(state("countup", false, 15000));
  await app.context.pollLoop();
  assert.equal(app.display(), "00:15");
  app.sockets[1].message(state("countup", true, 15000, 100000));
  app.advance(5000);
  await app.context.pollLoop();
  assert.equal(app.display(), "00:20");
});

for (const disconnect of [false, true]) {
  test(`in-flight file read cannot overwrite a newer socket state (disconnect=${disconnect})`, async () => {
    const app = await overlay();
    let resolveFetch;
    app.setFetch(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const pending = app.context.pollLoop();
    const socket = app.sockets[0];
    socket.open();
    socket.message(state("countup", true, 0, 100000));
    app.advance(5000);
    if (disconnect) socket.close();
    resolveFetch({ ok: true, json: async () => state() });
    await pending;
    assert.equal(app.display(), "00:05");
  });
}

test("failed file reads preserve the last timer state", async () => {
  const app = await overlay(state("countdown", true, 60000, 100000));
  app.setFetch(async () => { throw new Error("unavailable"); });
  app.advance(5000);
  await app.context.pollLoop();
  assert.equal(app.display(), "00:55");
  app.advance(60000);
  assert.equal(app.display(), "00:00");
});
