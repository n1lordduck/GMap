/**
 * VPK (Valve Pack) Reader
 * Supports VPK v1 and v2 (_dir.vpk + _NNN.vpk data archives).
 *
 * Usage:
 *   const vpk = new VPKReader("/path/to/hl2_textures_dir.vpk");
 *   await vpk.load();
 *   const buf = vpk.read("materials/brick/brickwall001a.vtf");
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";

const VPK_MAGIC   = 0x55AA1234;
const VPK_VERSION_1 = 1;
const VPK_VERSION_2 = 2;
const DATA_IN_DIR = 0x7fff; // archiveIndex meaning data is embedded in _dir.vpk

export class VPKReader {
  constructor(dirPath) {
    this.dirPath  = dirPath;
    // "/path/to/foo_dir.vpk"
    this.basePath = dirPath.replace(/_dir\.vpk$/i, "");
    this.entries  = new Map(); // "extension/path/filename" -> entry
    this.dirBuf   = null;
    this.dataEmbedOffset = 0; // where embedded data starts in _dir.vpk
  }

  load() {
    if (!existsSync(this.dirPath)) return false;

    const buf  = readFileSync(this.dirPath);
    this.dirBuf = buf;

    const magic   = buf.readUInt32LE(0);
    if (magic !== VPK_MAGIC) {
      console.warn(`[VPK] bad magic in ${this.dirPath}`);
      return false;
    }

    const version = buf.readUInt32LE(4);
    let   offset;

    if (version === VPK_VERSION_1) {
      // Header: magic(4) version(4) treeSize(4)  = 12 bytes
      const treeSize = buf.readUInt32LE(8);
      offset = 12;
      this.dataEmbedOffset = 12 + treeSize;
    } else if (version === VPK_VERSION_2) {
      // Header: magic(4) version(4) treeSize(4) fileDataSectionSize(4)
      //         archiveMD5SectionSize(4) otherMD5SectionSize(4) signatureSectionSize(4) = 28 bytes
      const treeSize = buf.readUInt32LE(8);
      offset = 28;
      this.dataEmbedOffset = 28 + treeSize;
    } else {
      console.warn(`[VPK] unknown version ${version} in ${this.dirPath}`);
      return false;
    }

    // Parse the directory tree
    // Structure: for each extension → for each path → for each filename → entry
    while (offset < buf.length) {
      const ext = readCString(buf, offset);
      offset += ext.length + 1;
      if (ext === "") break;

      while (true) {
        const path = readCString(buf, offset);
        offset += path.length + 1;
        if (path === "") break;

        while (true) {
          const name = readCString(buf, offset);
          offset += name.length + 1;
          if (name === "") break;

          // Entry: crc(4) preloadBytes(2) archiveIndex(2) entryOffset(4) entryLength(4) terminator(2)
          const crc          = buf.readUInt32LE(offset);
          const preloadBytes = buf.readUInt16LE(offset + 4);
          const archiveIndex = buf.readUInt16LE(offset + 6);
          const entryOffset  = buf.readUInt32LE(offset + 8);
          const entryLength  = buf.readUInt32LE(offset + 12);
          offset += 16; // 18 - 2 for terminator below

          // terminator
          const terminator = buf.readUInt16LE(offset);
          offset += 2;

          // Preload data immediately follows terminator
          const preloadData = preloadBytes > 0
            ? buf.slice(offset, offset + preloadBytes)
            : null;
          offset += preloadBytes;

          // Build lookup key: "materials/brick/brickwall001a.vtf"
          const filePath = buildPath(path, name, ext);
          this.entries.set(filePath, {
            crc, archiveIndex, entryOffset, entryLength, preloadData,
          });
        }
      }
    }

    console.log(`[VPK] loaded ${this.entries.size} entries from ${basename(this.dirPath)}`);
    return true;
  }

  /**
   * Read a file by its path within the VPK.
   * @param {string} filePath  e.g. "materials/brick/brickwall001a.vtf"
   * @returns {Buffer|null}
   */
  read(filePath) {
    const key = filePath.toLowerCase().replace(/\\/g, "/").replace(/^\//, "");
    const entry = this.entries.get(key);
    if (!entry) return null;

    const parts = [];

    // Preload data (small textures may be entirely here)
    if (entry.preloadData) parts.push(entry.preloadData);

    if (entry.entryLength > 0) {
      if (entry.archiveIndex === DATA_IN_DIR) {
        // Data is embedded inside the _dir.vpk itself
        const start = this.dataEmbedOffset + entry.entryOffset;
        parts.push(this.dirBuf.slice(start, start + entry.entryLength));
      } else {
          // Data is in a numbered archive: foo_000.vpk, foo_001.vpk, etc...
          const archivePath = `${this.basePath}_${String(entry.archiveIndex).padStart(3, "0")}.vpk`;
        if (!existsSync(archivePath)) {
          console.warn(`[VPK] missing archive: ${archivePath}`);
          return null;
        }
        const archiveBuf = readFileSync(archivePath);
        parts.push(archiveBuf.slice(entry.entryOffset, entry.entryOffset + entry.entryLength));
      }
    }

    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  has(filePath) {
    const key = filePath.toLowerCase().replace(/\\/g, "/").replace(/^\//, "");
    return this.entries.has(key);
  }
}

function readCString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.slice(offset, end).toString("utf8");
}

function buildPath(path, name, ext) {
  if (path === " ") return `${name}.${ext}`;
  return `${path}/${name}.${ext}`;
}
