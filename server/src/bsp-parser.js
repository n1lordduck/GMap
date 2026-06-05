/**
 * Source Engine BSP Parser v2
 * - Extracts regular faces WITH texture names (via TEXDATA/TEXINFO)
 * - Extracts displacement surfaces (terrain) as triangle meshes
 * - Returns geometry grouped by texture for multi-material rendering
 */

import { readFileSync } from "fs";

const LUMP_PLANES       = 1;
const LUMP_TEXDATA      = 2;
const LUMP_VERTICES     = 3;
const LUMP_TEXINFO      = 6;
const LUMP_FACES        = 7;
const LUMP_EDGES        = 12;
const LUMP_SURFEDGES    = 13;
const LUMP_DISPINFO     = 26;
const LUMP_TEXDATA_STR  = 43;
const LUMP_TEXDATA_IDX  = 44;

const SURF_NODRAW  = 0x0080;
const SURF_SKY     = 0x0004;
const SURF_SKY2D   = 0x0002;
const SURF_TRIGGER = 0x0040;
const SURF_HINT    = 0x0008;
const SURF_SKIP    = 0x0200;
const SKIP_FLAGS   = SURF_NODRAW | SURF_SKY | SURF_SKY2D | SURF_TRIGGER | SURF_HINT | SURF_SKIP;

export class BspParser {
  constructor(filePath) {
    this.buf  = readFileSync(filePath);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }

  i8(o)  { return this.view.getInt8(o); }
  i16(o) { return this.view.getInt16(o, true); }
  u16(o) { return this.view.getUint16(o, true); }
  i32(o) { return this.view.getInt32(o, true); }
  u32(o) { return this.view.getUint32(o, true); }
  f32(o) { return this.view.getFloat32(o, true); }

  readHeader() {
    if (this.i32(0) !== 0x50534256) throw new Error("Not a valid Source BSP");
    const lumps = [];
    for (let i = 0; i < 64; i++) {
      const b = 8 + i * 16;
      lumps.push({ offset: this.i32(b), length: this.i32(b+4) });
    }
    return lumps;
  }

