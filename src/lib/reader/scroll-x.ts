import type { ModeContext, ReaderMode } from "./mode";
import { buildIndex, charAt, findFirst, rangeAt, type TextIndex } from "./text-index";

/**
 * 巻物: 縦書き・横スクロール。
 *
 * 枠を画面に固定し、その中で本文が右から左へ一列に伸びる。
 * 枠の高さがそのまま1行の長さになるので、実測して入れる必要がある。
 *
 * 送るたびに、巻き広げた長さを伸ばしていく。まだ広げていない先は行き来できず、
 * 巻き広げた範囲が画面より狭いあいだは左側が空いて見える。
 *
 * ```
 * #reader        横スクロールする枠
 * └ .roll        幅 = 巻き広げた長さ。狭いあいだは右へ寄る
 *   └ .body      本文全体。.roll の右端に固定し、左へ伸びる
 * ```
 */

/**
 * 1回の送りにかける時間。
 *
 * behavior: "smooth" はブラウザ任せで速く、送りが一瞬で終わって
 * 何が動いたのか追えない。巻物を手で繰る速さに寄せたいので自分で持つ。
 */
const GLIDE_MS = 900;

/**
 * 文字が1つ出るまでの時間。送りの速さとは別に持つ。
 *
 * 送りは早く終わってよいが、文字はゆっくり出したい。ひとつの時間で両方を
 * 動かすと、どちらかに引きずられる。
 *
 * 数えるのは実際の文字だけ。行末の空きや扉の余白は時間をかけずに飛ばす。
 */
const REVEAL_MS_PER_CHAR = 80;

/** 句読点と段落の切れ目で置く間。文字何個ぶん待つかで持つ */
const PAUSE_COMMA = 2;
const PAUSE_PERIOD = 6;
const PAUSE_PARAGRAPH = 10;

/**
 * 送りと文字出しは別々に動かす。
 *
 * ひとつにまとめると、戻るためにスクロールを始めただけで文字出しまで
 * 打ち切られる。読んでいる途中で前を見に行っても、文字は出続けてほしい。
 */
let scrolling: number | undefined;
let revealing: number | undefined;

/** ゆっくり動き出してゆっくり止まる */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * 送りを動かす。位置と文字の出し方を、それぞれの速さで動かす。
 *
 * 送りは短い時間で終わり、文字はそのあとも出続ける。同じ時間で動かすと
 * 境目が画面の端に貼りついて、文字が出ていく様子が見えない。
 */
/**
 * 左の余白に出す誘いの出し入れ。
 *
 * 出し終わって、まだ先がある間だけ出す。読者はそこをクリックすればよい。
 * 誘いのある場所は送りの領域(画面の左3分の1)の中にあるので、そのまま押せる
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

/** from から to まで、文字を読む順に出していく */
const reveal = (s: State, from: number, to: number) => {
  if (revealing !== undefined) cancelAnimationFrame(revealing);
  s.revealed = from;
  applyReveal(s);
  showPrompt(s, false);
  if (from >= to) {
    showPrompt(s, true);
    return;
  }

  s.dueAt = performance.now() + waitBeforeNext(s, s.revealed);
  const tick = () => {
    const now = performance.now();
    // 出せるだけ出す。フレームが飛んでも取りこぼさない
    while (s.revealed < to && now >= s.dueAt) {
      s.revealed++;
      s.dueAt += waitBeforeNext(s, s.revealed);
    }
    applyReveal(s);
    if (s.revealed < to) {
      revealing = requestAnimationFrame(tick);
    } else {
      revealing = undefined;
      showPrompt(s, true);
    }
  };
  revealing = requestAnimationFrame(tick);
};

