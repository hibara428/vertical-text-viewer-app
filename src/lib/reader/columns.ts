import { FIT_SLACK, frameHeight, measure } from "./metrics";
import type { ModeContext, ReaderMode } from "./mode";
import { buildIndex, findFirst, rangeAt, type TextIndex } from "./text-index";

/**
 * 縦段組: 縦書き・縦スクロール。
 *
 * 縦書きの列を画面の幅で折り返し、折り返した「帯」を上から下へ積む。
 * 段組みはページモードと同じで、違うのは見せ方だけ。1帯だけ窓に映す代わりに、
 * 積まれた帯をそのままページのスクロールで見せる。
 *
 * このモードには固有の問題がある。**縦書きの帯は途中で切れると1行も読めない。**
 * 横書きなら切れるのは端の行だけだが、縦書きの帯は全部の行が同じ高さで切れる。
 * 対策として、帯2つぶんが画面に収まる大きさにしている。帯の始まりは
 * (帯の高さ + 間隔) ごとに並ぶので、画面がその2つぶんあれば、どこでスクロールを
 * 止めても必ずどれか1帯が丸ごと入る。
 *
 * 設計は docs/viewer-design.md「縦段組モードの設計」。
 */

type State = {
  ctx: ModeContext;
  index: TextIndex;
  /** 帯の高さ(＝1行の字詰め) */
  bandH: number;
  /** 帯と帯のあいだ */
  gap: number;
  bands: number;
  /**
   * いま画面の上にある帯の先頭の文字。組み直したあと、この文字が入る帯へ戻す。
   *
   * 更新するのは読者がスクロールしたときだけにする。組み直しのたびに取り直すと、
   * そのたびに帯の先頭へ丸められ、積み重なって少しずつ手前へずれていく。
   */
  anchor: number;
};

let state: State | null = null;

/**
 * 組み直しの最中は、アンカーを取り直さないための目印。
 *
 * 画面や文字の大きさが変わると、ブラウザはこちらが測り直すより先に組み直す。
 * その拍子にスクロールが動いて scroll が飛ぶが、その時点の帯の高さはまだ
 * 古いままなので、そこでアンカーを取ると出鱈目な位置になる。
 * だから合図を受けた瞬間に立てて、動きが収まってから下ろす。
 */
let restoring = false;
let onScroll: (() => void) | null = null;
let onResize: (() => void) | null = null;
let settling: number | undefined;

/** ヘッダーの下端。ここが読める範囲の上端になる */
const viewTop = () =>
  document.querySelector<HTMLElement>(".chrome")?.getBoundingClientRect().bottom ?? 0;

/**
 * 本文の上端。画面座標で扱う。
 *
 * 文書座標(rect.top + window.scrollY)は使わない。本文が短くなると
 * ブラウザがスクロール位置を切り詰めるが、そのとき scrollY と実際の描画位置が
 * 食い違い、足し合わせた値が狂う。文字を小さくしたときだけ位置を見失っていた。
 * 画面座標どうしなら同じ瞬間の値なので、この食い違いが起きない。
 */
const contentTop = (s: State) => s.ctx.body.getBoundingClientRect().top;

/**
 * 本文の上端から測った位置 → 帯番号。
 *
 * 1px の余裕を見る。スクロール量は端数が丸められるため、帯の先頭にぴったり
 * 合わせたつもりでも僅かに足りないことがあり、そのまま切り捨てると1つ手前の
 * 帯を指す。帯の中で文字が占めるのは高さの一部で、次の帯までには間隔ぶんの
 * 余白があるので、1px 足しても隣の帯に転ぶことはない。
 */
const bandAt = (s: State, offset: number) =>
  Math.max(0, Math.floor((offset + 1) / (s.bandH + s.gap)));

/**
 * 位置 → 帯番号。
 *
 * 二分探索に使うので単調でなければならない。画面上の縦位置は行ごとに上へ戻るが、
 * 帯番号は読み進むほど必ず増えるので使える。
 */
const bandOf = (s: State, i: number) =>
  bandAt(s, rangeAt(s.index, i).getBoundingClientRect().top - contentTop(s));

/** いま画面の上端にある帯の番号 */
const bandAtTop = (s: State) => bandAt(s, viewTop() - contentTop(s));

/** 帯の先頭を画面の上端に合わせる。画面座標で出した差だけ動かす */
const showBand = (s: State, band: number) => {
  const at = Math.min(Math.max(band, 0), s.bands - 1);
  window.scrollBy(0, contentTop(s) + at * (s.bandH + s.gap) - viewTop());
};

