// Minimal reader for PostgreSQL custom-format dumps (pg_dump -Fc), archive version 1.14–1.16.
// We need it because no pg_restore binary is available on this machine.
// Format reference: src/bin/pg_dump/pg_backup_archiver.c and pg_backup_custom.c in PostgreSQL.
import { openSync, readSync, fstatSync } from "node:fs";
import { zstdDecompressSync, gunzipSync } from "node:zlib";

const BLK_DATA = 1;
const BLK_BLOBS = 3;
const COMPRESSION = { 0: "none", 1: "gzip", 2: "lz4", 3: "zstd" };

class Reader {
  constructor(path) {
    this.fd = openSync(path, "r");
    this.size = fstatSync(this.fd).size;
    this.pos = 0;
    this.intSize = 4;
    this.offSize = 8;
  }
  bytes(n) {
    const buf = Buffer.alloc(n);
    const got = readSync(this.fd, buf, 0, n, this.pos);
    if (got !== n) throw new Error(`Unexpected end of dump at ${this.pos}`);
    this.pos += n;
    return buf;
  }
  byte() {
    return this.bytes(1)[0];
  }
  int() {
    // One sign byte, then intSize bytes little-endian.
    const sign = this.byte();
    const b = this.bytes(this.intSize);
    let v = 0;
    for (let i = this.intSize - 1; i >= 0; i--) v = v * 256 + b[i];
    return sign ? -v : v;
  }
  str() {
    const len = this.int();
    if (len < 0) return null;
    return len === 0 ? "" : this.bytes(len).toString("utf8");
  }
  offset() {
    const flag = this.byte(); // 1 = not set, 2 = set, 3 = no data
    const b = this.bytes(this.offSize);
    let v = 0;
    for (let i = this.offSize - 1; i >= 0; i--) v = v * 256 + b[i];
    return { flag, pos: v };
  }
}

export function readDump(path) {
  const r = new Reader(path);
  if (r.bytes(5).toString() !== "PGDMP") throw new Error("Not a PostgreSQL custom dump");
  const [vmaj, vmin, vrev] = [r.byte(), r.byte(), r.byte()];
  const version = vmaj * 10000 + vmin * 100 + vrev;
  if (version < 11400 || version > 11699) throw new Error(`Unsupported archive version ${vmaj}.${vmin}.${vrev}`);
  r.intSize = r.byte();
  r.offSize = r.byte();
  const format = r.byte();
  if (format !== 1) throw new Error(`Expected custom format (1), got ${format}`);
  const compression = COMPRESSION[r.byte()];
  const ts = Array.from({ length: 7 }, () => r.int());
  const header = {
    version: `${vmaj}.${vmin}.${vrev}`,
    compression,
    created: new Date(Date.UTC(ts[5] + 1900, ts[4], ts[3], ts[2], ts[1], ts[0])).toISOString(),
    dbname: r.str(),
    serverVersion: r.str(),
    pgDumpVersion: r.str(),
  };

  const count = r.int();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = {};
    e.dumpId = r.int();
    e.hadDumper = r.int();
    e.tableoid = r.str();
    e.oid = r.str();
    e.tag = r.str();
    e.desc = r.str();
    e.section = r.int(); // 1 none, 2 pre-data, 3 data, 4 post-data
    e.defn = r.str();
    e.dropStmt = r.str();
    e.copyStmt = r.str();
    e.namespace = r.str();
    e.tablespace = r.str();
    e.tableam = r.str();
    if (version >= 11600) e.relkind = r.int();
    e.owner = r.str();
    r.str(); // "with oids", always false now
    e.deps = [];
    for (let d = r.str(); d !== null; d = r.str()) e.deps.push(Number(d));
    e.data = r.offset();
    entries.push(e);
  }
  return { header, entries, reader: r, dataStart: r.pos };
}

function decompress(buf, compression) {
  if (compression === "none") return buf;
  if (compression === "zstd") return zstdDecompressSync(buf);
  if (compression === "gzip") return gunzipSync(buf);
  throw new Error(`Compression ${compression} is not supported by this reader`);
}

// Reads the table data for one TOC entry. Returns the COPY text as a Buffer.
export function readEntryData(dump, entry) {
  const r = dump.reader;
  if (entry.data.flag !== 2) return null;
  r.pos = entry.data.pos;
  const type = r.byte();
  const id = r.int();
  if (id !== entry.dumpId) throw new Error(`Data block id ${id} does not match entry ${entry.dumpId}`);
  if (type !== BLK_DATA && type !== BLK_BLOBS) throw new Error(`Unknown block type ${type}`);
  const chunks = [];
  for (let len = r.int(); len !== 0; len = r.int()) chunks.push(r.bytes(len));
  return decompress(Buffer.concat(chunks), dump.header.compression);
}