type State = {
  ctx: ModeContext;
  roll: HTMLElement;
  /** 巻き広げた長さ */
  unrolled: number;
  /** 本文全体の長さ。これ以上は広がらない */
  full: number;

  /* 組みの寸法。文字を読む順に出すために要る */
  /** 1行の長さ(縦書きなので縦) */
  lineLength: number;
  /** 行送り(行から行への横の刻み) */
  leading: number;
  /** 字送り(1文字ぶんの縦の刻み) */
  advance: number;
  /** 1紙面の行数 */
  pageLines: number;

  /** 本文の文字を読む順に引くための索引 */
  index: TextIndex;
  /** 段落の最後にあたる文字。ここで間を置く。段落の数ぶんしかない */
  paragraphEnds: Set<number>;
  /** 次の1文字を出す時刻 */
  dueAt: number;
  /** 出し終わったときに、左の余白へ出す誘い */
  prompt: HTMLElement;
  /**
   * 読む順にどこまで出したか。**文字の数**で持つ。
   *
   * 距離で持つと、行末の空きや扉の余白にも同じ時間がかかる。文字を数えれば
   * 空白は飛ばせる。索引はページ・縦段組と同じものを使う
   */
  revealed: number;
};

let state: State | null = null;
let onMove: ((e: MouseEvent) => void) | null = null;
let onDown: ((e: MouseEvent) => void) | null = null;
let onClick: ((e: MouseEvent) => void) | null = null;

/**
 * 1紙面の幅。送りの単位でもある。
 *
 * ページモードと同じ行数(--page-lines)にしてあるので、字詰めが同じ両モードでは
 * 1紙面の分量も同じになる。段組みは使わない。横一列に伸びた本文では、
 * 紙面の切れ目は行数の掛け算だけで決まる
 */
const pageWidth = (s: State) => s.pageLines * s.leading;

/** 段落の最後にあたる文字を数えておく。文字からは分からないので一度だけ */
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

/**
 * 次の1文字を出すまでの待ち時間。
 *
 * 割合で動かすと途中で間を変えられない。次を出す時刻を持って進めれば、
 * 文字ごとに待ち時間を変えられる。積算表も二分探索も要らない。
 */
const waitBeforeNext = (s: State, revealed: number) => {
  const previous = revealed - 1;
  if (previous < 0) return REVEAL_MS_PER_CHAR;
  let extra = 0;
  if (s.paragraphEnds.has(previous)) extra = PAUSE_PARAGRAPH;
  else {
    const ch = charAt(s.index, previous);
    if (ch === "。" || ch === "！" || ch === "？") extra = PAUSE_PERIOD;
    else if (ch === "、") extra = PAUSE_COMMA;
  }
  return REVEAL_MS_PER_CHAR * (1 + extra);
};

/** その文字が右から何行目にあるか。読み進むほど増えるので二分探索に使える */
const lineOf = (s: State, i: number) => {
  const rect = rangeAt(s.index, i).getBoundingClientRect();
  const left = s.ctx.body.getBoundingClientRect().left;
  return Math.max(0, Math.floor((s.full - (rect.right - left) + 1) / s.leading));
};

/** 指定の行数ぶんに収まる文字の数。巻き広げた範囲を文字数に直すのに使う */
const charsWithin = (s: State, lines: number) =>
  lines * s.leading >= s.full ? s.index.total : findFirst(s.index, (i) => lineOf(s, i) >= lines);

/**
 * 表示済みの範囲を本文に切り取りとして掛ける。
 *
 * 縦書きの1行は縦の帯なので、行の途中まで出すと表示済みの形が長方形にならない。
 * 出し終わった行の四角に、いま出している途中の行の上半分が乗った形になる。
 *
 * ```
 *  ┌────┬──────┐
 *  │    │▓▓▓▓▓▓│  出し終わった行
 *  ├──┐ │▓▓▓▓▓▓│
 *  │▓▓│ │▓▓▓▓▓▓│  いま出している行(上から下へ下りる)
 *  └──┴─┴──────┘
 * ```
 */
