use wasm_bindgen::prelude::*;
use serde::Serialize;

#[derive(Serialize)]
pub struct VtfResult {
    pub width:  u32,
    pub height: u32,
    pub rgba:   Vec<u8>,
    pub format: String,
}

const VTF_FORMATS: &[(u32, &str)] = &[
    (0,  "RGBA8888"),   (1,  "ABGR8888"),  (2,  "RGB888"),
    (3,  "BGR888"),     (4,  "RGB565"),     (5,  "I8"),
    (6,  "IA88"),       (7,  "P8"),         (8,  "A8"),
    (9,  "RGB888_BLUESCREEN"), (10, "BGR888_BLUESCREEN"),
    (11, "ARGB8888"),   (12, "BGRA8888"),   (13, "DXT1"),
    (14, "DXT3"),       (15, "DXT5"),       (16, "BGRX8888"),
    (17, "BGR565"),     (18, "BGRX5551"),   (19, "BGRA4444"),
    (20, "DXT1_ONEBITALPHA"), (21, "BGRA5551"), (22, "UV88"),
    (23, "UVWQ8888"),   (24, "RGBA16161616F"), (25, "RGBA16161616"),
    (26, "UVLX8888"),
];

fn fmt_name(fmt: u32) -> String {
    VTF_FORMATS.iter().find(|(f, _)| *f == fmt)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| format!("unknown({})", fmt))
}

fn mip_size(w: u32, h: u32, fmt: u32) -> usize {
    match fmt {
        13 | 20 => (((w+3)/4).max(1) * ((h+3)/4).max(1) * 8) as usize,
        14 | 15 => (((w+3)/4).max(1) * ((h+3)/4).max(1) * 16) as usize,
        0|1|11|12|16|23|26 => (w*h*4) as usize,
        2|3|9|10 => (w*h*3) as usize,
        4|6|17|18|19|21|22 => (w*h*2) as usize,
        5|8 => (w*h) as usize,
        24|25 => (w*h*8) as usize,
        _ => (w*h*4) as usize,
    }
}

fn decode_dxt1_block(src: &[u8], off: usize, dst: &mut [u8], dst_off: usize, stride: usize, has_alpha: bool) {
    let c0 = src[off] as u16 | ((src[off+1] as u16) << 8);
    let c1 = src[off+2] as u16 | ((src[off+3] as u16) << 8);
    let bits = src[off+4] as u32 | ((src[off+5] as u32)<<8) | ((src[off+6] as u32)<<16) | (src[off+7] as u32*16777216);

    let r0 = (((c0>>11)&0x1f) as u32 * 255 / 31) as u8;
    let g0 = (((c0>>5)&0x3f)  as u32 * 255 / 63) as u8;
    let b0 = ((c0&0x1f)       as u32 * 255 / 31) as u8;
    let r1 = (((c1>>11)&0x1f) as u32 * 255 / 31) as u8;
    let g1 = (((c1>>5)&0x3f)  as u32 * 255 / 63) as u8;
    let b1 = ((c1&0x1f)       as u32 * 255 / 31) as u8;

    let palette: [[u8;4]; 4] = if c0 > c1 { [
        [r0,g0,b0,255],
        [r1,g1,b1,255],
        [((2*r0 as u16+r1 as u16)/3) as u8, ((2*g0 as u16+g1 as u16)/3) as u8, ((2*b0 as u16+b1 as u16)/3) as u8, 255],
        [((r0 as u16+2*r1 as u16)/3) as u8, ((g0 as u16+2*g1 as u16)/3) as u8, ((b0 as u16+2*b1 as u16)/3) as u8, 255],
    ]} else { [
        [r0,g0,b0,255],
        [r1,g1,b1,255],
        [((r0 as u16+r1 as u16)/2) as u8, ((g0 as u16+g1 as u16)/2) as u8, ((b0 as u16+b1 as u16)/2) as u8, 255],
        [0,0,0, if has_alpha { 0 } else { 255 }],
    ]};

    for row in 0..4usize {
        for col in 0..4usize {
            let idx = ((bits >> ((row*4+col)*2)) & 3) as usize;
            let p = palette[idx];
            let o = dst_off + row*stride + col*4;
            dst[o]=p[0]; dst[o+1]=p[1]; dst[o+2]=p[2]; dst[o+3]=p[3];
        }
    }
}

