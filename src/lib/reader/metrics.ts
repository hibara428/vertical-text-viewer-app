/**
 * 組みの寸法。全モードが同じ測り方をする。
 *
 * 縦書きでは軸が入れ替わる。1行の長さは inline方向(＝縦)、行が並ぶのは
 * block方向(＝横)。どの寸法も整数倍に丸めないと、行末や紙面の端に文字の
 * 入らない半端が残る。
 */

/** ヘッダーを除いた、読書に使える画面の高さ */
export const frameHeight = () => {
  // ヘッダーの高さは CSS の固定値だと実際とずれるため、その都度測る
  const chrome = document.querySelector<HTMLElement>(".chrome");
  return window.innerHeight - (chrome?.offsetHeight ?? 0);
};

export type Metrics = {
  /** 字送り。1文字が進む量(縦書きでは縦) */
  advance: number;
  /** 行送り。行から行への刻み(縦書きでは横) */
  leading: number;
  /** 1行の長さ。字送りの整数倍に丸めてある */
  lineLength: number;
  /** 1紙面の行数 */
  pageLines: number;
  /** 本文自身の余白。box-sizing: border-box のため寸法に含める */
  padding: number;
};

/**
 * 本文の組みを測る。
 *
 * @param available 1行に使える長さ(枠の高さから上下の余白を引いたもの)
 */
export const measure = (body: HTMLElement, available: number): Metrics => {
  const style = getComputedStyle(body);
  const padding =
    parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd);
  // 字間があるぶん font-size より広い。未指定だと "normal" が返るので 0 に倒す
  const advance = parseFloat(style.fontSize) + (parseFloat(style.letterSpacing) || 0);
  return {
    advance,
    leading: parseFloat(style.lineHeight),
    // 字送りの整数倍にそろえないと、行末に半端な余りが出て文字が切れる
    lineLength: Math.floor((available - padding) / advance) * advance,
    pageLines: parseFloat(style.getPropertyValue("--page-lines")) || 20,
    padding,
  };
};