const applyReveal = (s: State) => {
  const { body } = s.ctx;
  const next = Math.floor(s.revealed); // 次に出す文字。ここが境目になる
  if (next >= s.index.total) {
    body.style.removeProperty("clip-path");
    return;
  }

  const box = body.getBoundingClientRect();
  const rect = rangeAt(s.index, next).getBoundingClientRect();
  const line = Math.max(0, Math.floor((s.full - (rect.right - box.left) + 1) / s.leading));
  const down = Math.max(0, rect.top - box.top); // その行を上からどこまで出したか

  const right = s.full;
  const head = right - (line + 1) * s.leading; // 出している途中の行の左端
  const done = right - line * s.leading;       // 出し終わった行の左端
  const bottom = s.lineLength;

  body.style.clipPath =
    `polygon(${head}px 0, ${right}px 0, ${right}px ${bottom}px, ` +
    `${done}px ${bottom}px, ${done}px ${down}px, ${head}px ${down}px)`;
};

/** 枠の高さと1行の長さを、いまの画面に合わせて入れ直す */
const fit = (s: State) => {
  const { reader, body } = s.ctx;

  // ヘッダーの高さは CSS の固定値だと実際とずれるため、その都度測る
  const chrome = document.querySelector<HTMLElement>(".chrome");
  const frameHeight = window.innerHeight - (chrome?.offsetHeight ?? 0);
  reader.style.height = `${frameHeight}px`;

  // 枠の余白を引いた残りが、本文の使える高さ
  const readerStyle = getComputedStyle(reader);
  const available =
    frameHeight - parseFloat(readerStyle.paddingTop) - parseFloat(readerStyle.paddingBottom);
  s.roll.style.height = `${available}px`;

  // 縦書きでは inline 方向が縦なので、1行の長さはそちらで決まる。
  // box-sizing: border-box のため、本文自身の余白も inline-size に含める
  const bodyStyle = getComputedStyle(body);
  const padding =
    parseFloat(bodyStyle.paddingInlineStart) + parseFloat(bodyStyle.paddingInlineEnd);
  // 1文字が進む量。字間があるぶん font-size より広い。
  // letter-spacing は未指定だと "normal" が返るので 0 に倒す
  const advance =
    parseFloat(bodyStyle.fontSize) + (parseFloat(bodyStyle.letterSpacing) || 0);
  // 字送りの整数倍にそろえないと、行末に半端な余りが出て文字が切れる
  const lineLength = Math.floor((available - padding) / advance) * advance;
  body.style.inlineSize = `${lineLength + padding}px`;

  s.advance = advance;
  s.leading = parseFloat(bodyStyle.lineHeight);
  s.lineLength = lineLength;
  s.pageLines = parseFloat(bodyStyle.getPropertyValue("--page-lines")) || 20;

  // 左右の余白は、いまの紙面が画面の中央に来る幅にする。
  // 巻き広げた長さは常に「読んだ紙面ぶん」なので、いまの紙面は本文の左端に
  // あたる。左右をこの幅にすると、スクロール位置が0のとき中央にそろう
  const side = Math.max(0, (reader.clientWidth - pageWidth(s)) / 2);
  reader.style.paddingInline = `${side}px`;
  // 誘いを置く左の余白の幅。位置は CSS が決める
  reader.style.setProperty("--side", `${side}px`);

  // 本文全体の長さ。.roll の幅では抑えられないよう max-content にしてある
  s.full = body.getBoundingClientRect().width;
  s.unrolled = Math.min(s.unrolled, s.full);
  s.roll.style.width = `${s.unrolled}px`;
  // 組み直したら、巻き広げた範囲はすべて出ている状態にそろえる
  s.revealed = charsWithin(s, Math.round(s.unrolled / s.leading));
  applyReveal(s);
};

