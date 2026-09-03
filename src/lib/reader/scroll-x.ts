import { attachTurnZones } from "./input";
import { frameHeight, measure, type Metrics } from "./metrics";
import type { ModeContext, ReaderMode } from "./mode";
import { Revealer, type RevealGeometry } from "./reveal";
import { buildIndex, findFirst, rangeAt, type TextIndex } from "./text-index";

/**
 * 巻物: 縦書き・紙面ごとの横送り。
 *
 * 紙の巻物のように、読んだところだけが広がっていく。1紙面はページモードと同じ
 * 行数で、常に画面の中央に置く。左右には前後の本文が続いていて行き来できる。
 *
 * ```
 * #reader        横スクロールする枠。左右の余白は測って入れる
 * └ .roll        幅 = 読んだ紙面ぶん。ここから左は隠す
 *   └ .body      本文全体。.roll の右端に固定し、左へ伸びる
 * ```
 *
 * 設計は docs/viewer-design.md「巻物モードの設計」。
 */

/** 1紙面を送るのにかける時間。ブラウザ任せの smooth では速さを持てない */
const GLIDE_MS = 900;

/** ゆっくり動き出してゆっくり止まる */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

type State = {
  ctx: ModeContext;
  roll: HTMLElement;
  /** 出し終わったときに、左の余白へ出す誘い */
  prompt: HTMLElement;
  index: TextIndex;
  revealer: Revealer;
  metrics: Metrics;
  /** 読んだ紙面ぶんの長さ */
  unrolled: number;
  /** 本文全体の長さ。これ以上は広がらない */
  full: number;
};

let state: State | null = null;
let detachInput: (() => void) | null = null;

/**
 * 送りと文字出しは別々に動かす。
 *
 * ひとつにまとめると、戻るためにスクロールを始めただけで文字出しまで
 * 打ち切られる。前を見に行っても文字は出続けてほしい。
 */
let scrolling: number | undefined;

/** 紙面の左右に覗かせる行数。前後が続いていることが見える最小限 */
const PEEK_LINES = 1;

/**
 * 1紙面の幅。送りの単位でもある。
 *
 * ページモードと同じ行数(--page-lines)で字詰めも同じなので、分量がそろう。
 * 段組みは使わない。横一列に伸びた本文では、紙面の切れ目は行数の掛け算だけで
 * 決まる。段組みを持ち込むと紙面が縦に積まれ、巻物でなくなる。
 *
 * ただし画面が狭いとその行数が入らない。スマホでは紙面がはみ出して中央に
 * 置けなくなるので、**収まる行数で頭打ちにする**。左右に1行ずつ覗く余地を
 * 残すのは、前後が続いていることが見えるのが巻物の値打ちだから
 */
const pageWidth = (s: State) => {
  const fits = Math.floor(s.ctx.reader.clientWidth / s.metrics.leading) - PEEK_LINES * 2;
  return Math.max(1, Math.min(s.metrics.pageLines, fits)) * s.metrics.leading;
};

/** 隠しの形を決めるのに要る寸法 */
const geometry = (s: State): RevealGeometry => ({ full: s.full, metrics: s.metrics });

/** その文字が右から何行目にあるか。読み進むほど増えるので二分探索に使える */
const lineOf = (s: State, i: number) => {
  const rect = rangeAt(s.index, i).getBoundingClientRect();
  const left = s.ctx.body.getBoundingClientRect().left;
  return Math.max(0, Math.floor((s.full - (rect.right - left) + 1) / s.metrics.leading));
};

/** いま読んだところまでの文字数。紙面の切れ目を文字数に直す */
const readSoFar = (s: State) => {
  const lines = Math.round(s.unrolled / s.metrics.leading);
  if (lines * s.metrics.leading >= s.full) return s.index.total;
  return findFirst(s.index, (i) => lineOf(s, i) >= lines);
};

/**
 * 左の余白に出す誘いの出し入れ。
 *
 * 出し終わって、まだ先がある間だけ出す。誘いのある場所は送りの領域(画面の
 * 左3分の1)の中にあるので、そのまま押せば続きが出る
 */
const showPrompt = (s: State, on: boolean) => {
  s.prompt.hidden = !on || s.unrolled >= s.full;
};

/** 指定の位置までゆっくり滑らせる。文字出しには触らない */
const glide = (s: State, to: number) => {
  if (scrolling !== undefined) cancelAnimationFrame(scrolling);
  const { reader } = s.ctx;
  const from = reader.scrollLeft;
  const distance = to - from;
  if (Math.abs(distance) < 1) return;

  // 経過時間は performance.now() で測る。requestAnimationFrame が渡す時刻は
  // 基準が違うことがあり、混ぜると開始直後の経過が負になって動き出さない
  const started = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - started) / GLIDE_MS);
    reader.scrollLeft = from + distance * easeInOut(t);
    if (t < 1) scrolling = requestAnimationFrame(tick);
    else scrolling = undefined;
  };
  scrolling = requestAnimationFrame(tick);
};

