#!/usr/bin/env node

function usage() {
  console.error(
    "Usage: node verify-deployment.mjs BASE_URL [--health PATH] " +
      "[--health-field key=value] [--title TEXT] [--socketio]"
  );
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  usage();
  process.exit(args.includes("--help") ? 0 : 2);
}

const baseUrl = args.shift().replace(/\/$/, "");
const options = {
  health: null,
  healthField: null,
  title: null,
  socketio: false,
};

while (args.length > 0) {
  const flag = args.shift();
  if (flag === "--socketio") {
    options.socketio = true;
    continue;
  }
  const value = args.shift();
  if (value == null) {
    console.error(`Missing value for ${flag}`);
    process.exit(2);
  }
  if (flag === "--health") options.health = value;
  else if (flag === "--health-field") options.healthField = value;
  else if (flag === "--title") options.title = value;
  else {
    console.error(`Unknown option: ${flag}`);
    usage();
    process.exit(2);
  }
}

const checks = [];
const timeoutMs = 30_000;

async function request(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  return { response, body };
}

try {
  const page = await request(baseUrl);
  checks.push({ name: "page HTTP 200", ok: page.response.status === 200 });

  if (options.title) {
    checks.push({
      name: `page contains ${JSON.stringify(options.title)}`,
      ok: page.body.includes(options.title),
    });
  }

  if (options.health) {
    const healthUrl = new URL(options.health, `${baseUrl}/`).toString();
    const health = await request(healthUrl);
    checks.push({ name: "health HTTP 200", ok: health.response.status === 200 });

    if (options.healthField) {
      const separator = options.healthField.indexOf("=");
      if (separator <= 0) throw new Error("--health-field must use key=value");
      const key = options.healthField.slice(0, separator);
      const expected = options.healthField.slice(separator + 1);
      const payload = JSON.parse(health.body);
      checks.push({
        name: `health ${key}=${expected}`,
        ok: String(payload[key]) === expected,
      });
    }
  }

  if (options.socketio) {
    const socketUrl = `${baseUrl}/socket.io/?EIO=4&transport=polling`;
    const socket = await request(socketUrl);
    checks.push({
      name: "Socket.IO Engine.IO open packet",
      ok: socket.response.status === 200 && socket.body.startsWith("0{"),
    });
  }
} catch (error) {
  console.error(`Verification error: ${error.message}`);
  process.exit(1);
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
}

if (checks.some((check) => !check.ok)) process.exit(1);
