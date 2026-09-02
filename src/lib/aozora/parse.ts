/**
 * 青空文庫記法パーサー(プロトタイプ)
 *
 * 行を1文字ずつ走査して「単位」の列に変換し、そこへルビ・傍点などを
 * 後から掛ける構造にしている。ルビの親文字は文字種の境界で決まるため、
 * 正規表現の後方参照では正しく取れない。
 *
 * 外字は注記の面区点から実際の文字へ変換する。変換表は gaiji-table.ts。
 */
import { GAIJI_ENTRY_SIZE, GAIJI_TABLE } from "./gaiji-table";

export type Parsed = {
  title: string;
  author: string;
  /** 本文のHTML */
  bodyHtml: string;
  /** 底本情報(底本名・入力者・校正者など)の行 */
  colophon: string[];
};

const SEPARATOR = /^-{10,}$/;

export function parse(raw: string): Parsed {
  const lines = raw.split(/\r?\n/);

  const title = (lines[0] ?? "").trim();
  const author = (lines[1] ?? "").trim();

  // 記号説明ブロック(ハイフン行に挟まれる)を読み飛ばす
  let start = 2;
  const open = lines.findIndex((l, n) => n >= start && SEPARATOR.test(l));
  if (open !== -1) {
    const close = lines.findIndex((l, n) => n > open && SEPARATOR.test(l));
    if (close !== -1) start = close + 1;
  }

  // 底本情報の開始位置
  let end = lines.findIndex((l, n) => n >= start && l.startsWith("底本："));
  if (end === -1) end = lines.length;

  const colophon = lines.slice(end).filter((l) => l.trim() !== "");
  return { title, author, bodyHtml: toHtml(lines.slice(start, end)), colophon };
}

/* ------------------------------------------------------------------ */
/* 単位: 表示される1文字ぶん。ルビ・傍点はここに後から掛ける             */
/* ------------------------------------------------------------------ */

type Unit = {
  /** 表示するHTML(外字は span になる) */
  html: string;
  /** 文字種判定に使う素の文字。外字は漢字扱い */
  ch: string;
  ruby?: string;
  boten?: boolean;
};

/**
 * 行の置き方。青空文庫の注記のうち、行全体の位置を決めるもの。
 *
 * indent は行頭から何字下げるか。縦書きでは行頭が上、横書きでは左になるが、
 * どちらも「行の始まり」なので同じ指定でよい。
 * hang は行末(縦書きでは下)へ寄せる指定で、何字ぶん空けるかを持つ。
 */
type Placement = { indent?: number; hang?: number };

type CharClass = "kanji" | "hiragana" | "katakana" | "latin" | "digit" | "other";

function charClass(ch: string): CharClass {
  const c = ch.codePointAt(0)!;
  if (ch >= "ぁ" && ch <= "ゟ") return "hiragana";
  if ((ch >= "゠" && ch <= "ヿ") || (ch >= "｡" && ch <= "ﾟ")) return "katakana";
  if (/[A-Za-z]/.test(ch) || (ch >= "Ａ" && ch <= "ｚ")) return "latin";
  if (/[0-9]/.test(ch) || (ch >= "０" && ch <= "９")) return "digit";
  if (
    (c >= 0x3005 && c <= 0x3007) || // 々〆〇
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0xf900 && c <= 0xfaff)
  ) {
    return "kanji";
  }
  return "other";
}

/* ------------------------------------------------------------------ */
/* 本文 → HTML                                                         */
/* ------------------------------------------------------------------ */

function toHtml(lines: string[]): string {
  const out: string[] = [];
  let blank = 0;
  /** ［＃ここからN字下げ］…［＃ここで字下げ終わり］ が続いているあいだの体裁 */
  let block: Placement = {};

  for (const line of lines) {
    if (line.trim() === "") {
      blank++;
      continue;
    }
    // 空行は場面転換などの「間」を表すので、間隔として残す
    if (blank > 0 && out.length > 0) out.push(`<div class="gap" aria-hidden="true"></div>`);
    blank = 0;

    const { units, heading, place, blockStart, blockEnd } = scan(line);
    if (blockEnd) block = {};
    if (blockStart) block = blockStart;

    const inner = render(units);
    if (inner === "") continue;
    // 行ごとの指定があればそちらを優先する。無ければ続いている塊の体裁に従う
    out.push(wrap(inner, heading, place.indent !== undefined || place.hang !== undefined ? place : block));
  }
  return out.join("\n");
}

/** 本文の1行を要素にする。字下げなどは値をそのまま持たせ、寸法は CSS が決める */
function wrap(inner: string, heading: number | undefined, place: Placement): string {
  const cls: string[] = [];
  const vars: string[] = [];
  if (heading) cls.push("heading");
  if (place.indent) {
    cls.push("indent");
    vars.push(`--indent:${place.indent}`);
  }
  if (place.hang !== undefined) {
    cls.push("hang");
    if (place.hang) vars.push(`--hang:${place.hang}`);
  }
  const attr =
    (cls.length ? ` class="${cls.join(" ")}"` : "") +
    (vars.length ? ` style="${vars.join(";")}"` : "");
  const tag = heading ? `h${heading}` : "p";
  return `<${tag}${attr}>${inner}</${tag}>`;
}

