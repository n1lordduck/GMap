/**
 * VTF (Valve Texture Format) Parser
 * Extracts the largest mipmap as raw RGBA pixels.
 * Supports: RGBA8888, BGR888, BGRA8888, DXT1, DXT3, DXT5, UV88, I8, IA88
 */

const VTF_FORMATS = {
  0:  "RGBA8888",
  1:  "ABGR8888",
  2:  "RGB888",
  3:  "BGR888",
  4:  "RGB565",
  5:  "I8",
  6:  "IA88",
  7:  "P8",
  8:  "A8",
  9:  "RGB888_BLUESCREEN",
  10: "BGR888_BLUESCREEN",
  11: "ARGB8888",
  12: "BGRA8888",
  13: "DXT1",
  14: "DXT3",
  15: "DXT5",
  16: "BGRX8888",
  17: "BGR565",
  18: "BGRX5551",
  19: "BGRA4444",
  20: "DXT1_ONEBITALPHA",
  21: "BGRA5551",
  22: "UV88",
  23: "UVWQ8888",
  24: "RGBA16161616F",
  25: "RGBA16161616",
  26: "UVLX8888",
};

function mipSize(w, h, fmt) {
  switch (fmt) {
    case 13: case 20: return Math.max(1, Math.floor((w+3)/4)) * Math.max(1, Math.floor((h+3)/4)) * 8;
    case 14: case 15: return Math.max(1, Math.floor((w+3)/4)) * Math.max(1, Math.floor((h+3)/4)) * 16;
    case 0: case 11: case 12: case 16: return w * h * 4;
    case 1: return w * h * 4;
    case 2: case 3: case 9: case 10: return w * h * 3;
    case 4: case 17: case 18: case 19: case 21: return w * h * 2;
    case 5: case 8: return w * h * 1;
    case 6: case 22: return w * h * 2;
    case 23: case 26: return w * h * 4;
    case 24: return w * h * 8;
    case 25: return w * h * 8;
    default: return w * h * 4;
  }
}

// DXT1 block decoder
function decodeDXT1Block(src, off, dst, dstOff, dstStride, hasAlpha) {
  const c0 = src[off] | (src[off+1] << 8);
  const c1 = src[off+2] | (src[off+3] << 8);
  const bits = src[off+4] | (src[off+5]<<8) | (src[off+6]<<16) | (src[off+7]*16777216);

  const r0 = ((c0>>11)&0x1f)*255/31|0, g0 = ((c0>>5)&0x3f)*255/63|0, b0 = (c0&0x1f)*255/31|0;
  const r1 = ((c1>>11)&0x1f)*255/31|0, g1 = ((c1>>5)&0x3f)*255/63|0, b1 = (c1&0x1f)*255/31|0;

  const palette = [
    [r0,g0,b0,255],
    [r1,g1,b1,255],
    c0>c1 ? [(2*r0+r1)/3|0,(2*g0+g1)/3|0,(2*b0+b1)/3|0,255] : [(r0+r1)/2|0,(g0+g1)/2|0,(b0+b1)/2|0,255],
    c0>c1 ? [(r0+2*r1)/3|0,(g0+2*g1)/3|0,(b0+2*b1)/3|0,255] : [0,0,0,hasAlpha?0:255],
  ];

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const idx = (bits >> ((row*4+col)*2)) & 3;
      const p = palette[idx];
      const o = dstOff + row*dstStride + col*4;
      dst[o]=p[0]; dst[o+1]=p[1]; dst[o+2]=p[2]; dst[o+3]=p[3];
    }
  }
}

function decodeDXT5Alpha(src, off, dst, dstOff, dstStride) {
  const a0 = src[off], a1 = src[off+1];
  const abits = src[off+2]|(src[off+3]<<8)|(src[off+4]<<16)|(src[off+5]*16777216);
  const abits2 = src[off+6]|(src[off+7]<<8);

  const atbl = [a0, a1];
  if (a0 > a1) {
    atbl.push((6*a0+1*a1)/7|0,(5*a0+2*a1)/7|0,(4*a0+3*a1)/7|0,(3*a0+4*a1)/7|0,(2*a0+5*a1)/7|0,(1*a0+6*a1)/7|0);
  } else {
    atbl.push((4*a0+1*a1)/5|0,(3*a0+2*a1)/5|0,(2*a0+3*a1)/5|0,(1*a0+4*a1)/5|0,0,255);
  }

  for (let i = 0; i < 16; i++) {
    const bitPos = i * 3;
    const word = bitPos < 24 ? abits : abits2;
    const shift = bitPos < 24 ? bitPos : (bitPos - 24);
    const ai = (word >> shift) & 7;
    const row = (i/4)|0, col = i%4;
    dst[dstOff + row*dstStride + col*4 + 3] = atbl[ai];
  }
}

