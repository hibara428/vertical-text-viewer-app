import { attachTurnZones } from "./input";
import { FIT_SLACK, frameHeight, measure } from "./metrics";
import type { ModeContext, ReaderMode } from "./mode";
import { buildIndex, findFirst, rangeAt, type TextIndex } from "./text-index";

/**
 * ページ: 縦書き・1画面ずつめくる。
 *
 * ページの切れ目はブラウザの段組みに作らせる。自前で座標を切ると、改ページ指定も
 * 見出しの取り残しも分割禁止も全部こちらで実装することになる。
 *
 * 縦書きでは段が inline方向(＝縦)に積まれるため、ページは縦に並ぶ。並ぶ向きは
 * 選べないが、窓に映るのは常に1ページなので読者には出ない。
 *
 * 設計と検証は docs/viewer-design.md「ページモードの設計」。
 */

type State = {
  ctx: ModeContext;
  /** ページ1枚ぶんに切り取る窓 */
  win: HTMLElement;
  indicator: HTMLElement;
  index: TextIndex;
  pageH: number;
  pages: number;
  page: number;
  /**
   * いま開いているページの先頭の文字。
   * 組み直しのあと、この文字が入るページへ戻る。
   *
   * ページ番号ではなく本文中の位置で覚える。文字や画面の大きさが変わると
   * ページの割れ方ごと変わるため、番号は毎回の表示結果でしかない。
   */
  anchor: number;
};

let state: State | null = null;

/** 位置 → ページ番号 */
const pageOf = (s: State, i: number) => {
  const rect = rangeAt(s.index, i).getBoundingClientRect();
  const top = rect.top - s.win.getBoundingClientRect().top + s.win.scrollTop;
  return Math.max(0, Math.floor(top / s.pageH));
};

/** ページ番号 → 位置。そのページの先頭の文字を返す */
const firstOnPage = (s: State, k: number) => findFirst(s.index, (i) => pageOf(s, i) >= k);

/** いまの画面に合わせてページの大きさを決め、段組みを組み直す */
const layout = (s: State) => {
  const { reader, body } = s.ctx;

  const frame = frameHeight();
  reader.style.height = `${frame}px`;

  const rs = getComputedStyle(reader);
  const available = frame - parseFloat(rs.paddingTop) - parseFloat(rs.paddingBottom);

  // ページの大きさは「何字 × 何行」で決める。縦書きでは軸が入れ替わるので、
  //   高さ = 字送りの整数倍 → 1行の字詰め
  //   幅   = 行送りの整数倍 → 1ページの行数
  const m = measure(body, available);
  const pageH = m.lineLength;

  // 1ページの行数。画面の残り全部を使うと紙面が横に広がり、行を追い終えて
  // 次の行へ目を戻す距離が長くなる。--page-lines を上限にする
  const room = reader.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight);
  const wanted = m.pageLines * m.leading;
  const pageW = Math.floor(Math.min(room, wanted || room) / m.leading) * m.leading;

  s.pageH = pageH;
  // 窓はページ1枚ちょうどにする。余らせると次のページの行が数px覗く
  s.win.style.width = `${pageW}px`;
  s.win.style.height = `${pageH}px`;

  // block方向(＝横)がページの幅。ここで折り返す。
  // inline方向(＝縦)がページの高さ。溢れた段は下へ積まれる。
  // 窓は N行ぶんちょうど、本文はそれより少し広くする。余裕がないと最後の
  // 1行が入らない紙面ができる。余りは紙面の奥(左端)に出るので窓が隠す
  body.style.blockSize = `${pageW + FIT_SLACK}px`;
  body.style.inlineSize = `${pageH}px`;
  body.style.columnWidth = `${pageH}px`;

  s.pages = Math.max(1, Math.round(s.win.scrollHeight / pageH));
};

/** ページkを窓に映す。位置は k の掛け算だけで決まるので、往復してもずれない */
const show = (s: State, k: number) => {
  s.page = Math.min(Math.max(k, 0), s.pages - 1);
  s.win.scrollTop = s.page * s.pageH;
  s.indicator.textContent = `${s.page + 1} / ${s.pages}`;
};

/** めくる。読み位置の覚え直しはここだけで行う */
const turn = (s: State, delta: number) => {
  const next = Math.min(Math.max(s.page + delta, 0), s.pages - 1);
  if (next === s.page) return;
  show(s, next);
  s.anchor = firstOnPage(s, s.page);
};

let detachInput: (() => void) | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;

export const pageMode: ReaderMode = {
  id: "vertical-page",
  vertical: true,

  mount(ctx) {
    const { reader, body } = ctx;

    const win = document.createElement("div");
    win.className = "page-window";
    const indicator = document.createElement("p");
    indicator.className = "page-number";

    // 本文を窓の中へ移す。全モードで同じ要素を使い回すため、複製はしない
    reader.insertBefore(win, body);
    win.append(body);
    reader.append(indicator);

    const s: State = {
      ctx,
      win,
      indicator,
      index: buildIndex(body),
      pageH: 1,
      pages: 1,
      page: 0,
      anchor: 0,
    };
    state = s;

    layout(s);
    show(s, 0);

    onKey = (e) => {
      // 縦書きの進行方向に合わせる。左が先、右が前
      const step =
        e.key === "ArrowLeft" || e.key === "PageDown" || e.key === " "
          ? 1
          : e.key === "ArrowRight" || e.key === "PageUp"
            ? -1
            : 0;
      if (!step) return;
      e.preventDefault();
      turn(s, step);
    };

    detachInput = attachTurnZones({
      reader,
      go: (side) => turn(s, side === "next" ? 1 : -1),
    });
    window.addEventListener("keydown", onKey);
  },

  unmount({ reader, body }) {
    detachInput?.();
    detachInput = null;
    if (onKey) window.removeEventListener("keydown", onKey);
    onKey = null;

    if (state) {
      // 本文を窓の外へ戻してから、窓ごと片付ける
      reader.insertBefore(body, state.win);
      state.win.remove();
      state.indicator.remove();
      state = null;
    }

    reader.style.removeProperty("height");
    for (const p of ["block-size", "inline-size", "column-width"]) {
      body.style.removeProperty(p);
    }
  },

  /**
   * 組み直すとページの割れ方が変わるため、ページ番号は当てにならない。
   * 覚えておいた文字が入るページへ移す。
   *
   * anchor はめくったときだけ更新する。組み直しのたびに取り直すと、
   * ページ先頭へ丸める分が積み重なって少しずつ手前へずれていく。
   */
  resize() {
    if (!state) return;
    layout(state);
    show(state, pageOf(state, state.anchor));
  },
};
