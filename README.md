# GMap

3d map viewer for Garry's Mod dedicated servers.

Navigate the map in your browser with WASD + mouse - players appear as 3D markers updated in real time.

This is just a silly project mine, more stuff coming soon! (like crossplaying)

This project has been heavily inspired by [BlueMap](https://bluemap.bluecolored.de/), shoutout to them!!

## Architecture

```
GMod Dedicated Server
  [sv_main.lua] ── HTTP POST /api/update (10 Hz) ──►

Node.js Bridge Server (Express + WS)
  • /api/bsp/:map       ← reads .bsp from disk
  • /api/update (POST)  ← receives from GMod
  • WebSocket broadcast ──► browsers

Browser (Three.js + WebAssembly)
  • BSP parsing via Rust/WASM (client-side)
  • Freecam navigation
  • Player 3D markers
```

## Setup

### 1. Build WASM

Requirements: **Rust + wasm-pack**

```bash
cd wasm/
wasm-pack build --target web --out-dir ../server/public/wasm
```

### 2. Node.js Server

Requirements: **Node.js 18+**

```bash
cd server/
npm install
node src/index.js
```

Copy your map's `.bsp` to `maps/`.

### 3. GMod Addon

Copy `addon/` to `garrysmod/addons/gmap/` on your server.

Edit `sv_main.lua` and set your Node.js server address:

```lua
local BRIDGE_URL = "http://127.0.0.1:3000/api/update"
```

### 4. Open the viewer

`http://localhost:3000`

| Key | Action |
|-----|--------|
| Click | Lock cursor |
| WASD | Move |
| Mouse | Look |
| Q / E | Down / Up |
| Shift | Fast |
| Esc | Release cursor |