function decodeBlock(fmt, src, srcOff, dst, dstOff, dstStride) {
  if (fmt === 13 || fmt === 20) {
    decodeDXT1Block(src, srcOff, dst, dstOff, dstStride, fmt===20);
  } else if (fmt === 14) {
    for (let i = 0; i < 16; i++) {
      const byte = src[srcOff + (i>>1)];
      const a = ((i&1) ? (byte>>4) : (byte&0xf)) * 17;
      const row=(i/4)|0, col=i%4;
      dst[dstOff+row*dstStride+col*4+3] = a;
    }
    decodeDXT1Block(src, srcOff+8, dst, dstOff, dstStride, false);
  } else if (fmt === 15) {
    decodeDXT5Alpha(src, srcOff, dst, dstOff, dstStride);
    decodeDXT1Block(src, srcOff+8, dst, dstOff, dstStride, false);
  }
}

// Half-float (16-bit) to 0-255 uint8
function halfToUint8(h) {
  const exp = (h >> 10) & 0x1f;
  const man = h & 0x3ff;
  let val;
  if (exp === 0)       val = man / 1024 * Math.pow(2, -14);
  else if (exp === 31) val = man ? 0 : 1;
  else                 val = (1 + man / 1024) * Math.pow(2, exp - 15);
  return Math.min(255, Math.max(0, val * 255)) | 0;
}