/** いまの画面に合わせて帯の大きさを決め、段組みを組み直す */
const layout = (s: State) => {
  const { reader, body } = s.ctx;
  const rs = getComputedStyle(reader);
  const bs = getComputedStyle(body);

  const gap = parseFloat(bs.columnGap) || 0;
  const visible = parseFloat(bs.getPropertyValue("--visible-bands")) || 2;

  // 帯の高さ(＝字詰め)。画面に帯が指定数ぶん収まる大きさにする。
  // 上下の余白は巻きはじめと巻きおわりにしか出ないので、ここでは引かない
  const screen = frameHeight();
  const { advance, leading } = measure(body, screen);
  const bandH = Math.floor((screen - gap * (visible - 1)) / visible / advance) * advance;

  // 帯の幅(＝行数)。画面の幅を使い切ると文字が端まで届くので、本文の読みやすい
  // 幅(--measure)で頭打ちにする。ページ・ブログと同じ幅になり、余ったぶんは
  // CSS の margin: 0 auto が左右へ振り分ける
  const room = reader.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight);
  const readable = parseFloat(bs.getPropertyValue("--measure")) * parseFloat(bs.fontSize);
  const bandW = Math.floor(Math.min(room, readable || room) / leading) * leading;

  // 1回目。高さを1帯ぶんにして組み、溢れた分から帯の数を知る。
  // 帯が何本になるかは組んでみないと分からないので、二度組むしかない
  body.style.overflow = "hidden";
  // 帯にも少し余裕を持たせる。ちょうどだと最後の1行が入らない帯ができる
  body.style.blockSize = `${bandW + FIT_SLACK}px`;
  body.style.inlineSize = `${bandH}px`;
  body.style.columnWidth = `${bandH}px`;
  body.style.removeProperty("column-count");
  const stacked = body.scrollHeight;
  const bands = Math.max(1, Math.round((stacked + gap) / (bandH + gap)));

  // 2回目。全帯ぶんの高さで組み直す。帯の数は分かっているので column-count で
  // 確定させる。column-width は目安でしかなく、丸めで段が増減しうるため
  body.style.removeProperty("overflow");
  body.style.removeProperty("column-width");
  body.style.inlineSize = `${bands * bandH + (bands - 1) * gap}px`;
  body.style.columnCount = `${bands}`;

  s.bandH = bandH;
  s.gap = gap;
  s.bands = bands;
};

export const columnsMode: ReaderMode = {
  id: "vertical-columns",
  vertical: true,

  mount(ctx) {
    const s: State = {
      ctx,
      index: buildIndex(ctx.body),
      bandH: 1,
      gap: 0,
      bands: 1,
      anchor: 0,
    };
    state = s;
    layout(s);
    window.scrollTo(0, 0);

    // 読者が動いたときだけ、読んでいる場所を覚え直す
    onScroll = () => {
      clearTimeout(settling);
      if (restoring) {
        // 組み直しに伴う移動。止まってから覚え直しを再開する。
        // 一定時間で解除すると、内容が短くなって位置が頭打ちになったときの
        // 後追いのスクロールを読者の操作と取り違え、アンカーが手前へずれる
        settling = window.setTimeout(() => {
          restoring = false;
        }, 200);
        return;
      }
      settling = window.setTimeout(() => {
        s.anchor = findFirst(s.index, (i) => bandOf(s, i) >= bandAtTop(s));
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // 組み直しの合図。Reader 側は間を置いてから resize() を呼ぶが、ブラウザの
    // 組み直しはその前に済んでいる。取り直しを止めるのはここで間に合わせる
    onResize = () => {
      restoring = true;
      clearTimeout(settling);
    };
    window.addEventListener("resize", onResize);
  },

  unmount({ body }) {
    if (onScroll) window.removeEventListener("scroll", onScroll);
    if (onResize) window.removeEventListener("resize", onResize);
    onScroll = null;
    onResize = null;
    clearTimeout(settling);
    restoring = false;
    state = null;
    for (const p of ["overflow", "block-size", "inline-size", "column-width", "column-count"]) {
      body.style.removeProperty(p);
    }
  },

  /**
   * 組み直すと帯の割れ方が変わるため、スクロール量は当てにならない。
   * 画面の上にあった帯の先頭の文字を覚えておき、その文字が入る帯へ戻す。
   */
  resize() {
    const s = state;
    if (!s) return;

    // ここでのスクロールでアンカーを取り直さないようにしてから動かす。
    // 解除はスクロールが止まってから(onScroll が行う)。移動が起きなかった
    // ときのために、ここでも保険の解除を仕掛けておく
    restoring = true;
    clearTimeout(settling);
    layout(s);
    showBand(s, bandOf(s, s.anchor));
    settling = window.setTimeout(() => {
      restoring = false;
    }, 200);
  },
};
