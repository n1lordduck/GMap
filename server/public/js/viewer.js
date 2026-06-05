import * as THREE from "three";

const SCALE  = 52.5;
const WS_URL = `ws://${location.host}`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x111416);
document.getElementById("viewport").appendChild(renderer.domElement);

const scene  = new THREE.Scene();
scene.fog    = new THREE.Fog(0x111416, 300, 1800);
scene.background = new THREE.Color(0x111416);

const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 4000);
camera.position.set(0, 30, 0);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function texFallbackColor(name) {
  if (!name) return 0x8899aa;
  const n = name.toLowerCase();
  if (n.includes("grass") || n.includes("flatgrass")) return 0x5a8a4a;
  if (n.includes("concrete") || n.includes("floor"))  return 0x8a8a82;
  if (n.includes("brick"))   return 0x8a6050;
  if (n.includes("metal"))   return 0x707888;
  if (n.includes("plaster") || n.includes("wall")) return 0xb0a898;
  if (n.includes("wood"))    return 0x9a7a50;
  if (n.includes("water"))   return 0x4070b0;
  if (n.includes("glass"))   return 0x90b8d0;
  if (n.includes("sky"))     return 0x6090c0;
  return 0x8899aa;
}

const texLoader = new THREE.TextureLoader();
const texCache  = new Map();

function loadTex(name) {
  if (texCache.has(name)) return texCache.get(name);
  const tex = texLoader.load(
    `/api/texture/${name}`,
    t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; },
    undefined,
    () => {}
  );
  texCache.set(name, tex);
  return tex;
}

let mapGroup = null;

async function loadMap(mapname) {
  log(`loading ${mapname}...`);
  if (mapGroup) { scene.remove(mapGroup); mapGroup = null; }

  let data;
  try {
    const r = await fetch(`/api/geometry/${mapname}`);
    if (!r.ok) { log(`bsp not found: ${mapname}`); return; }
    data = await r.json();
  } catch (e) { log(`fetch error: ${e.message}`); return; }

  mapGroup = new THREE.Group();

  const meshes = data.meshes || [{
    texture: "__default",
    vertices: data.vertices,
    normals:  data.normals,
    uvs:      [],
    indices:  data.indices,
  }];

  for (const m of meshes) {
    if (!m.indices || m.indices.length === 0) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m.vertices), 3));
    geo.setAttribute("normal",   new THREE.BufferAttribute(new Float32Array(m.normals),  3));
    if (m.uvs?.length > 0)
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(m.uvs), 2));
    geo.setIndex(m.indices);

    const isDefault = !m.texture || m.texture === "__default";
    const mat = new THREE.MeshBasicMaterial({
      color: isDefault ? 0x8899aa : texFallbackColor(m.texture),
      map:   isDefault ? null : loadTex(m.texture),
      side:  THREE.DoubleSide,
    });

    mapGroup.add(new THREE.Mesh(geo, mat));
  }

  scene.add(mapGroup);

  if (data.bounds) {
    const b = data.bounds;
    let [minX, minY, minZ] = b.min;
    let [maxX, maxY, maxZ] = b.max;

    if (Math.abs(maxX - minX) > 500) {
      minX /= SCALE; maxX /= SCALE;
      minY /= SCALE; maxY /= SCALE;
      minZ /= SCALE; maxZ /= SCALE;
    }

    const cx   = (minX + maxX) / 2;
    const cy   = (minY + maxY) / 2;
    const cz   = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ);

    camera.position.set(cx, cy + span * 0.15 + 10, cz + span * 0.2);
    camera.lookAt(cx, cy, cz);
    const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    yaw = eu.y; pitch = eu.x;

    log(`bounds: ${(maxX-minX)|0} × ${(maxY-minY)|0} × ${(maxZ-minZ)|0} u`);
  }

  const tris = meshes.reduce((s, m) => s + (m.indices?.length || 0) / 3, 0) | 0;
  log(`${mapname}: ${tris.toLocaleString()} tris · ${meshes.length} mats`);
  document.getElementById("map-label").textContent = mapname;
}

const playerMeshes = new Map();

function srcPos(x, y, z) {
  return new THREE.Vector3(x / SCALE, z / SCALE, -y / SCALE);
}

