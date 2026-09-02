/**
 * 外字注記の面区点 → Unicode の変換表を生成する。
 *
 *   npm run build-gaiji-table
 *
 * 生成物は src/lib/aozora/gaiji-table.ts。差分を確認してからコミットする。
 * 詳細は docs/viewer-design.md「外字の扱い」を参照。
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** JIS X 0213:2004 の公式の対応表 */
const TABLE_URL = "https://x0213.org/codetable/jisx0213-2004-std.txt";
const OUT = fileURLToPath(new URL("../src/lib/aozora/gaiji-table.ts", import.meta.url));

type Entry = { men: number; ku: number; ten: number; cp: number };

/**
 * 区点から Shift_JIS の2バイトを組み立てて、その文字を得る。
 *
 * 青空文庫が外字注記にするのは、本文の文字コード(Shift_JIS)で書けない文字だけ。
 * ここで書けると分かったものは注記に現れないので、表から落とす。
 */
function inShiftJis(ku: number, ten: number, cp: number): boolean {
  const lead = ku < 63 ? (ku + 257) >> 1 : (ku + 385) >> 1;
  const trail = ku % 2 ? ten + (ten < 64 ? 63 : 64) : ten + 158;
  const decoded = new TextDecoder("shift_jis").decode(new Uint8Array([lead, trail]));
  return decoded === String.fromCodePoint(cp);
}

async function main() {
  const src = await fetch(TABLE_URL).then((r) => {
    if (!r.ok) throw new Error(`表を取得できません: ${r.status}`);
    return r.text();
  });

  const entries: Entry[] = [];
  for (const line of src.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    // 左辺は 3-XXXX(面1) / 4-XXXX(面2)。XXXX は区点を16進で表したもの
    const [code, unicode] = line.split("\t");
    const m = /^([34])-([0-9A-Fa-f]{4})$/.exec(code ?? "");
    if (!m || !unicode?.startsWith("U+")) continue;

    const points = unicode.slice(2).split("+").map((h) => parseInt(h, 16));
    if (points.length !== 1) continue; // 合成が要る文字は1文字にできないので外す

    const men = m[1] === "3" ? 1 : 2;
    const ku = parseInt(m[2]!.slice(0, 2), 16) - 0x20;
    const ten = parseInt(m[2]!.slice(2, 4), 16) - 0x20;
    const cp = points[0]!;

    // 面2はすべて第4水準。面1は Shift_JIS で書けないものだけ残す
    if (men === 1 && inShiftJis(ku, ten, cp)) continue;
    entries.push({ men, ku, ten, cp });
  }

  entries.sort((a, b) => key(a) - key(b));

  // 1件11文字の固定長にして並べる。読み込み時に組み立て直さず、
  // 必要になった外字だけを二分探索で引くため
  const packed = entries
    .map((e) => String(key(e)).padStart(5, "0") + e.cp.toString(16).padStart(6, "0"))
    .join("");

  const ts = `/**
 * 外字注記の面区点 → Unicode の変換表。
 *
 * scripts/build-gaiji-table.ts が ${TABLE_URL} から生成する。手で編集しない。
 *
 * JIS X 0208 で書ける文字は本文にそのまま入るため外字注記にならない。
 * それらを除いた ${entries.length} 文字だけを持つ(表全体は約11,200文字)。
 *
 * 1件11文字の固定長で並べてある。前5文字が面区点を詰めた番号、後6文字が
 * 符号位置の16進。読み込み時に表を組み立てると毎リクエストの処理時間に乗るので、
 * 文字列のまま置いて必要な分だけ二分探索で引く。
 */
export const GAIJI_ENTRY_SIZE = 11;

export const GAIJI_TABLE =
  "${packed}";
`;
  await writeFile(OUT, ts);
  console.log(`${entries.length} 件 / ${(ts.length / 1024).toFixed(1)} KB を書き出しました`);
}

/** 面区点を1つの番号に詰める。面1〜2・区1〜94・点1〜94 で 17,663 まで */
function key({ men, ku, ten }: Entry): number {
  return (men - 1) * 94 * 94 + (ku - 1) * 94 + (ten - 1);
}

main();
