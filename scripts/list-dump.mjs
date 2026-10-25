// Prints a summary of what is inside the dump: node scripts/list-dump.mjs [path] [--full]
import { readDump, readEntryData } from "./pgdump-reader.mjs";

const path = process.argv[2] ?? "../biz-link-droid_260921.backup/biz-link-droid_260921.backup";
const full = process.argv.includes("--full");
const dump = readDump(path);
console.log(dump.header);
console.log(`TOC entries: ${dump.entries.length}`);

const counts = {};
for (const e of dump.entries) {
  const key = `${e.namespace || "-"} | ${e.desc}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.table(Object.entries(counts).sort().map(([k, n]) => ({ "schema | type": k, n })));

const rows = [];
for (const e of dump.entries.filter((e) => e.desc === "TABLE DATA")) {
  const data = readEntryData(dump, e);
  const n = data ? data.toString("utf8").split("\n").filter(Boolean).length : 0;
  if (full || n > 0) rows.push({ table: `${e.namespace}.${e.tag}`, rows: n });
}
console.table(rows);