/** 連続する傍点はひとつの要素にまとめる */
function render(units: Unit[]): string {
  const out: string[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.boten && !u.ruby) {
      let j = i;
      const run: string[] = [];
      while (j < units.length && units[j]!.boten && !units[j]!.ruby) {
        run.push(units[j]!.html);
        j++;
      }
      out.push(`<em class="boten">${run.join("")}</em>`);
      i = j - 1;
      continue;
    }
    out.push(u.ruby ? `<ruby>${u.html}<rt>${escapeHtml(u.ruby)}</rt></ruby>` : u.html);
  }
  return out.join("");
}

/** 見出し注記のレベル。h1 は作品タイトルに使うため h2 から割り当てる */
const HEADING_LEVEL: Record<string, number> = {
  大見出し: 2,
  中見出し: 3,
  小見出し: 4,
};

/* ------------------------------------------------------------------ */
/* 1行の走査                                                           */
/* ------------------------------------------------------------------ */

function scan(line: string): {
  units: Unit[];
  heading?: number;
  place: Placement;
  blockStart?: Placement;
  blockEnd?: boolean;
} {
  const units: Unit[] = [];
  let heading: number | undefined;
  const place: Placement = {};
  let blockStart: Placement | undefined;
  let blockEnd: boolean | undefined;
  /** ｜ が示すルビ範囲の開始位置(units上の添字) */
  let rubyStart: number | null = null;
  let i = 0;

  while (i < line.length) {
    const ch = line[i]!;

    // ルビ範囲の開始指定
    if (ch === "｜") {
      rubyStart = units.length;
      i++;
      continue;
    }

    // 外字注記: ※［＃…］
    if (ch === "※" && line.startsWith("［＃", i + 1)) {
      const close = line.indexOf("］", i);
      if (close !== -1) {
        const note = line.slice(i + 3, close);
        units.push(gaijiUnit(note));
        i = close + 1;
        continue;
      }
    }

    // 注記: ［＃…］。多くは直前の文字列に掛かる後方参照型
    if (ch === "［" && line[i + 1] === "＃") {
      const close = line.indexOf("］", i);
      if (close !== -1) {
        const note = line.slice(i + 2, close);
        const level = applyAnnotation(units, note, rubyStart);
        if (level) heading = level;

        const laid = readPlacement(note);
        if (laid) {
          if (laid.scope === "line") Object.assign(place, laid.place);
          else if (laid.scope === "start") blockStart = laid.place;
          else blockEnd = true;
        }
        i = close + 1;
        continue;
      }
    }

    // ルビ: 《…》
    if (ch === "《") {
      const close = line.indexOf("》", i);
      if (close !== -1) {
        attachRuby(units, line.slice(i + 1, close), rubyStart);
        rubyStart = null;
        i = close + 1;
        continue;
      }
    }

    units.push({ html: escapeHtml(ch), ch });
    i++;
  }

  return { units, heading, place, blockStart, blockEnd };
}

/** 全角の数字も使われるので、算用数字にそろえて読む */
function toNumber(s: string): number {
  return Number(s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)));
}

/**
 * 行の置き方を指定する注記を読む。
 *
 * 1行だけに掛かるもの(［＃４字下げ］)と、［＃ここから…］［＃ここで…終わり］で
 * 挟んだ範囲に掛かるものがある。実データでは注記全体の3割がこの類で、
 * 見出しの前に置かれることが多い。落とすと見出しが本文と同じ位置に並ぶ。
 */
function readPlacement(
  note: string,
): { scope: "line" | "start" | "end"; place: Placement } | undefined {
  let m: RegExpExecArray | null;

  if ((m = /^([0-9０-９]+)字下げ$/.exec(note)))
    return { scope: "line", place: { indent: toNumber(m[1]!) } };
  if ((m = /^ここから([0-9０-９]+)字下げ$/.exec(note)))
    return { scope: "start", place: { indent: toNumber(m[1]!) } };
  if (/^ここで字下げ終わり$/.test(note)) return { scope: "end", place: {} };

  // 地付き・字上げ。行末(縦書きでは下)へ寄せる
  if (/^地付き$/.test(note)) return { scope: "line", place: { hang: 0 } };
  if ((m = /^地から([0-9０-９]+)字上げ$/.exec(note)))
    return { scope: "line", place: { hang: toNumber(m[1]!) } };
  if ((m = /^ここから地から([0-9０-９]+)字上げ$/.exec(note)))
    return { scope: "start", place: { hang: toNumber(m[1]!) } };
  if (/^ここで字上げ終わり$/.test(note)) return { scope: "end", place: {} };

  return undefined;
}

