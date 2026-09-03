import type { Metrics } from "./metrics";
import { charAt, rangeAt, type TextIndex } from "./text-index";

/**
 * 本文を読む順に出していく。上から下、下まで行ったら左の行へ。
 *
 * **文字を後から足しているのではなく、組み終わった本文を隠している。**
 * 本文は全文を組まないと行の位置が決まらないので、要素を1文字ずつ足す作りには
 * できない(長編で数万個の要素になり、ルビの組みも壊れる)。
 *
 * 縦書きの1行は縦の帯なので、行の途中まで出すと表示済みの形が長方形にならない。
 * 出し終わった行の四角に、いま出している行の上半分が乗った形になる。
 *
 * ```
 *  ┌────┬──────┐
 *  │    │▓▓▓▓▓▓│  出し終わった行
 *  ├──┐ │▓▓▓▓▓▓│
 *  │▓▓│ │▓▓▓▓▓▓│  いま出している行(上から下へ下りる)
 *  └──┴─┴──────┘
 * ```
 *
 * 詳細は docs/viewer-design.md「文字を読む順に出す」。
 */

/** 文字が1つ出るまでの時間。巻物を繰る所作に合わせてゆったり出す */
const MS_PER_CHAR = 80;

/** 句読点と段落の切れ目で置く間。文字何個ぶん待つかで持つ */
const PAUSE_COMMA = 2;
const PAUSE_PERIOD = 6;
const PAUSE_PARAGRAPH = 10;

/** 隠しの形を決めるのに要る、そのときの組みの寸法 */
export type RevealGeometry = {
  /** 本文の全長(行が並ぶ向きの長さ) */
  full: number;
  metrics: Metrics;
};

/**
 * 段落の最後にあたる文字を数える。
 * 文字そのものからは分からないので、始めに一度だけ数える(段落の数ぶん)。
 */
const findParagraphEnds = (index: TextIndex) => {
  const ends = new Set<number>();
  let previous: Element | null = null;
  for (let k = 0; k < index.nodes.length; k++) {
    const block = index.nodes[k]!.parentElement?.closest("p, h2, h3, h4") ?? null;
    if (k > 0 && block !== previous) ends.add(index.starts[k]! - 1);
    previous = block;
  }
  if (index.total > 0) ends.add(index.total - 1);
  return ends;
};

export class Revealer {
  private shown = 0;
  private target = 0;
  private dueAt = 0;
  private frame: number | undefined;
  private geometry: RevealGeometry | undefined;
  private readonly paragraphEnds: Set<number>;

  constructor(
    private readonly body: HTMLElement,
    private readonly index: TextIndex,
    /** 出し終わったときに呼ぶ */
    private readonly onDone?: () => void,
  ) {
    this.paragraphEnds = findParagraphEnds(index);
  }

  /** from から to まで、読む順に出していく */
  start(from: number, to: number, geometry: RevealGeometry) {
    this.stop();
    this.geometry = geometry;
    this.shown = from;
    this.target = to;
    this.apply();
    if (from >= to) {
      this.onDone?.();
      return;
    }
    this.dueAt = performance.now() + this.waitBeforeNext();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** そこまで出した状態にする。組み直したときなど */
  jumpTo(count: number, geometry: RevealGeometry) {
    this.stop();
    this.geometry = geometry;
    this.shown = count;
    this.apply();
  }

  stop() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  /** 隠しを外す。モードを離れるとき */
  clear() {
    this.stop();
    this.body.style.removeProperty("clip-path");
  }

  private readonly tick = () => {
    const now = performance.now();
    // 出せるだけ出す。フレームが飛んでも取りこぼさない
    while (this.shown < this.target && now >= this.dueAt) {
      this.shown++;
      this.dueAt += this.waitBeforeNext();
    }
    this.apply();
    if (this.shown < this.target) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.frame = undefined;
      this.onDone?.();
    }
  };

  /**
   * 次の1文字を出すまでの待ち時間。
   *
   * 割合で動かすと途中で間を変えられない。次を出す時刻を持って進めれば、
   * 文字ごとに待ち時間を変えられる。積算表も二分探索も要らない。
   */
  private waitBeforeNext() {
    const previous = this.shown - 1;
    if (previous < 0) return MS_PER_CHAR;
    let extra = 0;
    if (this.paragraphEnds.has(previous)) extra = PAUSE_PARAGRAPH;
    else {
      const ch = charAt(this.index, previous);
      if (ch === "。" || ch === "！" || ch === "？") extra = PAUSE_PERIOD;
      else if (ch === "、") extra = PAUSE_COMMA;
    }
    return MS_PER_CHAR * (1 + extra);
  }

  /** 表示済みの範囲を本文に切り取りとして掛ける */
  private apply() {
    if (!this.geometry) return;
    const { full, metrics } = this.geometry;
    const next = Math.floor(this.shown); // 次に出す文字。ここが境目になる
    if (next >= this.index.total) {
      this.body.style.removeProperty("clip-path");
      return;
    }

    const box = this.body.getBoundingClientRect();
    const rect = rangeAt(this.index, next).getBoundingClientRect();
    const line = Math.max(
      0,
      Math.floor((full - (rect.right - box.left) + 1) / metrics.leading),
    );
    const down = Math.max(0, rect.top - box.top); // その行を上からどこまで出したか

    const head = full - (line + 1) * metrics.leading; // 出している途中の行の左端
    const done = full - line * metrics.leading; // 出し終わった行の左端
    const bottom = metrics.lineLength;

    this.body.style.clipPath =
      `polygon(${head}px 0, ${full}px 0, ${full}px ${bottom}px, ` +
      `${done}px ${bottom}px, ${done}px ${down}px, ${head}px ${down}px)`;
  }
}
