/**
 * 送りの操作。
 *
 * 画面を横に三分割し、左で先へ、右で前へ送る。真ん中は送らず、文字を選ぶための
 * 場所として空けておく。縦書きは右から左へ進むので、左が「先へ」になる。
 *
 * ページと巻物が同じ操作を持つ。片方だけ直すと操作感がずれるため一本化する。
 * **スマホでは操作がまるごと入れ替わる。** 触る操作を足すのはこのファイル。
 * 各モードは「先へ」「前へ」を受け取るだけで、押され方を知らなくてよい。
 */

/** どちら側にいるか。カーソルの向きは CSS がこれを見て決める */
export type Side = "next" | "prev";

type Options = {
  /** 送りの操作を受ける枠 */
  reader: HTMLElement;
  go: (side: Side) => void;
};

/** 取り付けて、外すための関数を返す */
export const attachTurnZones = ({ reader, go }: Options) => {
  const sideAt = (clientX: number): Side | undefined => {
    const box = reader.getBoundingClientRect();
    const at = (clientX - box.left) / box.width;
    if (at < 1 / 3) return "next";
    if (at > 2 / 3) return "prev";
    return undefined;
  };

  const onMove = (e: MouseEvent) => {
    const side = sideAt(e.clientX);
    if (side) reader.dataset.side = side;
    else delete reader.dataset.side;
  };

  // 送る場所でだけ、2回目以降の押下の既定動作(単語選択)を止める。
  // click 自体は発生するので、連打はそのまま連続の送りになる。
  // 真ん中はダブルクリックで単語を選べるまま残す
  const onDown = (e: MouseEvent) => {
    if (reader.dataset.side && e.detail >= 2) e.preventDefault();
  };

  const onClick = (e: MouseEvent) => {
    // リンクと、文字を選ぼうとしている操作は邪魔しない
    if ((e.target as Element).closest("a")) return;
    if (window.getSelection()?.toString()) return;
    const side = reader.dataset.side as Side | undefined;
    if (side) go(side);
  };

  reader.addEventListener("mousemove", onMove);
  reader.addEventListener("mousedown", onDown);
  reader.addEventListener("click", onClick);

  return () => {
    reader.removeEventListener("mousemove", onMove);
    reader.removeEventListener("mousedown", onDown);
    reader.removeEventListener("click", onClick);
    delete reader.dataset.side;
  };
};