fn decode_dxt5_alpha(src: &[u8], off: usize, dst: &mut [u8], dst_off: usize, stride: usize) {
    let a0 = src[off] as u32;
    let a1 = src[off+1] as u32;
    let abits  = src[off+2] as u32 | ((src[off+3] as u32)<<8) | ((src[off+4] as u32)<<16) | (src[off+5] as u32*16777216);
    let abits2 = src[off+6] as u32 | ((src[off+7] as u32)<<8);

    let mut atbl = [0u32; 8];
    atbl[0] = a0; atbl[1] = a1;
    if a0 > a1 {
        atbl[2] = (6*a0+1*a1)/7; atbl[3] = (5*a0+2*a1)/7;
        atbl[4] = (4*a0+3*a1)/7; atbl[5] = (3*a0+4*a1)/7;
        atbl[6] = (2*a0+5*a1)/7; atbl[7] = (1*a0+6*a1)/7;
    } else {
        atbl[2] = (4*a0+1*a1)/5; atbl[3] = (3*a0+2*a1)/5;
        atbl[4] = (2*a0+3*a1)/5; atbl[5] = (1*a0+4*a1)/5;
        atbl[6] = 0; atbl[7] = 255;
    }

    for i in 0..16usize {
        let bit_pos = i * 3;
        let word  = if bit_pos < 24 { abits } else { abits2 };
        let shift = if bit_pos < 24 { bit_pos } else { bit_pos - 24 };
        let ai = ((word >> shift) & 7) as usize;
        let row = i / 4; let col = i % 4;
        dst[dst_off + row*stride + col*4 + 3] = atbl[ai] as u8;
    }
}

fn half_to_u8(h: u16) -> u8 {
    let exp = (h >> 10) & 0x1f;
    let man = (h & 0x3ff) as f32;
    let val: f32 = if exp == 0 { man / 1024.0 * 2f32.powi(-14) }
                   else if exp == 31 { if man == 0.0 { 1.0 } else { 0.0 } }
                   else { (1.0 + man/1024.0) * 2f32.powi(exp as i32 - 15) };
    (val * 255.0).clamp(0.0, 255.0) as u8
}

#[wasm_bindgen]
pub fn parse_vtf(data: &[u8]) -> Result<JsValue, JsValue> {
    parse_vtf_inner(data)
        .map(|r| serde_wasm_bindgen::to_value(&r).unwrap())
        .map_err(|e| JsValue::from_str(&e))
}