  readVertices(l) {
    const count = l.length / 12, v = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*12;
      v.push([this.f32(o), this.f32(o+4), this.f32(o+8)]);
    }
    return v;
  }

  readEdges(l) {
    const count = l.length / 4, e = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*4;
      e.push([this.u16(o), this.u16(o+2)]);
    }
    return e;
  }

  readSurfedges(l) {
    const count = l.length / 4, s = [];
    for (let i = 0; i < count; i++) s.push(this.i32(l.offset + i*4));
    return s;
  }

  readPlanes(l) {
    const count = l.length / 20, p = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*20;
      p.push({ normal: [this.f32(o), this.f32(o+4), this.f32(o+8)], dist: this.f32(o+12) });
    }
    return p;
  }

  readTexinfo(l) {
    // 72 bytes each: s[4], t[4], flags(4), texdata(4)
    const count = l.length / 72, t = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*72;
      t.push({
        sAxis:   [this.f32(o),    this.f32(o+4),  this.f32(o+8)],
        sOffset: this.f32(o+12),
        tAxis:   [this.f32(o+16), this.f32(o+20), this.f32(o+24)],
        tOffset: this.f32(o+28),
        flags:   this.i32(o+64),
        texdata: this.i32(o+68),
      });
    }
    return t;
  }

  readTexdata(l) {
    // 32 bytes each: reflectivity(12), nameStringTableID(4), width(4), height(4), ...
    const count = l.length / 32, t = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*32;
      t.push({
        nameIdx: this.i32(o+12),
        width:   this.i32(o+16),
        height:  this.i32(o+20),
      });
    }
    return t;
  }

  readTexdataStrings(strLump, idxLump) {
    const count = idxLump.length / 4;
    const strings = [];
    for (let i = 0; i < count; i++) {
      const off = strLump.offset + this.i32(idxLump.offset + i*4);
      let end = off;
      while (end < strLump.offset + strLump.length && this.buf[end] !== 0) end++;
      strings.push(this.buf.slice(off, end).toString("ascii").toLowerCase());
    }
    return strings;
  }

  readFaces(l) {
    const FACE_SIZE = 56, count = l.length / FACE_SIZE, faces = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*FACE_SIZE;
      faces.push({
        planenum:  this.u16(o),
        side:      this.buf[o+2],
        firstedge: this.i32(o+4),
        numedges:  this.i16(o+8),
        texinfo:   this.i16(o+10),
        dispinfo:  this.i16(o+12),
      });
    }
    return faces;
  }

  readDispinfos(l) {
    // dispinfo_t = 176 bytes
    const DISP_SIZE = 176, count = l.length / DISP_SIZE, disps = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i * DISP_SIZE;
      disps.push({
        startPos:   [this.f32(o), this.f32(o+4), this.f32(o+8)],
        dispVertStart: this.i32(o+12),
        dispTriStart:  this.i32(o+16),
        power:      this.i32(o+20),        // 2,3,4 → 5,9,17 verts per side
        minTess:    this.i32(o+24),
        smoothAngle:this.f32(o+28),
        contents:   this.i32(o+32),
        mapFace:    this.u16(o+36),
        lightmapAlphaStart: this.i32(o+38),
        lightmapSampleStart: this.i32(o+42),
        // allowed verts: 10 * 4 bytes at o+46 (skip for now)
      });
    }
    return disps;
  }

  readDispVerts(l) {
    // dDispVert = 20 bytes: vec(12), dist(4), alpha(4)
    const count = l.length / 20, v = [];
    for (let i = 0; i < count; i++) {
      const o = l.offset + i*20;
      v.push({
        vec:  [this.f32(o), this.f32(o+4), this.f32(o+8)],
        dist: this.f32(o+12),
        alpha: this.f32(o+16),
      });
    }
    return v;
  }

  async extractGeometry() {
    const lumps = this.readHeader();

    const rawVerts  = this.readVertices(lumps[LUMP_VERTICES]);
    const edges     = this.readEdges(lumps[LUMP_EDGES]);
    const surfedges = this.readSurfedges(lumps[LUMP_SURFEDGES]);
    const planes    = this.readPlanes(lumps[LUMP_PLANES]);
    const texinfos  = this.readTexinfo(lumps[LUMP_TEXINFO]);
    const texdatas  = this.readTexdata(lumps[LUMP_TEXDATA]);
    const texNames  = this.readTexdataStrings(lumps[LUMP_TEXDATA_STR], lumps[LUMP_TEXDATA_IDX]);
    const faces     = this.readFaces(lumps[LUMP_FACES]);

    // Displacement data
    const hasDisp = lumps[LUMP_DISPINFO].length > 0;
    const dispinfos  = hasDisp ? this.readDispinfos(lumps[LUMP_DISPINFO]) : [];

    // dispverts lump is #33
    const LUMP_DISPVERTS = 33;
    const dispVerts = hasDisp && lumps[LUMP_DISPVERTS].length > 0
      ? this.readDispVerts(lumps[LUMP_DISPVERTS]) : [];

    const buckets = new Map();

    function getBucket(name) {
      if (!buckets.has(name)) {
        buckets.set(name, { vertices: [], normals: [], uvs: [], indices: [] });
      }
      return buckets.get(name);
    }

    function getTexName(ti) {
      if (!ti || ti.texdata < 0 || ti.texdata >= texdatas.length) return "__default";
      const td = texdatas[ti.texdata];
      if (td.nameIdx < 0 || td.nameIdx >= texNames.length) return "__default";
      return texNames[td.nameIdx];
    }

    function computeUV(pos, ti) {
      if (!ti) return [0, 0];
      const u = (pos[0]*ti.sAxis[0] + pos[1]*ti.sAxis[1] + pos[2]*ti.sAxis[2] + ti.sOffset) / 512;
      const v = (pos[0]*ti.tAxis[0] + pos[1]*ti.tAxis[1] + pos[2]*ti.tAxis[2] + ti.tOffset) / 512;
      return [u, v];
    }

    function addFaceToMesh(faceVerts, normal, ti) {
      const texName = getTexName(ti);
      const bkt = getBucket(texName);
      const base = bkt.vertices.length / 3;
      for (const v of faceVerts) {
        bkt.vertices.push(v[0]/52.5, v[2]/52.5, -v[1]/52.5);
        bkt.normals.push(normal[0], normal[2], -normal[1]);
        const uv = computeUV(v, ti);
        bkt.uvs.push(uv[0], uv[1]);
      }
      for (let i = 1; i < faceVerts.length - 1; i++) {
        bkt.indices.push(base, base+i, base+i+1);
      }
    }

    const bounds = { min:[Infinity,Infinity,Infinity], max:[-Infinity,-Infinity,-Infinity] };

    for (const face of faces) {
      const ti = texinfos[face.texinfo];
      if (ti && (ti.flags & SKIP_FLAGS)) continue;
      if (face.dispinfo !== -1) continue; // handled separately

      const plane = planes[face.planenum];
      const flip  = face.side ? -1 : 1;
      const nx = plane ? plane.normal[0]*flip : 0;
      const ny = plane ? plane.normal[1]*flip : 0;
      const nz = plane ? plane.normal[2]*flip : 0;

      const faceVerts = [];
      for (let i = 0; i < face.numedges; i++) {
        const se = surfedges[face.firstedge + i];
        const vi = se >= 0 ? edges[Math.abs(se)][0] : edges[Math.abs(se)][1];
        const v  = rawVerts[vi];
        faceVerts.push(v);
        for (let a = 0; a < 3; a++) {
          bounds.min[a] = Math.min(bounds.min[a], v[a]);
          bounds.max[a] = Math.max(bounds.max[a], v[a]);
        }
      }
      if (faceVerts.length < 3) continue;
      addFaceToMesh(faceVerts, [nx,ny,nz], ti);
    }

    for (const disp of dispinfos) {
      const face = faces[disp.mapFace];
      if (!face) continue;
      const ti = face.texinfo >= 0 ? texinfos[face.texinfo] : null;
      if (ti && (ti.flags & SKIP_FLAGS)) continue;

      const corners = [];
      for (let i = 0; i < face.numedges; i++) {
        const se = surfedges[face.firstedge + i];
        const vi = se >= 0 ? edges[Math.abs(se)][0] : edges[Math.abs(se)][1];
        corners.push(rawVerts[vi]);
      }
      if (corners.length !== 4) continue;

      const size  = (1 << disp.power) + 1; // 5, 9, or 17
      const total = size * size;

      let startIdx = 0, minDist = Infinity;
      for (let i = 0; i < 4; i++) {
        const dx = corners[i][0] - disp.startPos[0];
        const dy = corners[i][1] - disp.startPos[1];
        const dz = corners[i][2] - disp.startPos[2];
        const d  = dx*dx + dy*dy + dz*dz;
        if (d < minDist) { minDist = d; startIdx = i; }
      }

      const c = [
        corners[startIdx],
        corners[(startIdx+1)%4],
        corners[(startIdx+2)%4],
        corners[(startIdx+3)%4],
      ];

      const texName = getTexName(ti);
      const bkt = getBucket(texName);

      const grid = [];
      for (let row = 0; row < size; row++) {
        const rowArr = [];
        const t = row / (size - 1);
        const edgeA = lerpV(c[0], c[1], t);  // left edge
        const edgeB = lerpV(c[3], c[2], t);  // right edge
        for (let col = 0; col < size; col++) {
          const s = col / (size - 1);
          const base = lerpV(edgeA, edgeB, s);
          const dv   = dispVerts[disp.dispVertStart + row * size + col];
          const pos  = [
            base[0] + dv.vec[0] * dv.dist,
            base[1] + dv.vec[1] * dv.dist,
            base[2] + dv.vec[2] * dv.dist,
          ];
          rowArr.push(pos);
          for (let a = 0; a < 3; a++) {
            bounds.min[a] = Math.min(bounds.min[a], pos[a]);
            bounds.max[a] = Math.max(bounds.max[a], pos[a]);
          }
        }
        grid.push(rowArr);
      }

      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const v00 = grid[row][col];
          const v10 = grid[row+1][col];
          const v01 = grid[row][col+1];
          const v11 = grid[row+1][col+1];

          // Compute normal from cross product
          const norm = faceNormal(v00, v10, v11);

          const base = bkt.vertices.length / 3;
          for (const v of [v00, v10, v01, v11]) {
            bkt.vertices.push(v[0]/52.5, v[2]/52.5, -v[1]/52.5);
            bkt.normals.push(norm[0], norm[2], -norm[1]);
            const uv = computeUV(v, ti);
            bkt.uvs.push(uv[0], uv[1]);
          }
          // Two triangles: 0,1,2 and 1,3,2
          bkt.indices.push(base, base+1, base+2, base+1, base+3, base+2);
        }
      }
    }

    const meshes = [];

    for (const [texName, bkt] of buckets) {
      if (bkt.indices.length === 0) continue;
      meshes.push({
        texture:  texName,
        vertices: bkt.vertices,
        normals:  bkt.normals,
        uvs:      bkt.uvs,
        indices:  bkt.indices,
      });
    }

    console.log(`[BSP] ${meshes.length} texture groups, ${meshes.reduce((s,m)=>s+m.indices.length/3,0)|0} triangles`);
    return { meshes, bounds, coordSystem: "threejs" };
  }
}

function lerpV(a, b, t) {
  return [
    a[0] + (b[0]-a[0])*t,
    a[1] + (b[1]-a[1])*t,
    a[2] + (b[2]-a[2])*t,
  ];
}

function faceNormal(a, b, c) {
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n = [
    u[1]*v[2] - u[2]*v[1],
    u[2]*v[0] - u[0]*v[2],
    u[0]*v[1] - u[1]*v[0],
  ];
  const len = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
  return [n[0]/len, n[1]/len, n[2]/len];
}
