/**
 * Texture Cache v3
 * Search order:
 *   1. BSP PAKFILE (extracted to pak-cache/<mapname>/)
 *   2. Loose files under $GMOD_ROOT/materials/
 *   3. VPK archives derived from $GMOD_ROOT
 *   4. Return null → frontend uses fallback colour
 *
 * Set GMOD_ROOT to your full GMod client's garrysmod/ folder, e.g.:
 *   export GMOD_ROOT="/home/user/.local/share/Steam/steamapps/common/GarrysMod/garrysmod"
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";
import { parseVTF } from "./vtf-parser.js";
import { extractPakfile } from "./pakfile.js";
import { VPKReader } from "./vpk-reader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// GMOD_ROOT should be the garrysmod/ folder inside the full GMod client.
// e.g. /home/pepe/.local/share/Steam/steamapps/common/GarrysMod/garrysmod
const GMOD_ROOT = process.env.GMOD_ROOT ||
  "/home/lordduck/.local/share/Steam/steamapps/common/GarrysMod/garrysmod";

// One level up from garrysmod/ is the game root (where hl2/, ep2/, etc. live)
const GAME_BASE = resolve(GMOD_ROOT, "..");

console.log(`[TEX] GMOD_ROOT = ${GMOD_ROOT}`);
console.log(`[TEX] GAME_BASE = ${GAME_BASE}`);

const PNG_CACHE_DIR = join(__dirname, "../../texture-cache");
const PAK_CACHE_DIR = join(__dirname, "../../pak-cache");
mkdirSync(PNG_CACHE_DIR, { recursive: true });
mkdirSync(PAK_CACHE_DIR, { recursive: true });

const MATERIAL_ROOTS = [join(GMOD_ROOT, "materials")];

// Paths confirmed from GarrysMod Linux layout:
//   GarrysMod/garrysmod/   ← GMOD_ROOT
//   GarrysMod/sourceengine/ ← HL2 base content (textures, misc, etc.)
//   GarrysMod/platform/
function vpkCandidates() {
  const g  = GMOD_ROOT;                 // .../GarrysMod/garrysmod/
  const b  = GAME_BASE;                 // .../GarrysMod/
  const se = join(b, "sourceengine");   // .../GarrysMod/sourceengine/
  const pl = join(b, "platform");       // .../GarrysMod/platform/

  return [
    // GMod's own content (overrides go first)
    join(g, "garrysmod_dir.vpk"),
    join(g, "fallbacks_dir.vpk"),
    join(se, "hl2_textures_dir.vpk"),
    join(se, "hl2_misc_dir.vpk"),
    join(se, "content_hl2_dir.vpk"),
    join(se, "content_cstrike_dir.vpk"),
    // Platform
    join(pl, "platform_misc_dir.vpk"),
  ];
}

const vpkReaders = [];

for (const p of vpkCandidates()) {
  if (existsSync(p)) {
    const r = new VPKReader(p);
    if (r.load()) vpkReaders.push(r);
  } else {
    // Uncomment to debug missing packs:
    // console.log(`[VPK] not found (skipping): ${p}`);
  }
}

if (vpkReaders.length === 0) {
  console.warn("[VPK] WARNING: no VPK packs mounted — textures will be missing.");
  console.warn(`[VPK] Check that GMOD_ROOT points to your full GMod client's garrysmod/ folder.`);
  console.warn(`[VPK] Current GMOD_ROOT: ${GMOD_ROOT}`);
} else {
  console.log(`[VPK] ${vpkReaders.length} pack(s) mounted`);
}

const pakContents = new Map();

export class TextureCache {
  constructor() {
    this.missing = new Set();
  }

  async warmPak(bspPath, mapname) {
    if (pakContents.has(mapname)) return;
    const outDir = join(PAK_CACHE_DIR, mapname);
    const files  = await extractPakfile(bspPath, outDir);
    pakContents.set(mapname, files);
  }

    //TODO RE-DO THIS
  findVtf(texName, mapname) {
    const stripped = texName.replace(/(_-?\d+){3}$/, "");
    const key = stripped.toLowerCase().replace(/\\/g, "/").replace(/^\//, "");

    if (mapname && pakContents.has(mapname)) {
      const pak = pakContents.get(mapname);
      if (pak[`materials/${key}.vtf`]) return { type: "file", path: pak[`materials/${key}.vtf`] };
      if (pak[`${key}.vtf`])           return { type: "file", path: pak[`${key}.vtf`] };
    }

    for (const root of MATERIAL_ROOTS) {
      const vmtPath = join(root, `${key}.vmt`);
      if (existsSync(vmtPath)) {
        const vtfName = parseVMTFile(vmtPath) || key;
        const vtfPath = join(root, `${vtfName}.vtf`);
        if (existsSync(vtfPath)) return { type: "file", path: vtfPath };
      }
      const vtfPath = join(root, `${key}.vtf`);
      if (existsSync(vtfPath)) return { type: "file", path: vtfPath };
    }

    const vtfVpkKey = `materials/${key}.vtf`;
    const vmtVpkKey = `materials/${key}.vmt`;

    for (const vpk of vpkReaders) {
      if (vpk.has(vmtVpkKey)) {
        const vmtBuf  = vpk.read(vmtVpkKey);
        const vtfName = parseVMTBuffer(vmtBuf);
        if (vtfName) {
          const realKey = `materials/${vtfName}.vtf`;
          for (const vpk2 of vpkReaders) {
            if (vpk2.has(realKey)) return { type: "vpk", vpk: vpk2, key: realKey };
          }
        }
      }
      if (vpk.has(vtfVpkKey)) return { type: "vpk", vpk, key: vtfVpkKey };
    }

    return null;
  }

  getPng(texName, mapname) {
    if (!texName) return null;
    const key = texName.toLowerCase().replace(/\\/g, "/").replace(/^\//, "");
    if (this.missing.has(key)) return null;

    const cacheFile = join(PNG_CACHE_DIR, key.replace(/\//g, "__") + ".png");
    if (existsSync(cacheFile)) return cacheFile;

    const found = this.findVtf(key, mapname);
    if (!found) {
      this.missing.add(key);
      return null;
    }

    try {
      const vtfBuf = found.type === "file"
        ? readFileSync(found.path)
        : found.vpk.read(found.key);

      if (!vtfBuf) throw new Error("read returned null");

      const { width, height, rgba } = parseVTF(vtfBuf);
      const png = encodePNG(width, height, rgba);
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, png);
      console.log(`[TEX] cached ${key} (${width}x${height}) [${found.type}]`);
      return cacheFile;
    } catch (e) {
      console.warn(`[TEX] fail ${key}: ${e.message}`);
      this.missing.add(key);
      return null;
    }
  }
}

function parseVMTFile(vmtPath) {
  try { return parseVMTBuffer(readFileSync(vmtPath)); } catch { return null; }
}

function parseVMTBuffer(buf) {
  try {
    const text = buf.toString("utf8");
    const m = text.match(/\$basetexture\s+"?([^"\s\r\n]+)"?/i);
    if (m) return m[1].replace(/\\/g, "/").toLowerCase();
  } catch {}
  return null;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb  = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, crc]);
}

function encodePNG(width, height, rgba) {
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    rgba.copy(raw, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
