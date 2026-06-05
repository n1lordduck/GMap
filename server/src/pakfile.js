import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import yauzl from "yauzl";

const LUMP_PAKFILE = 40;

export function extractPakfile(bspPath, outDir) {
  return new Promise((resolve) => {
    const buf  = readFileSync(bspPath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    const lumpBase = 8 + LUMP_PAKFILE * 16;
    const offset   = view.getInt32(lumpBase,     true);
    const length   = view.getInt32(lumpBase + 4, true);

    if (length === 0) return resolve({});

    const zipBuf = buf.slice(offset, offset + length);
    mkdirSync(outDir, { recursive: true });

    const extracted = {};

    yauzl.fromBuffer(Buffer.from(zipBuf), { lazyEntries: true }, (err, zip) => {
      if (err) return resolve({});

      zip.readEntry();
      zip.on("entry", entry => {
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }

        zip.openReadStream(entry, (err, stream) => {
          if (err) { zip.readEntry(); return; }

          const chunks = [];
          stream.on("data", c => chunks.push(c));
          stream.on("end", () => {
            const outPath = join(outDir, entry.fileName.replace(/\\/g, "/"));
            mkdirSync(join(outPath, ".."), { recursive: true });
            writeFileSync(outPath, Buffer.concat(chunks));
            extracted[entry.fileName.toLowerCase().replace(/\\/g, "/")] = outPath;
            zip.readEntry();
          });
        });
      });

      zip.on("end",   () => { console.log(`[PAK] ${Object.keys(extracted).length} files from ${bspPath.split("/").pop()}`); resolve(extracted); });
      zip.on("error", () => resolve({}));
    });
  });
}
