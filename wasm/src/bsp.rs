use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

const LUMP_PLANES:      usize = 1;
const LUMP_TEXDATA:     usize = 2;
const LUMP_VERTICES:    usize = 3;
const LUMP_TEXINFO:     usize = 6;
const LUMP_FACES:       usize = 7;
const LUMP_EDGES:       usize = 12;
const LUMP_SURFEDGES:   usize = 13;
const LUMP_DISPINFO:    usize = 26;
const LUMP_DISPVERTS:   usize = 33;
const LUMP_TEXDATA_STR: usize = 43;
const LUMP_TEXDATA_IDX: usize = 44;

const SURF_NODRAW:  u32 = 0x0080;
const SURF_SKY:     u32 = 0x0004;
const SURF_SKY2D:   u32 = 0x0002;
const SURF_TRIGGER: u32 = 0x0040;
const SURF_HINT:    u32 = 0x0008;
const SURF_SKIP:    u32 = 0x0200;
const SKIP_FLAGS:   u32 = SURF_NODRAW | SURF_SKY | SURF_SKY2D | SURF_TRIGGER | SURF_HINT | SURF_SKIP;

#[derive(Clone, Copy)]
struct Lump {
    offset: usize,
    length: usize,
}

#[derive(Clone)]
struct Texinfo {
    s_axis:   [f32; 3],
    s_offset: f32,
    t_axis:   [f32; 3],
    t_offset: f32,
    flags:    u32,
    texdata:  i32,
}

#[derive(Clone)]
struct Face {
    planenum:  u16,
    side:      u8,
    firstedge: i32,
    numedges:  i16,
    texinfo:   i16,
    dispinfo:  i16,
}

#[derive(Clone)]
struct Dispinfo {
    start_pos:       [f32; 3],
    disp_vert_start: i32,
    power:           i32,
    map_face:        u16,
}

#[derive(Clone)]
struct DispVert {
    vec:  [f32; 3],
    dist: f32,
}

#[derive(Default, Serialize, Deserialize)]
struct MeshBucket {
    vertices: Vec<f32>,
    normals:  Vec<f32>,
    uvs:      Vec<f32>,
    indices:  Vec<u32>,
}

#[derive(Serialize, Deserialize)]
pub struct Mesh {
    pub texture:  String,
    pub vertices: Vec<f32>,
    pub normals:  Vec<f32>,
    pub uvs:      Vec<f32>,
    pub indices:  Vec<u32>,
}

#[derive(Serialize, Deserialize)]
pub struct Bounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

#[derive(Serialize, Deserialize)]
pub struct Geometry {
    pub meshes:      Vec<Mesh>,
    pub bounds:      Bounds,
    pub coord_system: String,
}

#[wasm_bindgen]
pub struct BspParser {
    data: Vec<u8>,
}

#[wasm_bindgen]
impl BspParser {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> BspParser {
        BspParser { data }
    }