fn parse_vtf_inner(b: &[u8]) -> Result<VtfResult, String> {
    if b.len() < 80 { return Err("VTF too small".into()); }
    if &b[0..4] != b"VTF\0" { return Err("Not a VTF file".into()); }

    let header_size = u32::from_le_bytes(b[12..16].try_into().unwrap()) as usize;
    let width  = u16::from_le_bytes(b[16..18].try_into().unwrap()) as u32;
    let height = u16::from_le_bytes(b[18..20].try_into().unwrap()) as u32;
    let fmt    = u32::from_le_bytes(b[48..52].try_into().unwrap());
    let mips   = b[52] as u32;
    let lr_fmt = b[53] as u32;
    let lr_w   = b[54] as u32;
    let lr_h   = b[55] as u32;

    let lr_size = mip_size(lr_w, lr_h, lr_fmt);
    let mut offset = header_size + lr_size;

    let mut mip_sizes: Vec<usize> = Vec::with_capacity(mips as usize);
    for m in (0..mips).rev() {
        let mw = (width  >> m).max(1);
        let mh = (height >> m).max(1);
        mip_sizes.push(mip_size(mw, mh, fmt));
    }
    for s in &mip_sizes[..mip_sizes.len().saturating_sub(1)] { offset += s; }

    let w = width as usize;
    let h = height as usize;
    let mut rgba = vec![0u8; w * h * 4];

    match fmt {
        13 | 14 | 15 | 20 => {
            let bw = ((w + 3) / 4).max(1);
            let bh = ((h + 3) / 4).max(1);
            let block_size = if fmt == 13 || fmt == 20 { 8 } else { 16 };
            for by in 0..bh {
                for bx in 0..bw {
                    let src_off = offset + (by*bw+bx)*block_size;
                    let dst_off = (by*4*w + bx*4)*4;
                    if fmt == 13 || fmt == 20 {
                        decode_dxt1_block(b, src_off, &mut rgba, dst_off, w*4, fmt==20);
                    } else if fmt == 14 {
                        for i in 0..16usize {
                            let byte = b[src_off + (i>>1)];
                            let a = if i&1 != 0 { (byte>>4)*17 } else { (byte&0xf)*17 };
                            let row=i/4; let col=i%4;
                            rgba[dst_off+row*w*4+col*4+3] = a;
                        }
                        decode_dxt1_block(b, src_off+8, &mut rgba, dst_off, w*4, false);
                    } else {
                        decode_dxt5_alpha(b, src_off, &mut rgba, dst_off, w*4);
                        decode_dxt1_block(b, src_off+8, &mut rgba, dst_off, w*4, false);
                    }
                }
            }
        }
        0 => rgba.copy_from_slice(&b[offset..offset+w*h*4]),
        12 => for i in 0..w*h { let o=offset+i*4; rgba[i*4]=b[o+2]; rgba[i*4+1]=b[o+1]; rgba[i*4+2]=b[o]; rgba[i*4+3]=b[o+3]; },
        3  => for i in 0..w*h { let o=offset+i*3; rgba[i*4]=b[o+2]; rgba[i*4+1]=b[o+1]; rgba[i*4+2]=b[o]; rgba[i*4+3]=255; },
        2  => for i in 0..w*h { let o=offset+i*3; rgba[i*4]=b[o]; rgba[i*4+1]=b[o+1]; rgba[i*4+2]=b[o+2]; rgba[i*4+3]=255; },
        5  => for i in 0..w*h { let v=b[offset+i]; rgba[i*4]=v; rgba[i*4+1]=v; rgba[i*4+2]=v; rgba[i*4+3]=255; },
        6  => for i in 0..w*h { let v=b[offset+i*2]; rgba[i*4]=v; rgba[i*4+1]=v; rgba[i*4+2]=v; rgba[i*4+3]=b[offset+i*2+1]; },
        8  => for i in 0..w*h { rgba[i*4+3]=b[offset+i]; },
        1  => for i in 0..w*h { let o=offset+i*4; rgba[i*4+3]=b[o]; rgba[i*4+2]=b[o+1]; rgba[i*4+1]=b[o+2]; rgba[i*4]=b[o+3]; },
        11 => for i in 0..w*h { let o=offset+i*4; rgba[i*4+3]=b[o]; rgba[i*4]=b[o+1]; rgba[i*4+1]=b[o+2]; rgba[i*4+2]=b[o+3]; },
        16 => for i in 0..w*h { let o=offset+i*4; rgba[i*4]=b[o+2]; rgba[i*4+1]=b[o+1]; rgba[i*4+2]=b[o]; rgba[i*4+3]=255; },
        4|17 => for i in 0..w*h {
            let px = b[offset+i*2] as u16 | ((b[offset+i*2+1] as u16)<<8);
            if fmt == 4 {
                rgba[i*4]   = (((px>>11)&0x1f) as u32*255/31) as u8;
                rgba[i*4+1] = (((px>>5)&0x3f)  as u32*255/63) as u8;
                rgba[i*4+2] = ((px&0x1f)        as u32*255/31) as u8;
            } else {
                rgba[i*4+2] = (((px>>11)&0x1f) as u32*255/31) as u8;
                rgba[i*4+1] = (((px>>5)&0x3f)  as u32*255/63) as u8;
                rgba[i*4]   = ((px&0x1f)        as u32*255/31) as u8;
            }
            rgba[i*4+3]=255;
        },
        19 => for i in 0..w*h {
            let px = b[offset+i*2] as u16 | ((b[offset+i*2+1] as u16)<<8);
            rgba[i*4+2]=(((px>>12)&0xf)*17) as u8; rgba[i*4+1]=(((px>>8)&0xf)*17) as u8;
            rgba[i*4]  =(((px>>4)&0xf)*17)  as u8; rgba[i*4+3]=((px&0xf)*17)       as u8;
        },
        18|21 => for i in 0..w*h {
            let px = b[offset+i*2] as u16 | ((b[offset+i*2+1] as u16)<<8);
            rgba[i*4+2]=(((px>>11)&0x1f) as u32*255/31) as u8;
            rgba[i*4+1]=(((px>>6)&0x1f)  as u32*255/31) as u8;
            rgba[i*4]  =(((px>>1)&0x1f)  as u32*255/31) as u8;
            rgba[i*4+3]=if fmt==21 { if px&1!=0{255}else{0} } else {255};
        },
        22 => for i in 0..w*h { rgba[i*4]=b[offset+i*2]; rgba[i*4+1]=b[offset+i*2+1]; rgba[i*4+3]=255; },
        24 => for i in 0..w*h {
            let o = offset+i*8;
            rgba[i*4]   = half_to_u8(u16::from_le_bytes([b[o],b[o+1]]));
            rgba[i*4+1] = half_to_u8(u16::from_le_bytes([b[o+2],b[o+3]]));
            rgba[i*4+2] = half_to_u8(u16::from_le_bytes([b[o+4],b[o+5]]));
            rgba[i*4+3] = half_to_u8(u16::from_le_bytes([b[o+6],b[o+7]]));
        },
        25 => for i in 0..w*h {
            let o=offset+i*8;
            rgba[i*4]   = (u16::from_le_bytes([b[o],b[o+1]])>>8) as u8;
            rgba[i*4+1] = (u16::from_le_bytes([b[o+2],b[o+3]])>>8) as u8;
            rgba[i*4+2] = (u16::from_le_bytes([b[o+4],b[o+5]])>>8) as u8;
            rgba[i*4+3] = (u16::from_le_bytes([b[o+6],b[o+7]])>>8) as u8;
        },
        _ => for i in 0..w*h { rgba[i*4]=255; rgba[i*4+2]=255; rgba[i*4+3]=255; },
    }

    Ok(VtfResult { width: w as u32, height: h as u32, rgba, format: fmt_name(fmt) })
}

