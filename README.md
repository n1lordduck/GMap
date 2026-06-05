# GMap

3d map viewer for Garry's Mod dedicated servers.

Navigate the map in your browser with WASD + mouse - players appear as 3D markers updated in real time.
This is just a silly project mine, more stuff coming soon!
## Architecture

```
GMod Dedicated Server
  [sv_main.lua] ── HTTP POST /api/update (10 Hz) ──►

Node.js Bridge Server (Express + WS)
  • /api/geometry/:map  ← reads .bsp from disk
  • /api/update (POST)  ← receives from GMod
  • WebSocket broadcast ──► browsers

Browser (Three.js)
  • BSP geometry mesh
  • Freecam navigation
  • Player 3D markers
```

## Setup

### 1. Node.js Server

Requirements: **Node.js 18+**

```bash
cd server/
npm install
export GMOD_ROOT="/path/to/GarrysMod/garrysmod"
node src/index.js
```

`GMOD_ROOT` must point to your full GMod **client** install's `garrysmod/` folder (not the DS). Used to load textures from VPK archives.

Copy your map's `.bsp` to `maps/`.

### 2. GMod Addon

Copy `addon/` to `garrysmod/addons/gmap/` on your server.

Edit `sv_main.lua` and set your Node.js server address:

```lua
local BRIDGE_URL = "http://127.0.0.1:3000/api/update"
```

### 3. Open the viewer

`http://localhost:3000`

| Key | Action |
|-----|--------|
| Click | Lock cursor |
| WASD | Move |
| Mouse | Look |
| Q / E | Down / Up |
| Shift | Fast |
| Esc | Release cursor |

## Coordinate System

Source Engine uses Z-up, Three.js uses Y-up:

```
THREE.x =  source.x / 52.5
THREE.y =  source.z / 52.5
THREE.z = -source.y / 52.5
```
