/**
 * 青空文庫の公式CSVから索引データを生成する。
 *
 *   npm run update-index
 *
 * 生成物は src/data/index/ 配下。差分を確認してからコミットする。
 * 詳細は docs/design.md「メタデータ索引」を参照。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CSV_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip";
const USER_AGENT =
  "vertical-text-viewer-app (+https://github.com/hibara428/vertical-text-viewer-app)";
const OUT_DIR = fileURLToPath(new URL("../src/data/index/", import.meta.url));

/** 作品IDの下2桁でシャーディングする(100分割) */
const SHARD_DIGITS = 2;

type Contributor = { personId: string; role: string };

type Work = {
  id: string;
  title: string;
  titleKana: string;
  sortKana: string;
  contributors: Contributor[];
  sourceUrl: string;
  cardUrl: string;
};

type Person = {
  id: string;
  name: string;
  nameKana: string;
  sortKana: string;
};

async function main() {
  console.log(`CSVを取得: ${CSV_URL}`);
  const rows = await fetchCsv();
  console.log(`  ${rows.length.toLocaleString()} 行`);

  const { works, people, skipped } = build(rows);
  console.log(`作品 ${works.size.toLocaleString()} 件 / 人物 ${people.size.toLocaleString()} 人`);
  for (const [reason, n] of Object.entries(skipped)) {
    if (n > 0) console.log(`  除外: ${reason} ${n} 件`);
  }

  await write(works, people);
  console.log(`出力: ${OUT_DIR}`);
}

/* ------------------------------------------------------------------ */
/* CSV の取得と解析                                                     */
/* ------------------------------------------------------------------ */

async function fetchCsv(): Promise<Record<string, string>[]> {
  const res = await fetch(CSV_URL, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`CSVの取得に失敗しました (${res.status})`);

  const zip = new Uint8Array(await res.arrayBuffer());
  const csv = new TextDecoder("utf-8").decode(await inflateFirstEntry(zip));
  return parseCsv(csv);
}

/** zip の最初の1ファイルを取り出す(本文取得と同じ手順) */
async function inflateFirstEntry(zip: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("zip 形式ではありません");

  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const body = zip.subarray(start, start + compressedSize);
  if (method === 0) return body;

  const stream = new Blob([body as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 引用符とその中の改行に対応した最小限のCSVパーサ */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const header = rows[0]!.map((h) => h.replace(/^﻿/, ""));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/* ------------------------------------------------------------------ */
/* 索引の組み立て                                                       */
/* ------------------------------------------------------------------ */

function build(rows: Record<string, string>[]) {
  const works = new Map<string, Work>();
  const people = new Map<string, Person>();
  const skipped = { 著作権あり: 0, 本文URLなし: 0, 外部サイト: 0 };

  for (const r of rows) {
    if (r["作品著作権フラグ"] !== "なし") {
      skipped.著作権あり++;
      continue;
    }
    const sourceUrl = r["テキストファイルURL"]?.trim() ?? "";
    if (!sourceUrl) {
      skipped.本文URLなし++;
      continue;
    }
    // 外部サイト設置の作品は取得経路が揃わないため扱わない
    if (!sourceUrl.includes("www.aozora.gr.jp")) {
      skipped.外部サイト++;
      continue;
    }

    const id = r["作品ID"]!;
    const personId = r["人物ID"]!;

    if (!works.has(id)) {
      works.set(id, {
        id,
        title: r["作品名"]!,
        titleKana: r["作品名読み"] ?? "",
        sortKana: r["ソート用読み"] ?? "",
        contributors: [],
        sourceUrl,
        cardUrl: r["図書カードURL"] ?? "",
      });
    }
    works.get(id)!.contributors.push({ personId, role: r["役割フラグ"] ?? "" });

    if (!people.has(personId)) {
      people.set(personId, {
        id: personId,
        name: [r["姓"], r["名"]].filter(Boolean).join(" "),
        nameKana: [r["姓読み"], r["名読み"]].filter(Boolean).join(" "),
        sortKana: r["姓読みソート用"] ?? "",
      });
    }
  }

  return { works, people, skipped };
}

/* ------------------------------------------------------------------ */
/* 出力                                                                */
/* ------------------------------------------------------------------ */

/** 作品IDからシャード名を得る。エッジ関数側と同じ規則を使う */
export function shardOf(workId: string): string {
  return workId.slice(-SHARD_DIGITS).padStart(SHARD_DIGITS, "0");
}

async function write(works: Map<string, Work>, people: Map<string, Person>) {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(new URL("works/", `file://${OUT_DIR}`), { recursive: true });

  // 作品はシャードごとに分割する(エッジ関数が必要な分だけ読むため)
  const shards = new Map<string, Record<string, Work>>();
  for (const work of works.values()) {
    const key = shardOf(work.id);
    if (!shards.has(key)) shards.set(key, {});
    shards.get(key)![work.id] = work;
  }
  for (const [key, entries] of shards) {
    await writeFile(`${OUT_DIR}works/${key}.json`, JSON.stringify(entries));
  }

  // 人物はブラウジング用にまとめて1ファイル(ビルド時にしか読まない)
  await writeFile(
    `${OUT_DIR}people.json`,
    JSON.stringify(Object.fromEntries([...people].map(([id, p]) => [id, p]))),
  );

  console.log(`  作品シャード ${shards.size} ファイル / 人物 1 ファイル`);
}

await main();