#[wasm_bindgen]
pub fn vtf_to_png(data: &[u8]) -> Result<Vec<u8>, JsValue> {
    let r = parse_vtf_inner(data).map_err(|e| JsValue::from_str(&e))?;
    encode_png(r.width, r.height, &r.rgba).map_err(|e| JsValue::from_str(&e))
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let w = width as usize;
    let h = height as usize;
    let row_size = 1 + w * 4;
    let mut raw = vec![0u8; h * row_size];
    for y in 0..h {
        raw[y * row_size] = 0;
        raw[y * row_size + 1..y * row_size + 1 + w * 4]
            .copy_from_slice(&rgba[y * w * 4..(y + 1) * w * 4]);
    }

    let compressed = miniz_compress(&raw)?;

    let mut out = Vec::with_capacity(8 + 25 + compressed.len() + 20);
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 6;
    write_chunk(&mut out, b"IHDR", &ihdr);
    write_chunk(&mut out, b"IDAT", &compressed);
    write_chunk(&mut out, b"IEND", &[]);

    Ok(out)
}

fn write_chunk(out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    let crc = crc32(&[tag.as_slice(), data].concat());
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    const TABLE: [u32; 256] = {
        let mut t = [0u32; 256];
        let mut i = 0usize;
        while i < 256 {
            let mut c = i as u32;
            let mut j = 0;
            while j < 8 { c = if c & 1 != 0 { 0xEDB88320 ^ (c >> 1) } else { c >> 1 }; j += 1; }
            t[i] = c;
            i += 1;
        }
        t
    };
    let mut c = 0xFFFFFFFFu32;
    for &b in data { c = TABLE[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8); }
    c ^ 0xFFFFFFFF
}

fn miniz_compress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let adler  = adler32(data);

    out.push(0x78);
    out.push(0x9C);

    let mut i = 0;
    while i < data.len() {
        let chunk_len = (data.len() - i).min(65535);
        let is_last   = i + chunk_len >= data.len();
        out.push(if is_last { 1 } else { 0 });
        out.extend_from_slice(&(chunk_len as u16).to_le_bytes());
        out.extend_from_slice(&(!(chunk_len as u16)).to_le_bytes());
        out.extend_from_slice(&data[i..i + chunk_len]);
        i += chunk_len;
    }

    out.extend_from_slice(&adler.to_be_bytes());
    Ok(out)
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}