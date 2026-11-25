#!/usr/bin/env node
/**
 * data/ptt-raw.json  ->  data/*.json, data/*.csv, sql/postgresql.sql
 *
 *   node scripts/build.mjs
 *
 * No dependencies; Node 18+.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ptt-raw.json"), "utf8"));

// ---------- normalization ----------
const lower = (s) => s.toLocaleLowerCase("tr-TR");
const upper = (s) => s.toLocaleUpperCase("tr-TR");
const collator = new Intl.Collator("tr-TR");
const byName = (a, b) => collator.compare(a, b);

/** "AHMET REMZİ YÜREĞİR" -> "Ahmet Remzi Yüreğir" */
export function titleCaseTr(s) {
  return lower(s.trim().replace(/\s+/g, " ")).replace(
    /(^|[\s(\-/.])(\p{L})/gu,
    (_, sep, ch) => sep + upper(ch),
  );
}

/** ASCII slug: "Afyonkarahisar" -> "afyonkarahisar", "Şanlıurfa" -> "sanliurfa" */
export function slug(s) {
  return lower(s)
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ö/g, "o").replace(/ç/g, "c").replace(/[âà]/g, "a").replace(/[îì]/g, "i").replace(/[ûù]/g, "u")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * PTT neighborhood name -> display name.
 *   "500 EVLER MAH."           -> "500 Evler"                (tip: mahalle)
 *   "AĞCİN KÖYÜ"               -> "Ağcin Köyü"               (tip: koy)
 *   "YUKARI / ÇUKURKÖY KÖYÜ"   -> "Çukurköy Köyü, Yukarı"    (tip: koy, mevki: Yukarı)
 */
export function parseNeighborhood(pttName) {
  const cleaned = pttName.trim().replace(/\s+MAH(\.|ALLESİ)?\s*$/iu, "").replace(/\s+/g, " ");
  // \b does not work after "Ü" (non-ASCII), so match the end explicitly
  const isVillage = /KÖYÜ(\s|,|$)/u.test(upper(pttName));
  const m = cleaned.match(/^(.+?)\s*\/\s*(.+)$/);
  if (m) {
    const koy = titleCaseTr(m[2]);
    const mevki = titleCaseTr(m[1]);
    return { ad: `${koy}, ${mevki}`, tip: isVillage ? "koy" : "mahalle", koy: isVillage ? koy : null, mevki };
  }
  const ad = titleCaseTr(cleaned);
  return { ad, tip: isVillage ? "koy" : "mahalle", koy: isVillage ? ad : null, mevki: null };
}

// ---------- build model ----------
const iller = [];
let ilceId = 0;
let mahalleId = 0;
const provinces = [...raw.provinces].sort((a, b) => a.plaka - b.plaka);
for (const p of provinces) {
  const ilAd = titleCaseTr(p.name);
  const il = { plaka: p.plaka, ad: ilAd, slug: slug(ilAd), ilceler: [] };
  const districts = [...p.districts].sort((a, b) => byName(titleCaseTr(a.name), titleCaseTr(b.name)));
  for (const d of districts) {
    const ilce = { id: ++ilceId, ad: titleCaseTr(d.name), mahalleler: [] };
    const merged = new Map(); // dedupe by display name, merge postal codes
    for (const [n, pk] of d.neighborhoods) {
      const parsed = parseNeighborhood(n);
      const k = lower(parsed.ad);
      const codes = pk.split(",").filter(Boolean);
      if (merged.has(k)) {
        const e = merged.get(k);
        for (const c of codes) if (!e.posta_kodlari.includes(c)) e.posta_kodlari.push(c);
        continue;
      }
      merged.set(k, { ...parsed, posta_kodlari: codes, ptt_adi: n });
    }
    const list = [...merged.values()].sort((a, b) => byName(a.ad, b.ad));
    for (const m of list) {
      m.posta_kodlari.sort();
      ilce.mahalleler.push({ id: ++mahalleId, ...m });
    }
    il.ilceler.push(ilce);
  }
  iller.push(il);
}

// ---------- writers ----------
const out = (rel, content) => {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";

const meta = { kaynak: "PTT Posta Kodu Sorgulama (https://www.ptt.gov.tr/posta-kodu)", tarih: raw.fetchedAt };

// Nested JSON
out(
  "data/il_ilce_mahalle.json",
  JSON.stringify({
    ...meta,
    iller: iller.map((il) => ({
      plaka: il.plaka,
      ad: il.ad,
      slug: il.slug,
      ilceler: il.ilceler.map((ic) => ({
        id: ic.id,
        ad: ic.ad,
        mahalleler: ic.mahalleler.map((m) => ({ id: m.id, ad: m.ad, tip: m.tip, posta_kodu: m.posta_kodlari.join(",") })),
      })),
    })),
  }) + "\n",
);

// Relational JSON / CSV
const ilRows = iller.map((il) => ({ plaka: il.plaka, ad: il.ad, slug: il.slug }));
const ilceRows = iller.flatMap((il) => il.ilceler.map((ic) => ({ id: ic.id, il_plaka: il.plaka, ad: ic.ad })));
const mahRows = iller.flatMap((il) =>
  il.ilceler.flatMap((ic) =>
    ic.mahalleler.map((m) => ({
      id: m.id,
      ilce_id: ic.id,
      ad: m.ad,
      tip: m.tip,
      koy: m.koy,
      mevki: m.mevki,
      posta_kodu: m.posta_kodlari.join(","),
      ptt_adi: m.ptt_adi,
    })),
  ),
);
out("data/iller.json", JSON.stringify(ilRows, null, 2) + "\n");
out("data/ilceler.json", JSON.stringify(ilceRows) + "\n");
out("data/mahalleler.json", JSON.stringify(mahRows) + "\n");
out("data/iller.csv", csv(["plaka", "ad", "slug"], ilRows.map((r) => [r.plaka, r.ad, r.slug])));
out("data/ilceler.csv", csv(["id", "il_plaka", "ad"], ilceRows.map((r) => [r.id, r.il_plaka, r.ad])));
out(
  "data/mahalleler.csv",
  csv(
    ["id", "ilce_id", "ad", "tip", "koy", "mevki", "posta_kodu", "ptt_adi"],
    mahRows.map((r) => [r.id, r.ilce_id, r.ad, r.tip, r.koy, r.mevki, r.posta_kodu, r.ptt_adi]),
  ),
);

// Flat CSV (one row per neighborhood, everything denormalized)
const flat = iller.flatMap((il) =>
  il.ilceler.flatMap((ic) =>
    ic.mahalleler.map((m) => [il.plaka, il.ad, ic.ad, m.ad, m.tip, m.posta_kodlari.join(",")]),
  ),
);
out("data/il_ilce_mahalle.csv", "﻿" + csv(["plaka", "il", "ilce", "mahalle", "tip", "posta_kodu"], flat));

// PostgreSQL
const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const sql = [];
sql.push(`-- Türkiye il / ilçe / mahalle listesi`);
sql.push(`-- Kaynak: ${meta.kaynak}, ${meta.tarih}`);
sql.push(`-- Oluşturan: scripts/build.mjs`);
sql.push(``);
sql.push(`BEGIN;`);
sql.push(``);
sql.push(`CREATE TABLE IF NOT EXISTS il (
  plaka  smallint PRIMARY KEY,
  ad     text NOT NULL,
  slug   text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ilce (
  id        integer PRIMARY KEY,
  il_plaka  smallint NOT NULL REFERENCES il (plaka),
  ad        text NOT NULL,
  UNIQUE (il_plaka, ad)
);

CREATE TABLE IF NOT EXISTS mahalle (
  id          integer PRIMARY KEY,
  ilce_id     integer NOT NULL REFERENCES ilce (id),
  ad          text NOT NULL,
  tip         text NOT NULL CHECK (tip IN ('mahalle', 'koy')),
  koy         text,
  mevki       text,
  posta_kodu  text,
  ptt_adi     text NOT NULL
);

CREATE INDEX IF NOT EXISTS ilce_il_plaka_idx ON ilce (il_plaka);
CREATE INDEX IF NOT EXISTS mahalle_ilce_id_idx ON mahalle (ilce_id);
`);
const chunked = (table, cols, rows) => {
  for (let i = 0; i < rows.length; i += 500) {
    sql.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES`);
    sql.push(rows.slice(i, i + 500).map((r) => `  (${r.join(", ")})`).join(",\n") + ";");
  }
  sql.push("");
};
chunked("il", ["plaka", "ad", "slug"], ilRows.map((r) => [r.plaka, q(r.ad), q(r.slug)]));
chunked("ilce", ["id", "il_plaka", "ad"], ilceRows.map((r) => [r.id, r.il_plaka, q(r.ad)]));
chunked(
  "mahalle",
  ["id", "ilce_id", "ad", "tip", "koy", "mevki", "posta_kodu", "ptt_adi"],
  mahRows.map((r) => [r.id, r.ilce_id, q(r.ad), q(r.tip), q(r.koy), q(r.mevki), q(r.posta_kodu), q(r.ptt_adi)]),
);
sql.push(`COMMIT;`);
out("sql/postgresql.sql", sql.join("\n") + "\n");

const koy = mahRows.filter((m) => m.tip === "koy").length;
console.log(`il=${ilRows.length} ilce=${ilceRows.length} mahalle=${mahRows.length - koy} koy=${koy} toplam=${mahRows.length}`);
