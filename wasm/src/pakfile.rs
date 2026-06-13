use wasm_bindgen::prelude::*;
use js_sys::{Object, Reflect, Uint8Array};

const LUMP_PAKFILE: usize = 40;

#[wasm_bindgen]
pub fn extract_pakfile_js(bsp_data: &[u8]) -> Result<JsValue, JsValue> {
    let entries = extract_pakfile(bsp_data)
        .map_err(|e| JsValue::from_str(&e))?;

    let obj = Object::new();
    for (name, data) in entries {
        let arr = Uint8Array::from(data.as_slice());
        Reflect::set(&obj, &JsValue::from_str(&name), &arr.into())
            .map_err(|e| e)?;
    }
    Ok(obj.into())
}

pub fn extract_pakfile(bsp: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    if bsp.len() < 8 + (LUMP_PAKFILE+1)*16 {
        return Err("BSP too small for pakfile lump".into());
    }

    let lump_base  = 8 + LUMP_PAKFILE * 16;
    let offset     = i32::from_le_bytes(bsp[lump_base..lump_base+4].try_into().unwrap()) as usize;
    let length     = i32::from_le_bytes(bsp[lump_base+4..lump_base+8].try_into().unwrap()) as usize;

    if length == 0 { return Ok(vec![]); }
    if offset + length > bsp.len() { return Err("Pakfile lump out of bounds".into()); }

    let zip_data = &bsp[offset..offset+length];
    parse_zip(zip_data)
}

fn parse_zip(data: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut entries = Vec::new();
    let mut i = 0;

    while i + 30 <= data.len() {
        if data[i..i+4] != [0x50, 0x4b, 0x03, 0x04] {
            break;
        }

        let compression = u16::from_le_bytes(data[i+8..i+10].try_into().unwrap());
        let compressed_size   = u32::from_le_bytes(data[i+18..i+22].try_into().unwrap()) as usize;
        let uncompressed_size = u32::from_le_bytes(data[i+22..i+26].try_into().unwrap()) as usize;
        let fname_len  = u16::from_le_bytes(data[i+26..i+28].try_into().unwrap()) as usize;
        let extra_len  = u16::from_le_bytes(data[i+28..i+30].try_into().unwrap()) as usize;

        let fname_start = i + 30;
        let fname_end   = fname_start + fname_len;
        let data_start  = fname_end + extra_len;
        let data_end    = data_start + compressed_size;

        if data_end > data.len() { break; }

        let name = String::from_utf8_lossy(&data[fname_start..fname_end])
            .to_lowercase()
            .replace('\\', "/");

        if !name.ends_with('/') {
            let raw = &data[data_start..data_end];
            let file_data = match compression {
                0 => raw.to_vec(),
                8 => inflate_raw(raw, uncompressed_size)
                        .unwrap_or_else(|_| raw.to_vec()),
                _ => raw.to_vec(),
            };
            entries.push((name, file_data));
        }

        i = data_end;
    }

    Ok(entries)
}

fn inflate_raw(data: &[u8], expected: usize) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; expected];
    let mut in_pos  = 0usize;
    let mut out_pos = 0usize;

    while in_pos < data.len() && out_pos < out.len() {
        let bfinal = data[in_pos] & 1;
        let btype  = (data[in_pos] >> 1) & 3;
        in_pos += 1;

        match btype {
            0 => {
                in_pos = (in_pos + 3) & !3;
                if in_pos + 4 > data.len() { break; }
                let len  = u16::from_le_bytes(data[in_pos..in_pos+2].try_into().unwrap()) as usize;
                in_pos += 4;
                if in_pos + len > data.len() { break; }
                let end = out_pos + len.min(out.len() - out_pos);
                out[out_pos..end].copy_from_slice(&data[in_pos..in_pos+(end-out_pos)]);
                out_pos = end;
                in_pos += len;
            }
            _ => {
                return Err("Compressed pakfile entries require a full DEFLATE implementation".into());
            }
        }

        if bfinal != 0 { break; }
    }

    Ok(out)
}