function makeMarker(name) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8),
    new THREE.MeshLambertMaterial({ color: 0x2244cc })
  );
  body.position.y = 0.9;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x4466ff })
  );
  head.position.y = 2.1;
  g.add(head);

  const cv  = document.createElement("canvas");
  cv.width  = 256; cv.height = 48;
  const ctx = cv.getContext("2d");
  ctx.font      = "bold 20px monospace";
  ctx.fillStyle = "#223366";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.substring(0, 22), 128, 24);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), depthTest: false,
  }));
  sprite.position.y = 3.0;
  sprite.scale.set(3.5, 0.8, 1);
  g.add(sprite);

  return g;
}

function updatePlayers(players) {
  const seen = new Set();
  for (const p of players) {
    seen.add(p.steamid);
    if (!playerMeshes.has(p.steamid)) {
      const m = makeMarker(p.name);
      scene.add(m);
      playerMeshes.set(p.steamid, m);
    }
    const m = playerMeshes.get(p.steamid);
    m.position.copy(srcPos(p.pos[0], p.pos[1], p.pos[2]));
    if (p.ang) m.rotation.y = THREE.MathUtils.degToRad(-p.ang[1]);
  }
  for (const [id, m] of playerMeshes) {
    if (!seen.has(id)) { scene.remove(m); playerMeshes.delete(id); }
  }
}

function log(msg) {
  const el = document.getElementById("log");
  const d  = document.createElement("div");
  d.textContent = `> ${msg}`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
  if (el.children.length > 60) el.removeChild(el.children[0]);
}

let currentMap = null, ws = null;

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen  = () => { setStatus(true);  log("connected"); };
  ws.onclose = () => { setStatus(false); log("reconnecting..."); setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === "full_state") {
      const { map, players } = msg.payload;
      if (map && map !== currentMap) { currentMap = map; loadMap(map); }
      if (players?.length) updatePlayers(players);
    }
    if (msg.type === "players")    updatePlayers(msg.players);
    if (msg.type === "map_change") { currentMap = msg.map; loadMap(msg.map); }
  };
}

function setStatus(ok) {
  const el       = document.getElementById("status");
  el.textContent = ok ? "● live" : "○ disc";
  el.style.color  = ok ? "#2255cc" : "#cc3333";
}

async function fetchCurrentMap() {
  try {
    const r = await fetch("/api/status");
    const s = await r.json();
    if (s.map && s.map !== currentMap) { currentMap = s.map; loadMap(s.map); }
  } catch (e) {}
}

const keys = {};
let pitch = 0, yaw = 0, locked = false;

document.addEventListener("keydown", e => { keys[e.code] = true; });
document.addEventListener("keyup",   e => { keys[e.code] = false; });
renderer.domElement.addEventListener("click", () => renderer.domElement.requestPointerLock());
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener("mousemove", e => {
  if (!locked) return;
  yaw   -= e.movementX * 0.0018;
  pitch  = Math.max(-1.55, Math.min(1.55, pitch - e.movementY * 0.0018));
});

const qY = new THREE.Quaternion(), qX = new THREE.Quaternion();
const AY = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);

function tickCamera(dt) {
  qY.setFromAxisAngle(AY, yaw);
  qX.setFromAxisAngle(AX, pitch);
  camera.quaternion.copy(qY).multiply(qX);

  const spd = keys["ShiftLeft"] || keys["ShiftRight"] ? 100 : 25;
  const mv  = spd * dt;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const rgt = new THREE.Vector3(1, 0,  0).applyQuaternion(camera.quaternion);

  if (keys["KeyW"] || keys["ArrowUp"])    camera.position.addScaledVector(fwd,  mv);
  if (keys["KeyS"] || keys["ArrowDown"])  camera.position.addScaledVector(fwd, -mv);
  if (keys["KeyA"] || keys["ArrowLeft"])  camera.position.addScaledVector(rgt, -mv);
  if (keys["KeyD"] || keys["ArrowRight"]) camera.position.addScaledVector(rgt,  mv);
  if (keys["KeyE"]) camera.position.y += mv;
  if (keys["KeyQ"]) camera.position.y -= mv;
}

let last = performance.now();
(function animate() {
  requestAnimationFrame(animate);
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  tickCamera(dt);
  renderer.render(scene, camera);
})();

window.loadMap = loadMap;
connect();
fetchCurrentMap();
