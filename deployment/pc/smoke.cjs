const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const target = process.env.PILOT_BACKEND_URL || 'http://127.0.0.1:4103';
const publicIp = process.env.PILOT_PUBLIC_IP;
let publicLookups = 0;
const publicAgent = publicIp ? new (require('node:https').Agent)({
  lookup(hostname, options, callback) {
    assert.equal(hostname, new URL(target).hostname);
    publicLookups++;
    if (options.all) callback(null, [{ address: publicIp, family: 4 }]);
    else callback(null, publicIp, 4);
  },
}) : undefined;
const sockets = [];
const checks = [];
function event(socket, name, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
    function handler(...args) { clearTimeout(timer); resolve(args); }
    socket.once(name, handler);
  });
}
async function connect(transport) {
  const socket = io(target, { transports: [transport], upgrade: false, reconnection: false, forceNew: true, autoConnect: false, agent: publicAgent });
  sockets.push(socket);
  const connected = event(socket, 'connect');
  socket.connect();
  await connected;
  assert.equal(socket.io.engine.transport.name, transport);
  return socket;
}
function ack(socket, name, ...args) { return socket.timeout(5000).emitWithAck(name, ...args); }
async function run() {
  let response = await fetch(`${target}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  checks.push('health HTTP 200');
  response = await fetch(target);
  assert.equal(response.status, 404);
  checks.push('backend does not serve frontend HTML');
  response = await fetch(`${target}/api/analytics-config`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).enabled, false);
  checks.push('pilot analytics disabled');
  response = await fetch(`${target}/socket.io/?EIO=4&transport=polling`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /^0\{"sid":/);
  checks.push('Socket.IO polling handshake');
  const host = await connect('websocket');
  const guest = await connect('polling');
  const room = await ack(host, 'create_room', { name: 'PILOT HOST', colorIdx: 0 });
  assert.equal(room.success, true);
  const joined = await ack(guest, 'join_room', room.roomId, { name: 'PILOT GUEST', colorIdx: 1 });
  assert.equal(joined.success, true);
  assert.equal(joined.players.length, 2);
  checks.push('two clients connected using WebSocket and polling; room created and joined');
  const guestStarted = event(guest, 'start_game');
  const started = await ack(host, 'start_game', room.roomId, { spawnAssignments: { [host.id]: { x: 200, y: 200 }, [guest.id]: { x: 400, y: 400 } } });
  assert.equal(started.success, true);
  assert.equal((await guestStarted)[0].roundId, started.roundId);
  checks.push('host starts match and guest receives start');
  const guestState = event(guest, 'game_state');
  host.emit('host_game_state', room.roomId, { roundId: started.roundId, criticalSnapshot: true, pilotMarker: 'local-only', players: [] });
  assert.equal((await guestState)[0].pilotMarker, 'local-only');
  checks.push('host state relayed to guest');
  const hostInput = event(host, 'client_input');
  guest.emit('client_input', room.roomId, { roundId: started.roundId, x: 400, y: 400 });
  const [playerId, input] = await hostInput;
  assert.equal(playerId, guest.id);
  assert.equal(input.roundId, started.roundId);
  checks.push('guest input relayed to host');
  const disconnected = event(host, 'player_disconnected');
  guest.disconnect();
  await disconnected;
  const resumedGuest = await connect('websocket');
  const resumed = await ack(resumedGuest, 'resume_room', room.roomId, joined.resumeToken);
  assert.equal(resumed.success, true);
  assert.equal(resumed.matchActive, true);
  assert.equal(resumed.players.length, 2);
  resumedGuest.emit('confirm_resume', room.roomId, resumed.resumeToken);
  checks.push('short guest disconnect and session resume');
  if (publicIp) assert.ok(publicLookups >= 3, 'clients must use the public relay');
  console.log(JSON.stringify({ target, publicIp, publicLookups, passed: checks.length, checks }, null, 2));
}
run().catch(error => { console.error(JSON.stringify({ error: error.message, completedChecks: checks }, null, 2)); process.exitCode = 1; }).finally(() => { for (const socket of sockets) socket.disconnect(); });