/** 枠と組みを、いまの画面に合わせて測り直す */
const fit = (s: State) => {
  const { reader, body } = s.ctx;

  const frame = frameHeight();
  reader.style.height = `${frame}px`;

  const readerStyle = getComputedStyle(reader);
  const available =
    frame - parseFloat(readerStyle.paddingTop) - parseFloat(readerStyle.paddingBottom);
  s.roll.style.height = `${available}px`;

  s.metrics = measure(body, available);
  body.style.inlineSize = `${s.metrics.lineLength + s.metrics.padding}px`;

  // 左右の余白は、いまの紙面が画面の中央に来る幅にする。
  // 読んだ紙面ぶんしか巻いていないので、いまの紙面は本文の左端にあたる。
  // 左右をこの幅にすると、スクロール位置が0のとき中央にそろう
  const side = Math.max(0, (reader.clientWidth - pageWidth(s)) / 2);
  reader.style.paddingInline = `${side}px`;
  reader.style.setProperty("--side", `${side}px`); // 誘いを置く幅

  // 本文全体の長さ。.roll の幅では抑えられないよう max-content にしてある
  s.full = body.getBoundingClientRect().width;
  s.unrolled = Math.min(s.unrolled, s.full);
  s.roll.style.width = `${s.unrolled}px`;

  // 組み直したら、読んだところはすべて出ている状態にそろえる
  s.revealer.jumpTo(readSoFar(s), geometry(s));
  showPrompt(s, true);
};

/**
 * 先へ送る。
 *
 * 巻物は右端が作品の先頭で、進むほど左へ動く。.roll を伸ばすと本文が左へ現れ、
 * それだけで先へ進む。ただし急に切り替わるので、伸ばしたあとで見え方を一度
 * 元に戻し、そこへ滑らせる。幅そのものを動かすと、巨大な本文の再レイアウトが
 * 毎フレーム走ってしまう。
 */
const advance = (s: State) => {
  const { reader } = s.ctx;

  // 戻って読んでいた場合は、まずいまの紙面まで戻す。そこは出し終わっている
  if (reader.scrollLeft > 1) {
    glide(s, Math.max(0, reader.scrollLeft - pageWidth(s)));
    return;
  }
  if (s.unrolled >= s.full) return;

  const before = reader.scrollLeft;
  const grew = Math.min(s.full, s.unrolled + pageWidth(s)) - s.unrolled;
  // まだ出し終えていなくても、送られたらいまの紙面は読み終えたものとして扱う。
  // 途中から続けると、中央に来た新しい紙面が空のままになる
  const wasRead = readSoFar(s);
  s.unrolled += grew;
  s.roll.style.width = `${s.unrolled}px`;

  reader.scrollLeft = before + grew; // 伸ばしたぶんを打ち消して見え方を保つ
  glide(s, before);
  showPrompt(s, false);
  s.revealer.start(wasRead, readSoFar(s), geometry(s));
};

/** 前の紙面へ。読んだ範囲は縮めないので、出し直さない */
const back = (s: State) => {
  glide(s, s.ctx.reader.scrollLeft + pageWidth(s));
};

export const scrollXMode: ReaderMode = {
  id: "vertical-scroll-x",
  vertical: true,

  mount(ctx) {
    const { reader, body } = ctx;

    const roll = document.createElement("div");
    roll.className = "roll";
    reader.insertBefore(roll, body);
    roll.append(body);

    const prompt = document.createElement("p");
    prompt.className = "prompt";
    prompt.innerHTML = '<span class="label">クリックで続き</span>';
    prompt.hidden = true;
    reader.append(prompt);

    const index = buildIndex(body);
    const s: State = {
      ctx,
      roll,
      prompt,
      index,
      revealer: new Revealer(body, index, () => showPrompt(s, true)),
      metrics: measure(body, frameHeight()),
      unrolled: 0,
      full: 0,
    };
    state = s;

    // 巻き広げる前の長さが要るので、いったん抑えずに測る
    roll.style.width = "";
    fit(s);
    s.unrolled = Math.min(s.full, pageWidth(s)); // 最初は1紙面ぶん
    roll.style.width = `${s.unrolled}px`;
    reader.scrollLeft = reader.scrollWidth;

    // 開いた最初の紙面も、何も無いところから読む順に出していく
    showPrompt(s, false);
    s.revealer.start(0, readSoFar(s), geometry(s));

    detachInput = attachTurnZones({
      reader,
      go: (side) => (side === "next" ? advance(s) : back(s)),
    });
  },

  unmount({ reader, body }) {
    detachInput?.();
    detachInput = null;
    if (scrolling !== undefined) cancelAnimationFrame(scrolling);
    scrolling = undefined;

    if (state) {
      state.revealer.clear();
      // 本文を巻物の外へ戻してから、巻物ごと片付ける
      reader.insertBefore(body, state.roll);
      state.roll.remove();
      state.prompt.remove();
      state = null;
    }

    reader.style.removeProperty("height");
    reader.style.removeProperty("padding-inline");
    reader.style.removeProperty("--side");
    body.style.removeProperty("inline-size");
  },

  resize() {
    if (state) fit(state);
  },
};