/**
 * 先へ送る。
 *
 * 巻物は右端が作品の先頭で、進むほど左へ動く。.roll を伸ばすと本文が左へ現れ、
 * それだけで先へ進む。スクロールは要らない。
 * ただし急に切り替わるので、伸ばしたあとで見え方を一度元に戻し、そこへ滑らせる。
 * 幅そのものを動かすと、巨大な本文の再レイアウトが毎フレーム走ってしまう。
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
  const wasRevealed = charsWithin(s, Math.round(s.unrolled / s.leading));
  s.unrolled += grew;
  s.roll.style.width = `${s.unrolled}px`;
  applyReveal(s); // 伸ばしても、出すのはこれから

  reader.scrollLeft = before + grew; // 伸ばしたぶんを打ち消して見え方を保つ
  glide(s, before);
  reveal(s, wasRevealed, charsWithin(s, Math.round(s.unrolled / s.leading)));
};

/** 前へ戻る。巻き広げた長さは縮めない。読んだところへは行き来できる */
/** 前の紙面へ。既に出し終わっているので出し直さない */
const back = (s: State) => {
  glide(s, s.ctx.reader.scrollLeft + pageWidth(s));
};

export const scrollXMode: ReaderMode = {
  id: "vertical-scroll-x",

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

    const s: State = {
      ctx,
      roll,
      unrolled: 0,
      full: 0,
      lineLength: 1,
      leading: 1,
      advance: 1,
      pageLines: 20,
      index: buildIndex(body),
      paragraphEnds: new Set<number>(),
      dueAt: 0,
      prompt,
      revealed: 0,
    };
    s.paragraphEnds = findParagraphEnds(s.index);
    state = s;

    // 巻き広げる前の長さが要るので、いったん抑えずに測る
    roll.style.width = "";
    fit(s);
    // 最初から画面いっぱいに広げておく。これより狭いと左に隙間ができ、
    // まだ巻いていない先との切れ目が画面の中に出て、行が途中で切れて見える
    // 最初は1紙面ぶん
    s.unrolled = Math.min(s.full, pageWidth(s));
    roll.style.width = `${s.unrolled}px`;
    reader.scrollLeft = reader.scrollWidth;

    // 開いた最初の画面も、何も無いところから読む順に出していく
    s.revealed = 0;
    applyReveal(s);
    reveal(s, 0, charsWithin(s, Math.round(s.unrolled / s.leading)));

    // 画面を横に三分割する。縦書きは右から左へ進むので、左が「先へ」、右が「前へ」。
    // 真ん中は送らずに、文字を選ぶための場所として空けておく。
    // カーソルの向きは、この data-side を見て CSS が決める
    onMove = (e) => {
      const box = reader.getBoundingClientRect();
      const at = (e.clientX - box.left) / box.width;
      if (at < 1 / 3) reader.dataset.side = "next";
      else if (at > 2 / 3) reader.dataset.side = "prev";
      else delete reader.dataset.side;
    };

    // 送る場所でだけ、2回目以降の押下の既定動作(単語選択)を止める。
    // click 自体は発生するので、連打はそのまま連続の送りになる。
    // 真ん中はダブルクリックで単語を選べるまま残す
    onDown = (e) => {
      if (reader.dataset.side && e.detail >= 2) e.preventDefault();
    };

    onClick = (e) => {
      // リンクと、文字を選ぼうとしている操作は邪魔しない
      if ((e.target as Element).closest("a")) return;
      if (window.getSelection()?.toString()) return;
      const side = reader.dataset.side;
      if (!side) return;
      if (side === "next") advance(s);
      else back(s);
    };

    reader.addEventListener("mousemove", onMove);
    reader.addEventListener("mousedown", onDown);
    reader.addEventListener("click", onClick);
  },

  unmount({ reader, body }) {
    if (onMove) reader.removeEventListener("mousemove", onMove);
    if (onDown) reader.removeEventListener("mousedown", onDown);
    if (onClick) reader.removeEventListener("click", onClick);
    onMove = null;
    onDown = null;
    onClick = null;
    if (scrolling !== undefined) cancelAnimationFrame(scrolling);
    if (revealing !== undefined) cancelAnimationFrame(revealing);
    scrolling = undefined;
    revealing = undefined;
    delete reader.dataset.side;

    if (state) {
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
    body.style.removeProperty("clip-path");
  },

  resize() {
    if (state) fit(state);
  },
};
