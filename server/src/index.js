import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import morgan from "morgan";
import { createServer } from "http";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { StateManager } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC   = join(__dirname, "../public");
const MAPS_DIR = join(__dirname, "../../maps");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });
const state      = new StateManager();

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
  const mapname = req.params.mapname.replace(/[^a-z0-9_\-]/gi, "");
  const bspPath = join(MAPS_DIR, `${mapname}.bsp`);

  if (!existsSync(bspPath))
    return res.status(404).json({ error: `${mapname}.bsp not found` });

  const data = readFileSync(bspPath);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(data);
});

app.get("/api/status", (_req, res) => {
  res.json({ map: state.currentMap, players: state.players.length, uptime: process.uptime() });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\ngmap @ http://localhost:${PORT}`);
  console.log(`maps/ -> ${MAPS_DIR}\n`);
});