export function parseVTF(buf) {
  const b = buf instanceof Buffer ? buf : Buffer.from(buf);

  const sig = b.slice(0,4).toString('ascii');
  if (sig !== 'VTF\0') throw new Error('Not a VTF file');

  const major = b.readUInt32LE(4);
  const minor = b.readUInt32LE(8);
  const headerSize = b.readUInt32LE(12);
  const width  = b.readUInt16LE(16);
  const height = b.readUInt16LE(18);
  const flags  = b.readUInt32LE(20);
  const frames = b.readUInt16LE(24);
  const fmt    = b.readUInt32LE(48);
  const mips   = b.readUInt8(52);
  const lrFmt  = b.readUInt8(53);
  const lrW    = b.readUInt8(54);
  const lrH    = b.readUInt8(55);

  const lrSize = mipSize(lrW, lrH, lrFmt);

  let offset = headerSize + lrSize;

  const mipSizes = [];
  for (let m = mips - 1; m >= 0; m--) {
    const mw = Math.max(1, width >> m);
    const mh = Math.max(1, height >> m);
    mipSizes.push(mipSize(mw, mh, fmt));
  }
  for (let i = 0; i < mipSizes.length - 1; i++) offset += mipSizes[i];

  const fmtName = VTF_FORMATS[fmt] || `unknown(${fmt})`;
  const w = width, h = height;
  const rgba = Buffer.alloc(w * h * 4);

  if (fmt === 13 || fmt === 14 || fmt === 15 || fmt === 20)
    {
    const bw = Math.max(1, (w+3)>>2);
    const bh = Math.max(1, (h+3)>>2);
    const blockSize = (fmt === 13 || fmt === 20) ? 8 : 16;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const srcOff = offset + (by*bw+bx)*blockSize;
        const dstOff = (by*4*w + bx*4)*4;
        decodeBlock(fmt, b, srcOff, rgba, dstOff, w*4);
      }
    }
  } else if (fmt === 0) { // RGBA8888
    b.copy(rgba, 0, offset, offset + w*h*4);
  } else if (fmt === 12) { // BGRA8888
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+0] = b[offset+i*4+2];
      rgba[i*4+1] = b[offset+i*4+1];
      rgba[i*4+2] = b[offset+i*4+0];
      rgba[i*4+3] = b[offset+i*4+3];
    }
  } else if (fmt === 3) { // BGR888
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+0] = b[offset+i*4+2];
      rgba[i*4+1] = b[offset+i*4+1];
      rgba[i*4+2] = b[offset+i*4+0];
      rgba[i*4+3] = 255;
    }
  } else if (fmt === 2) { // RGB888
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+0] = b[offset+i*3+0];
      rgba[i*4+1] = b[offset+i*3+1];
      rgba[i*4+2] = b[offset+i*3+2];
      rgba[i*4+3] = 255;
    }
  } else if (fmt === 5) { // I8 grayscale
    for (let i = 0; i < w*h; i++) {
      const v = b[offset+i];
      rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=v; rgba[i*4+3]=255;
    }
  } else if (fmt === 6) { // IA88
    for (let i = 0; i < w*h; i++) {
      const v = b[offset+i*2]; const a = b[offset+i*2+1];
      rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=v; rgba[i*4+3]=a;
    }
  } else if (fmt === 8) { // A8
    for (let i = 0; i < w*h; i++) {
      rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=0; rgba[i*4+3]=b[offset+i];
    }
  } else if (fmt === 1) { // ABGR8888
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+3] = b[offset+i*4+0];
      rgba[i*4+2] = b[offset+i*4+1];
      rgba[i*4+1] = b[offset+i*4+2];
      rgba[i*4+0] = b[offset+i*4+3];
    }
  } else if (fmt === 11) { // ARGB8888
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+3] = b[offset+i*4+0];
      rgba[i*4+0] = b[offset+i*4+1];
      rgba[i*4+1] = b[offset+i*4+2];
      rgba[i*4+2] = b[offset+i*4+3];
    }
  } else if (fmt === 16) { // BGRX8888 (X = ignored)
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+0] = b[offset+i*4+2];
      rgba[i*4+1] = b[offset+i*4+1];
      rgba[i*4+2] = b[offset+i*4+0];
      rgba[i*4+3] = 255;
    }
  } else if (fmt === 4 || fmt === 17) { // RGB565 / BGR565
    for (let i = 0; i < w*h; i++) {
      const px = b[offset+i*2] | (b[offset+i*2+1] << 8);
      if (fmt === 4) { // RGB565
        rgba[i*4+0] = ((px >> 11) & 0x1f) * 255 / 31 | 0;
        rgba[i*4+1] = ((px >>  5) & 0x3f) * 255 / 63 | 0;
        rgba[i*4+2] =  (px        & 0x1f) * 255 / 31 | 0;
      } else { // BGR565
        rgba[i*4+2] = ((px >> 11) & 0x1f) * 255 / 31 | 0;
        rgba[i*4+1] = ((px >>  5) & 0x3f) * 255 / 63 | 0;
        rgba[i*4+0] =  (px        & 0x1f) * 255 / 31 | 0;
      }
      rgba[i*4+3] = 255;
    }
  } else if (fmt === 19) { // BGRA4444
    for (let i = 0; i < w*h; i++) {
      const px = b[offset+i*2] | (b[offset+i*2+1] << 8);
      rgba[i*4+2] = ((px >> 12) & 0xf) * 17;
      rgba[i*4+1] = ((px >>  8) & 0xf) * 17;
      rgba[i*4+0] = ((px >>  4) & 0xf) * 17;
      rgba[i*4+3] =  (px        & 0xf) * 17;
    }
  } else if (fmt === 18 || fmt === 21) { // BGRX5551 / BGRA5551
    for (let i = 0; i < w*h; i++) {
      const px = b[offset+i*2] | (b[offset+i*2+1] << 8);
      rgba[i*4+2] = ((px >> 11) & 0x1f) * 255 / 31 | 0;
      rgba[i*4+1] = ((px >>  6) & 0x1f) * 255 / 31 | 0;
      rgba[i*4+0] = ((px >>  1) & 0x1f) * 255 / 31 | 0;
      rgba[i*4+3] = fmt === 21 ? ((px & 1) ? 255 : 0) : 255;
    }
  } else if (fmt === 22) { // UV88 — encode as RG, B=0
    for (let i = 0; i < w*h; i++) {
      rgba[i*4+0] = b[offset+i*2+0];
      rgba[i*4+1] = b[offset+i*2+1];
      rgba[i*4+2] = 0; rgba[i*4+3] = 255;
    }
  } else if (fmt === 24 || fmt === 25) { // RGBA16161616F / RGBA16161616
    for (let i = 0; i < w*h; i++) {
      if (fmt === 24) { // half float
        rgba[i*4+0] = halfToUint8(b.readUInt16LE(offset+i*8+0));
        rgba[i*4+1] = halfToUint8(b.readUInt16LE(offset+i*8+2));
        rgba[i*4+2] = halfToUint8(b.readUInt16LE(offset+i*8+4));
        rgba[i*4+3] = halfToUint8(b.readUInt16LE(offset+i*8+6));
      } else { // uint16
        rgba[i*4+0] = b.readUInt16LE(offset+i*8+0) >> 8;
        rgba[i*4+1] = b.readUInt16LE(offset+i*8+2) >> 8;
        rgba[i*4+2] = b.readUInt16LE(offset+i*8+4) >> 8;
        rgba[i*4+3] = b.readUInt16LE(offset+i*8+6) >> 8;
      }
    }
  } else {
    // Unknown format 
    console.warn(`[VTF] unsupported format ${fmt} (${fmtName}) for ${w}x${h} texture`);
    for (let i = 0; i < w*h; i++) {
      rgba[i*4]=255; rgba[i*4+1]=0; rgba[i*4+2]=255; rgba[i*4+3]=255;
    }
  }

  return { width: w, height: h, rgba, format: fmtName };
}
