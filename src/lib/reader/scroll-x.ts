import type { ModeContext, ReaderMode } from "./mode";

/**
 * 巻物: 縦書き・横スクロール。
 *
 * 枠を画面に固定し、その中で本文が右から左へ一列に伸びる。
 * 枠の高さがそのまま1行の長さになるので、実測して入れる必要がある。
 */

/** 枠の高さと1行の長さを、いまの画面に合わせて入れ直す */
const fit = ({ reader, body }: ModeContext) => {
  // ヘッダーの高さは CSS の固定値だと実際とずれるため、その都度測る
  const chrome = document.querySelector<HTMLElement>(".chrome");
  const frameHeight = window.innerHeight - (chrome?.offsetHeight ?? 0);
  reader.style.height = `${frameHeight}px`;

  // 枠の余白を引いた残りが、本文の使える高さ
  const readerStyle = getComputedStyle(reader);
  const available =
    frameHeight - parseFloat(readerStyle.paddingTop) - parseFloat(readerStyle.paddingBottom);

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
};

/**
 * 画面の左右クリックで送る量。見えている幅に対する割合。
 *
 * 巻物はページの区切りを持たないので、きりのよい単位に合わせる必要がない。
 * 1画面ぶん動かすと読んでいた行が消えるため、少し重ねて残す。
 */
const STEP_RATIO = 0.8;

// 付け外しできるよう参照を持っておく。モードは1つしか動かないのでモジュールに置く
let onMove: ((e: MouseEvent) => void) | null = null;
let onClick: ((e: MouseEvent) => void) | null = null;

export const scrollXMode: ReaderMode = {
  id: "vertical-scroll-x",

  mount(ctx) {
    fit(ctx);
    const { reader } = ctx;
    // 縦書きは右から左へ進むので、スクロール範囲の右端(最大値)が作品の先頭
    reader.scrollLeft = reader.scrollWidth;

    // いま左右どちら側にいるかを持たせる。カーソルの向きは CSS が決める
    onMove = (e) => {
      const box = reader.getBoundingClientRect();
      reader.dataset.side = e.clientX < box.left + box.width / 2 ? "next" : "prev";
    };

    onClick = (e) => {
      // リンクと、文字を選ぼうとしている操作は邪魔しない
      if ((e.target as Element).closest("a")) return;
      if (window.getSelection()?.toString()) return;

      // 先へ進むほど左へ動く。つまり scrollLeft は減る
      const forward = reader.dataset.side === "next";
      reader.scrollBy({
        left: reader.clientWidth * STEP_RATIO * (forward ? -1 : 1),
        behavior: "smooth",
      });
    };

    reader.addEventListener("mousemove", onMove);
    reader.addEventListener("click", onClick);
  },

  unmount({ reader, body }) {
    if (onMove) reader.removeEventListener("mousemove", onMove);
    if (onClick) reader.removeEventListener("click", onClick);
    onMove = null;
    onClick = null;
    delete reader.dataset.side;

    reader.style.removeProperty("height");
    body.style.removeProperty("inline-size");
  },

  resize: fit,
};