    pub fn extract_geometry(&self) -> Result<JsValue, JsValue> {
        let geo = self.parse().map_err(|e| JsValue::from_str(&e))?;
        serde_wasm_bindgen::to_value(&geo).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

impl BspParser {
    fn r_i32(&self, o: usize) -> i32 { i32::from_le_bytes(self.data[o..o+4].try_into().unwrap()) }
    fn r_i16(&self, o: usize) -> i16 { i16::from_le_bytes(self.data[o..o+2].try_into().unwrap()) }
    fn r_u16(&self, o: usize) -> u16 { u16::from_le_bytes(self.data[o..o+2].try_into().unwrap()) }
    fn r_f32(&self, o: usize) -> f32 { f32::from_le_bytes(self.data[o..o+4].try_into().unwrap()) }

    fn read_lumps(&self) -> Result<Vec<Lump>, String> {
        let magic = self.r_i32(0);
        if magic != 0x50534256 {
            return Err("Not a valid Source BSP".into());
        }
        let mut lumps = Vec::with_capacity(64);
        for i in 0..64usize {
            let b = 8 + i * 16;
            lumps.push(Lump {
                offset: self.r_i32(b) as usize,
                length: self.r_i32(b + 4) as usize,
            });
        }
        Ok(lumps)
    }

    fn read_vertices(&self, l: Lump) -> Vec<[f32; 3]> {
        let count = l.length / 12;
        (0..count).map(|i| {
            let o = l.offset + i * 12;
            [self.r_f32(o), self.r_f32(o + 4), self.r_f32(o + 8)]
        }).collect()
    }

    fn read_edges(&self, l: Lump) -> Vec<[u16; 2]> {
        let count = l.length / 4;
        (0..count).map(|i| {
            let o = l.offset + i * 4;
            [self.r_u16(o), self.r_u16(o + 2)]
        }).collect()
    }

    fn read_surfedges(&self, l: Lump) -> Vec<i32> {
        let count = l.length / 4;
        (0..count).map(|i| self.r_i32(l.offset + i * 4)).collect()
    }

    fn read_planes(&self, l: Lump) -> Vec<[f32; 4]> {
        let count = l.length / 20;
        (0..count).map(|i| {
            let o = l.offset + i * 20;
            [self.r_f32(o), self.r_f32(o + 4), self.r_f32(o + 8), self.r_f32(o + 12)]
        }).collect()
    }

    fn read_texinfo(&self, l: Lump) -> Vec<Texinfo> {
        let count = l.length / 72;
        (0..count).map(|i| {
            let o = l.offset + i * 72;
            Texinfo {
                s_axis:   [self.r_f32(o), self.r_f32(o + 4), self.r_f32(o + 8)],
                s_offset: self.r_f32(o + 12),
                t_axis:   [self.r_f32(o + 16), self.r_f32(o + 20), self.r_f32(o + 24)],
                t_offset: self.r_f32(o + 28),
                flags:    self.r_i32(o + 64) as u32,
                texdata:  self.r_i32(o + 68),
            }
        }).collect()
    }

    fn read_texdata(&self, l: Lump) -> Vec<i32> {
        let count = l.length / 32;
        (0..count).map(|i| self.r_i32(l.offset + i * 32 + 12)).collect()
    }

    fn read_texdata_strings(&self, str_lump: Lump, idx_lump: Lump) -> Vec<String> {
        let count = idx_lump.length / 4;
        (0..count).map(|i| {
            let idx = self.r_i32(idx_lump.offset + i * 4) as usize;
            let start = str_lump.offset + idx;
            let end_limit = str_lump.offset + str_lump.length;
            let mut end = start;
            while end < end_limit && self.data[end] != 0 { end += 1; }
            String::from_utf8_lossy(&self.data[start..end]).to_lowercase()
        }).collect()
    }

    fn read_faces(&self, l: Lump) -> Vec<Face> {
        let count = l.length / 56;
        (0..count).map(|i| {
            let o = l.offset + i * 56;
            Face {
                planenum:  self.r_u16(o),
                side:      self.data[o + 2],
                firstedge: self.r_i32(o + 4),
                numedges:  self.r_i16(o + 8),
                texinfo:   self.r_i16(o + 10),
                dispinfo:  self.r_i16(o + 12),
            }
        }).collect()
    }

    fn read_dispinfos(&self, l: Lump) -> Vec<Dispinfo> {
        let count = l.length / 176;
        (0..count).map(|i| {
            let o = l.offset + i * 176;
            Dispinfo {
                start_pos:       [self.r_f32(o), self.r_f32(o + 4), self.r_f32(o + 8)],
                disp_vert_start: self.r_i32(o + 12),
                power:           self.r_i32(o + 20),
                map_face:        self.r_u16(o + 36),
            }
        }).collect()
    }

    fn read_disp_verts(&self, l: Lump) -> Vec<DispVert> {
        let count = l.length / 20;
        (0..count).map(|i| {
            let o = l.offset + i * 20;
            DispVert {
                vec:  [self.r_f32(o), self.r_f32(o + 4), self.r_f32(o + 8)],
                dist: self.r_f32(o + 12),
            }
        }).collect()
    }

    fn compute_uv(pos: [f32; 3], ti: &Texinfo) -> [f32; 2] {
        let u = (pos[0]*ti.s_axis[0] + pos[1]*ti.s_axis[1] + pos[2]*ti.s_axis[2] + ti.s_offset) / 512.0;
        let v = (pos[0]*ti.t_axis[0] + pos[1]*ti.t_axis[1] + pos[2]*ti.t_axis[2] + ti.t_offset) / 512.0;
        [u, v]
    }

    fn parse(&self) -> Result<Geometry, String> {
        let lumps     = self.read_lumps()?;
        let raw_verts = self.read_vertices(lumps[LUMP_VERTICES]);
        let edges     = self.read_edges(lumps[LUMP_EDGES]);
        let surfedges = self.read_surfedges(lumps[LUMP_SURFEDGES]);
        let planes    = self.read_planes(lumps[LUMP_PLANES]);
        let texinfos  = self.read_texinfo(lumps[LUMP_TEXINFO]);
        let texdatas  = self.read_texdata(lumps[LUMP_TEXDATA]);
        let tex_names = self.read_texdata_strings(lumps[LUMP_TEXDATA_STR], lumps[LUMP_TEXDATA_IDX]);
        let faces     = self.read_faces(lumps[LUMP_FACES]);

        let has_disp   = lumps[LUMP_DISPINFO].length > 0;
        let dispinfos  = if has_disp { self.read_dispinfos(lumps[LUMP_DISPINFO]) } else { vec![] };
        let disp_verts = if has_disp && lumps[LUMP_DISPVERTS].length > 0 {
            self.read_disp_verts(lumps[LUMP_DISPVERTS])
        } else { vec![] };

        let get_tex_name = |ti_idx: i16| -> String {
            if ti_idx < 0 { return "__default".into(); }
            let ti = match texinfos.get(ti_idx as usize) { Some(t) => t, None => return "__default".into() };
            if ti.texdata < 0 { return "__default".into(); }
            let name_idx = match texdatas.get(ti.texdata as usize) { Some(n) => *n, None => return "__default".into() };
            if name_idx < 0 { return "__default".into(); }
            tex_names.get(name_idx as usize).cloned().unwrap_or_else(|| "__default".into())
        };

        let mut buckets: std::collections::HashMap<String, MeshBucket> = std::collections::HashMap::new();
        let mut bounds = Bounds {
            min: [f32::INFINITY; 3],
            max: [f32::NEG_INFINITY; 3],
        };

        let mut update_bounds = |v: [f32; 3]| {
            for (a, &val) in v.iter().enumerate() {
                if val < bounds.min[a] { bounds.min[a] = val; }
                if val > bounds.max[a] { bounds.max[a] = val; }
            }
        };

        let add_face_to_mesh = |
            bkt: &mut MeshBucket,
            face_verts: &[[f32; 3]],
            normal: [f32; 3],
            ti: Option<&Texinfo>,
        | {
            let base = (bkt.vertices.len() / 3) as u32;
            for &v in face_verts {
                bkt.vertices.extend_from_slice(&[v[0]/52.5, v[2]/52.5, -v[1]/52.5]);
                bkt.normals.extend_from_slice(&[normal[0], normal[2], -normal[1]]);
                let uv = ti.map(|t| Self::compute_uv(v, t)).unwrap_or([0.0, 0.0]);
                bkt.uvs.extend_from_slice(&uv);
            }
            for i in 1..(face_verts.len() as u32 - 1) {
                bkt.indices.extend_from_slice(&[base, base + i, base + i + 1]);
            }
        };

        for face in &faces {
            let ti = if face.texinfo >= 0 { texinfos.get(face.texinfo as usize) } else { None };
            if let Some(t) = ti {
                if t.flags & SKIP_FLAGS != 0 { continue; }
            }
            if face.dispinfo != -1 { continue; }

            let plane  = planes.get(face.planenum as usize);
            let flip   = if face.side != 0 { -1.0_f32 } else { 1.0 };
            let normal = plane.map(|p| [p[0]*flip, p[1]*flip, p[2]*flip]).unwrap_or([0.0, 0.0, 0.0]);

            let mut face_verts: Vec<[f32; 3]> = Vec::with_capacity(face.numedges as usize);
            for i in 0..face.numedges as usize {
                let se = surfedges[face.firstedge as usize + i];
                let vi = if se >= 0 { edges[se.unsigned_abs() as usize][0] } else { edges[se.unsigned_abs() as usize][1] } as usize;
                let v = raw_verts[vi];
                update_bounds(v);
                face_verts.push(v);
            }
            if face_verts.len() < 3 { continue; }

            let tex = get_tex_name(face.texinfo);
            let bkt = buckets.entry(tex).or_default();
            add_face_to_mesh(bkt, &face_verts, normal, ti);
        }

        for disp in &dispinfos {
            let face = match faces.get(disp.map_face as usize) { Some(f) => f, None => continue };
            let ti   = if face.texinfo >= 0 { texinfos.get(face.texinfo as usize) } else { None };
            if let Some(t) = ti {
                if t.flags & SKIP_FLAGS != 0 { continue; }
            }

            let mut corners: Vec<[f32; 3]> = Vec::with_capacity(4);
            for i in 0..face.numedges as usize {
                let se = surfedges[face.firstedge as usize + i];
                let vi = if se >= 0 { edges[se.unsigned_abs() as usize][0] } else { edges[se.unsigned_abs() as usize][1] } as usize;
                corners.push(raw_verts[vi]);
            }
            if corners.len() != 4 { continue; }

            let size = (1 << disp.power) + 1;

            let mut start_idx = 0usize;
            let mut min_dist = f32::INFINITY;
            for (i, corner) in corners.iter().enumerate() {
                let dx = corner[0] - disp.start_pos[0];
                let dy = corner[1] - disp.start_pos[1];
                let dz = corner[2] - disp.start_pos[2];
                let d  = dx*dx + dy*dy + dz*dz;
                if d < min_dist { min_dist = d; start_idx = i; }
            }

            let c = [
                corners[start_idx],
                corners[(start_idx + 1) % 4],
                corners[(start_idx + 2) % 4],
                corners[(start_idx + 3) % 4],
            ];

            let lerp = |a: [f32;3], b: [f32;3], t: f32| -> [f32;3] {
                [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]
            };

            let mut grid: Vec<Vec<[f32; 3]>> = Vec::with_capacity(size);
            for row in 0..size {
                let t     = row as f32 / (size - 1) as f32;
                let edge_a = lerp(c[0], c[1], t);
                let edge_b = lerp(c[3], c[2], t);
                let mut row_arr: Vec<[f32; 3]> = Vec::with_capacity(size);
                for col in 0..size {
                    let s    = col as f32 / (size - 1) as f32;
                    let base = lerp(edge_a, edge_b, s);
                    let dv   = &disp_verts[disp.disp_vert_start as usize + row * size + col];
                    let pos  = [
                        base[0] + dv.vec[0] * dv.dist,
                        base[1] + dv.vec[1] * dv.dist,
                        base[2] + dv.vec[2] * dv.dist,
                    ];
                    update_bounds(pos);
                    row_arr.push(pos);
                }
                grid.push(row_arr);
            }

            let face_normal = |a: [f32;3], b: [f32;3], cc: [f32;3]| -> [f32;3] {
                let u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
                let v = [cc[0]-a[0], cc[1]-a[1], cc[2]-a[2]];
                let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
                let len = (n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt().max(1e-9);
                [n[0]/len, n[1]/len, n[2]/len]
            };

            let tex = get_tex_name(face.texinfo);
            let bkt = buckets.entry(tex).or_default();

            for row in 0..size - 1 {
                for col in 0..size - 1 {
                    let v00 = grid[row][col];
                    let v10 = grid[row+1][col];
                    let v01 = grid[row][col+1];
                    let v11 = grid[row+1][col+1];
                    let norm = face_normal(v00, v10, v11);
                    let base = (bkt.vertices.len() / 3) as u32;
                    for &v in &[v00, v10, v01, v11] {
                        bkt.vertices.extend_from_slice(&[v[0]/52.5, v[2]/52.5, -v[1]/52.5]);
                        bkt.normals.extend_from_slice(&[norm[0], norm[2], -norm[1]]);
                        let uv = ti.map(|t| Self::compute_uv(v, t)).unwrap_or([0.0, 0.0]);
                        bkt.uvs.extend_from_slice(&uv);
                    }
                    bkt.indices.extend_from_slice(&[base, base+1, base+2, base+1, base+3, base+2]);
                }
            }
        }

        let meshes: Vec<Mesh> = buckets.into_iter()
            .filter(|(_, b)| !b.indices.is_empty())
            .map(|(tex, b)| Mesh {
                texture:  tex,
                vertices: b.vertices,
                normals:  b.normals,
                uvs:      b.uvs,
                indices:  b.indices,
            })
            .collect();

        Ok(Geometry { meshes, bounds, coord_system: "threejs".into() })
    }
}