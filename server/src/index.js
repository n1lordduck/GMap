import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import morgan from "morgan";
import { createServer } from "http";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { StateManager } from "./state.js";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const PUBLIC       = join(__dirname, "../public");
const MAPS_DIR     = join(__dirname, "../../maps");
const MATERIALS    = join(__dirname, "../../materials");
const TEX_CACHE    = join(__dirname, "../../texture-cache");

mkdirSync(TEX_CACHE, { recursive: true });

const require  = createRequire(import.meta.url);
const wasmPkg  = require("../wasm-node/gmap_wasm.js");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });
const state      = new StateManager();

const missingTex = new Set();
const memCache   = new Map();

app.use(cors());
app.use(morgan("tiny"));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(PUBLIC));

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

wss.on("connection", ws => {
  console.log("[WS] browser connected");
  ws.send(JSON.stringify({ type: "full_state", payload: state.get() }));
  ws.on("close", () => console.log("[WS] browser disconnected"));
});

app.post("/api/update", (req, res) => {
  const { players, entities, map } = req.body;

  if (map && map !== state.currentMap) {
    console.log(`[MAP] ${map}`);
    state.currentMap = map;
    broadcast({ type: "map_change", map });
  }

  if (players)  { state.updatePlayers(players);  broadcast({ type: "players",  players:  state.players });  }
  if (entities) { state.updateEntities(entities); broadcast({ type: "entities", entities: state.entities }); }

  res.json({ ok: true });
});

app.get("/api/bsp/:mapname", (req, res) => {
  const mapname = req.params.mapname.replace(/[^a-z0-9_-]/gi, "");
  const bspPath = join(MAPS_DIR, `${mapname}.bsp`);

  if (!existsSync(bspPath))
    return res.status(404).json({ error: `${mapname}.bsp not found` });

  const data = readFileSync(bspPath);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(data);
});

app.get("/api/texture/*", (req, res) => {
  const texName = req.params[0];
  if (!texName) return res.status(400).end();

  const key       = texName.toLowerCase().replace(/\\/g, "/").replace(/^\//, "");
  if (missingTex.has(key)) return res.status(404).end();
  if (memCache.has(key))   { res.setHeader("Content-Type", "image/png"); return res.send(memCache.get(key)); }

  const vtfPath = resolveVtf(key);
  if (!vtfPath)  { missingTex.add(key); return res.status(404).end(); }

  try {
    const png = wasmPkg.vtf_to_png(readFileSync(vtfPath));
    memCache.set(key, Buffer.from(png));
    console.log(`[TEX] ${key}`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(png));
  } catch (e) {
    console.warn(`[TEX] fail ${key}: ${e.message}`);
    missingTex.add(key);
    res.status(500).end();
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ map: state.currentMap, players: state.players.length, uptime: process.uptime() });
});

function resolveVtf(key) {
  const vmtPath = join(MATERIALS, `${key}.vmt`);
  if (existsSync(vmtPath)) {
    const ref = parseVmt(vmtPath);
    if (ref) {
      const vtfPath = join(MATERIALS, `${ref}.vtf`);
      if (existsSync(vtfPath)) return vtfPath;
    }
  }
  const vtfPath = join(MATERIALS, `${key}.vtf`);
  return existsSync(vtfPath) ? vtfPath : null;
}

function parseVmt(vmtPath) {
  try {
    const m = readFileSync(vmtPath, "utf8").match(/\$basetexture\s+"?([^"\s\r\n]+)"?/i);
    return m ? m[1].replace(/\\/g, "/").toLowerCase() : null;
  } catch { return null; }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\ngmap @ http://localhost:${PORT}`);
  console.log(`maps/      -> ${MAPS_DIR}`);
  console.log(`materials/ -> ${MATERIALS}\n`);
});