/**
 * 外字注記を1つの単位にする。
 *
 * 注記には面区点(第3水準1-88-81)か符号位置(U+9C56)が添えられていることが多く、
 * そこから実際の文字を復元できる。復元できたときは普通の1文字として組めるので、
 * 行の長さも崩れない。
 *
 * 復元できないものは字形の説明(「目＋匡」など)をそのまま出す。読みにくいが、
 * 何の字か分からなくなるよりはよい。3文字ぶんの幅を取ることになる。
 */
function gaijiUnit(note: string): Unit {
  const cp = lookupGaiji(note);
  if (cp !== undefined) {
    const ch = String.fromCodePoint(cp);
    return { html: escapeHtml(ch), ch };
  }
  const shape = /^「([^」]*)」/.exec(note)?.[1] ?? note;
  return {
    html: `<span class="gaiji" title="${escapeHtml(note)}">${escapeHtml(shape)}</span>`,
    ch: "漢", // ルビの親文字として漢字と同じ扱いにする
  };
}

/** 注記から符号位置を得る。分からなければ undefined */
function lookupGaiji(note: string): number | undefined {
  // 符号位置が直接書かれている場合
  const direct = /U\+([0-9A-Fa-f]{4,6})/.exec(note);
  if (direct) return parseInt(direct[1]!, 16);

  // 面-区-点。「第3水準1-88-81」「第4水準2-12-93」など
  const m = /([12])-(\d{1,2})-(\d{1,2})(?!\d)/.exec(note);
  if (!m) return undefined;
  const men = Number(m[1]);
  const ku = Number(m[2]);
  const ten = Number(m[3]);
  if (ku < 1 || ku > 94 || ten < 1 || ten > 94) return undefined;

  const want = (men - 1) * 94 * 94 + (ku - 1) * 94 + (ten - 1);

  // 表は面区点の順に並んでいる。組み立て直さず、その場で二分探索する
  let lo = 0;
  let hi = GAIJI_TABLE.length / GAIJI_ENTRY_SIZE - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = mid * GAIJI_ENTRY_SIZE;
    const found = Number(GAIJI_TABLE.slice(at, at + 5));
    if (found === want) return parseInt(GAIJI_TABLE.slice(at + 5, at + GAIJI_ENTRY_SIZE), 16);
    if (found < want) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/**
 * ルビを親文字に掛ける。｜ で範囲が明示されていればそこから、
 * 無ければ文字種が変わる手前までさかのぼる(青空文庫の仕様)。
 */
function attachRuby(units: Unit[], ruby: string, rubyStart: number | null): void {
  if (units.length === 0) return;

  // 既にルビが付いた単位は、後続のルビの親文字に含めない。
  // 「刻《こく》下《さが》」で「下」の親を探す際に「刻」まで巻き込むと、
  // 「刻」のルビが失われてしまう。
  if (units[units.length - 1]!.ruby) return;

  let from: number;
  if (rubyStart !== null) {
    from = rubyStart;
  } else {
    const cls = charClass(units[units.length - 1]!.ch);
    from = units.length - 1;
    while (from > 0 && !units[from - 1]!.ruby && charClass(units[from - 1]!.ch) === cls) {
      from--;
    }
  }

  const base = units.splice(from);
  units.push({
    html: base.map((u) => (u.boten ? `<em class="boten">${u.html}</em>` : u.html)).join(""),
    ch: base[base.length - 1]!.ch,
    ruby,
  });
}

/**
 * 注記を解釈する。見出しならレベルを返す。
 * 対応していない注記は表示から落とす。
 */
function applyAnnotation(
  units: Unit[],
  note: string,
  rubyStart: number | null,
): number | undefined {
  // ［＃「対象」に傍点］ — 直前に現れた対象へ掛ける
  const boten = /^「(.+)」に傍点$/.exec(note);
  if (boten) {
    markRange(units, boten[1]!, (u) => (u.boten = true));
    return undefined;
  }

  // ［＃「対象」は中見出し］ など
  const head = /^「(.+)」は(大見出し|中見出し|小見出し)$/.exec(note);
  if (head) return HEADING_LEVEL[head[2]!];

  // ［＃中見出し］…［＃中見出し終わり］ の開始側
  const headBlock = /^(大見出し|中見出し|小見出し)$/.exec(note);
  if (headBlock) return HEADING_LEVEL[headBlock[1]!];

  return undefined;
}

/** 直前に現れた text に一致する範囲へ印を付ける */
function markRange(units: Unit[], text: string, mark: (u: Unit) => void): void {
  const plain = units.map((u) => u.ch).join("");
  const at = plain.lastIndexOf(text);
  if (at === -1) return;
  for (let n = at; n < at + text.length; n++) mark(units[n]!);
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  return s.replace(/[&<>]/g, (c) => map[c]!);
}
