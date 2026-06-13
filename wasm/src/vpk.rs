use wasm_bindgen::prelude::*;
use std::collections::HashMap;

const VPK_MAGIC:   u32 = 0x55AA1234;
const DATA_IN_DIR: u16 = 0x7fff;

struct Entry {
    archive_index: u16,
    entry_offset:  u32,
    entry_length:  u32,
    preload:       Vec<u8>,
}

#[wasm_bindgen]
pub struct VpkReader {
    entries:           HashMap<String, Entry>,
    dir_buf:           Vec<u8>,
    data_embed_offset: usize,
}

#[wasm_bindgen]
impl VpkReader {
    #[wasm_bindgen(constructor)]
    pub fn new(dir_buf: Vec<u8>) -> Result<VpkReader, JsValue> {
        let mut reader = VpkReader {
            entries: HashMap::new(),
            dir_buf: dir_buf.clone(),
            data_embed_offset: 0,
        };
        reader.parse(dir_buf).map_err(|e| JsValue::from_str(&e))?;
        Ok(reader)
    }

    pub fn has(&self, file_path: &str) -> bool {
        let key = normalize_key(file_path);
        self.entries.contains_key(&key)
    }

    pub fn read(&self, file_path: &str) -> Option<Vec<u8>> {
        let key = normalize_key(file_path);
        let entry = self.entries.get(&key)?;

        let mut parts: Vec<Vec<u8>> = Vec::new();
        if !entry.preload.is_empty() {
            parts.push(entry.preload.clone());
        }

        if entry.entry_length > 0 {
            if entry.archive_index == DATA_IN_DIR {
                let start = self.data_embed_offset + entry.entry_offset as usize;
                let end   = start + entry.entry_length as usize;
                parts.push(self.dir_buf[start..end].to_vec());
            } else {
                return None;
            }
        }

        if parts.is_empty() { return Some(vec![]); }
        if parts.len() == 1 { return Some(parts.remove(0)); }
        Some(parts.into_iter().flatten().collect())
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }
}

impl VpkReader {
    fn parse(&mut self, buf: Vec<u8>) -> Result<(), String> {
        if buf.len() < 12 { return Err("VPK too small".into()); }

        let magic   = u32::from_le_bytes(buf[0..4].try_into().unwrap());
        if magic != VPK_MAGIC { return Err(format!("Bad VPK magic: {:x}", magic)); }

        let version = u32::from_le_bytes(buf[4..8].try_into().unwrap());
        let tree_size = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;

        let header_size = match version {
            1 => 12,
            2 => 28,
            _ => return Err(format!("Unknown VPK version: {}", version)),
        };

        self.data_embed_offset = header_size + tree_size;
        let mut offset = header_size;

        loop {
            let (ext, n) = read_cstring(&buf, offset);
            offset += n;
            if ext.is_empty() { break; }

            loop {
                let (path, n) = read_cstring(&buf, offset);
                offset += n;
                if path.is_empty() { break; }

                loop {
                    let (name, n) = read_cstring(&buf, offset);
                    offset += n;
                    if name.is_empty() { break; }

                    if offset + 18 > buf.len() { break; }
                    let _crc          = u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap());
                    let preload_bytes = u16::from_le_bytes(buf[offset+4..offset+6].try_into().unwrap()) as usize;
                    let archive_index = u16::from_le_bytes(buf[offset+6..offset+8].try_into().unwrap());
                    let entry_offset  = u32::from_le_bytes(buf[offset+8..offset+12].try_into().unwrap());
                    let entry_length  = u32::from_le_bytes(buf[offset+12..offset+16].try_into().unwrap());
                    offset += 18;

                    let preload = if preload_bytes > 0 && offset + preload_bytes <= buf.len() {
                        let p = buf[offset..offset+preload_bytes].to_vec();
                        offset += preload_bytes;
                        p
                    } else { vec![] };

                    let file_path = build_path(&path, &name, &ext);
                    self.entries.insert(file_path, Entry { archive_index, entry_offset, entry_length, preload });
                }
            }
        }

        Ok(())
    }
}

fn normalize_key(path: &str) -> String {
    path.to_lowercase().replace('\\', "/").trim_start_matches('/').to_string()
}

fn read_cstring(buf: &[u8], offset: usize) -> (String, usize) {
    let mut end = offset;
    while end < buf.len() && buf[end] != 0 { end += 1; }
    let s = String::from_utf8_lossy(&buf[offset..end]).into_owned();
    (s, end - offset + 1)
}

fn build_path(path: &str, name: &str, ext: &str) -> String {
    if path == " " { format!("{}.{}", name, ext) }
    else { format!("{}/{}.{}", path, name, ext) }
}
