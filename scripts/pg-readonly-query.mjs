import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const connectionString = process.env.DATABASE_URL;
const sql = process.argv.slice(2).join(" ").trim();

if (!connectionString) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

if (!/^(select|with|explain)\b/i.test(sql)) {
  console.error("Refusing non-read-only SQL. Use SELECT, WITH, or EXPLAIN.");
  process.exit(1);
}

const url = new URL(connectionString);
const config = {
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.slice(1) || "postgres",
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
};

function int32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function cstring(s) {
  return Buffer.from(`${s}\0`);
}

function message(type, body = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
}

function startup(params) {
  const parts = [int32(196608)];
  for (const [key, value] of Object.entries(params)) {
    parts.push(cstring(key), cstring(value));
  }
  parts.push(Buffer.from([0]));
  const body = Buffer.concat(parts);
  return Buffer.concat([int32(body.length + 4), body]);
}

function parseMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const type = String.fromCharCode(buffer[offset]);
    const len = buffer.readInt32BE(offset + 1);
    if (offset + 1 + len > buffer.length) break;
    messages.push({ type, body: buffer.subarray(offset + 5, offset + 1 + len) });
    offset += 1 + len;
  }
  return { messages, rest: buffer.subarray(offset) };
}

function readCStringList(buf, start = 0) {
  const out = [];
  let offset = start;
  while (offset < buf.length) {
    const end = buf.indexOf(0, offset);
    if (end < 0 || end === offset) break;
    out.push(buf.subarray(offset, end).toString());
    offset = end + 1;
  }
  return out;
}

function saslInitialResponse(user) {
  const nonce = crypto.randomBytes(18).toString("base64");
  const bare = `n=${user.replaceAll("=", "=3D").replaceAll(",", "=2C")},r=${nonce}`;
  return { nonce, bare, first: `n,,${bare}` };
}

function parseScramAttrs(input) {
  return Object.fromEntries(input.split(",").map((part) => [part[0], part.slice(2)]));
}

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

function hmac(key, text) {
  return crypto.createHmac("sha256", key).update(text).digest();
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest();
}

function scramFinal(password, clientFirstBare, serverFirst) {
  const attrs = parseScramAttrs(serverFirst);
  const salt = Buffer.from(attrs.s, "base64");
  const iterations = Number(attrs.i);
  const clientFinalWithoutProof = `c=biws,r=${attrs.r}`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
  const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = hmac(saltedPassword, "Client Key");
  const storedKey = sha256(clientKey);
  const clientSignature = hmac(storedKey, authMessage);
  const clientProof = xor(clientKey, clientSignature).toString("base64");
  const serverKey = hmac(saltedPassword, "Server Key");
  const serverSignature = hmac(serverKey, authMessage).toString("base64");
  return { final: `${clientFinalWithoutProof},p=${clientProof}`, serverSignature };
}

function parseError(body) {
  const fields = {};
  let offset = 0;
  while (offset < body.length && body[offset] !== 0) {
    const code = String.fromCharCode(body[offset]);
    const end = body.indexOf(0, offset + 1);
    fields[code] = body.subarray(offset + 1, end).toString();
    offset = end + 1;
  }
  return fields.M || JSON.stringify(fields);
}

function parseRowDescription(body) {
  const count = body.readInt16BE(0);
  const fields = [];
  let offset = 2;
  for (let i = 0; i < count; i += 1) {
    const nameEnd = body.indexOf(0, offset);
    const name = body.subarray(offset, nameEnd).toString();
    offset = nameEnd + 1 + 18;
    fields.push(name);
  }
  return fields;
}

function parseDataRow(body, fields) {
  const count = body.readInt16BE(0);
  let offset = 2;
  const row = {};
  for (let i = 0; i < count; i += 1) {
    const len = body.readInt32BE(offset);
    offset += 4;
    row[fields[i]] = len === -1 ? null : body.subarray(offset, offset + len).toString();
    if (len !== -1) offset += len;
  }
  return row;
}

async function connectAndQuery() {
  const rawSocket = net.connect({ host: config.host, port: config.port });

  await new Promise((resolve, reject) => {
    rawSocket.once("connect", resolve);
    rawSocket.once("error", reject);
  });

  const sslRequest = Buffer.alloc(8);
  sslRequest.writeInt32BE(8, 0);
  sslRequest.writeInt32BE(80877103, 4);
  rawSocket.write(sslRequest);

  const sslResponse = await new Promise((resolve, reject) => {
    rawSocket.once("data", resolve);
    rawSocket.once("error", reject);
  });

  if (sslResponse[0] !== 83) {
    throw new Error("Postgres server refused SSL.");
  }

  let socket = tls.connect({
    socket: rawSocket,
    servername: config.host,
    rejectUnauthorized: false,
  });

  let pending = Buffer.alloc(0);
  const queue = [];
  let notify;

  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const parsed = parseMessages(pending);
    pending = parsed.rest;
    queue.push(...parsed.messages);
    if (notify) {
      notify();
      notify = undefined;
    }
  });

  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  const next = async () => {
    while (queue.length === 0) await new Promise((resolve) => (notify = resolve));
    return queue.shift();
  };

  socket.write(startup({
    user: config.user,
    database: config.database,
    application_name: "codex_readonly_audit",
  }));

  let clientFirst;
  let expectedServerSignature;

  for (;;) {
    const msg = await next();
    if (msg.type === "R") {
      const code = msg.body.readInt32BE(0);
      if (code === 0) continue;
      if (code === 10) {
        const mechanisms = readCStringList(msg.body, 4);
        if (!mechanisms.includes("SCRAM-SHA-256")) throw new Error(`Unsupported auth: ${mechanisms.join(",")}`);
        clientFirst = saslInitialResponse(config.user);
        const initial = Buffer.from(clientFirst.first);
        socket.write(message("p", Buffer.concat([
          cstring("SCRAM-SHA-256"),
          int32(initial.length),
          initial,
        ])));
        continue;
      }
      if (code === 11) {
        const serverFirst = msg.body.subarray(4).toString();
        const proof = scramFinal(config.password, clientFirst.bare, serverFirst);
        expectedServerSignature = proof.serverSignature;
        socket.write(message("p", Buffer.from(proof.final)));
        continue;
      }
      if (code === 12) {
        const attrs = parseScramAttrs(msg.body.subarray(4).toString());
        if (attrs.v !== expectedServerSignature) throw new Error("SCRAM server signature mismatch.");
        continue;
      }
      throw new Error(`Unsupported auth code ${code}`);
    }
    if (msg.type === "E") throw new Error(parseError(msg.body));
    if (msg.type === "Z") break;
  }

  socket.write(message("Q", cstring(sql)));

  let fields = [];
  const rows = [];
  let command = "";
  for (;;) {
    const msg = await next();
    if (msg.type === "T") fields = parseRowDescription(msg.body);
    else if (msg.type === "D") rows.push(parseDataRow(msg.body, fields));
    else if (msg.type === "C") command = msg.body.subarray(0, -1).toString();
    else if (msg.type === "E") throw new Error(parseError(msg.body));
    else if (msg.type === "Z") break;
  }

  socket.end();
  return { command, rowCount: rows.length, rows };
}

connectAndQuery()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
