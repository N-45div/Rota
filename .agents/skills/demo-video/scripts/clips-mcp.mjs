// Minimal MCP client for the Clips server (streamable HTTP), no dependencies.
//   node clips-mcp.mjs tools                 list tool names + descriptions
//   node clips-mcp.mjs describe <tool>        print one tool's full description
//   node clips-mcp.mjs schema <tool>          print one tool's input schema
//   node clips-mcp.mjs call <tool> '<json>'   call a tool, print its result
// Auth: CLIPS_TOKEN (Bearer), or a token the network proxy injects.
// Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node >= 22.21).

const URL_ = "https://clips.agent-native.com/mcp";
// guard:allow-env-credential — a CLI run from the developer's shell with their own token; the app never loads this file.
const token = process.env.CLIPS_TOKEN;
let sessionId = null;
let nextId = 1;

async function rpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
  if (!notify) body.id = nextId++;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(body) });
  sessionId = res.headers.get("mcp-session-id") || sessionId;
  if (notify) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 400)}`);
  const type = res.headers.get("content-type") || "";
  let messages = [];
  if (type.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        try { messages.push(JSON.parse(line.slice(5).trim())); } catch {}
      }
    }
  } else {
    messages = [JSON.parse(text)];
  }
  const reply = messages.find((m) => m.id === body.id) ?? messages.at(-1);
  if (reply?.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
  return reply?.result;
}

async function connect() {
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agent-native-demo-video", version: "1.0.0" },
  });
  await rpc("notifications/initialized", undefined, { notify: true });
}

async function listTools() {
  const tools = [];
  let cursor;
  do {
    const page = await rpc("tools/list", cursor ? { cursor } : {});
    tools.push(...(page?.tools ?? []));
    cursor = page?.nextCursor;
  } while (cursor);
  return tools;
}

const [cmd, name, json] = process.argv.slice(2);
await connect();
if (cmd === "describe") {
  const tool = (await listTools()).find((t) => t.name === name);
  console.log(tool ? tool.description : `No tool named ${name}`);
} else if (cmd === "tools") {
  for (const t of await listTools()) console.log(`${t.name}\t${(t.description || "").replace(/\s+/g, " ").slice(0, 160)}`);
} else if (cmd === "schema") {
  const tool = (await listTools()).find((t) => t.name === name);
  console.log(tool ? JSON.stringify(tool.inputSchema, null, 2) : `No tool named ${name}`);
} else if (cmd === "call") {
  const result = await rpc("tools/call", { name, arguments: json ? JSON.parse(json) : {} });
  for (const part of result?.content ?? []) console.log(part.type === "text" ? part.text : JSON.stringify(part));
  if (result?.structuredContent) console.log(JSON.stringify(result.structuredContent, null, 2));
  if (result?.isError) process.exitCode = 1;
} else {
  console.log("usage: clips-mcp.mjs tools | schema <tool> | call <tool> '<json>'");
}
