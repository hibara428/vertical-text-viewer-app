/**
 * 組みの寸法。全モードが同じ測り方をする。
 *
 * 縦書きでは軸が入れ替わる。1行の長さは inline方向(＝縦)、行が並ぶのは
 * block方向(＝横)。どの寸法も整数倍に丸めないと、行末や紙面の端に文字の
 * 入らない半端が残る。
 */

/**
 * 画面の高さ。アドレスバーが出ている状態の高さ(svh)で測る。
 *
 * スマホのブラウザは、下へスクロールするとアドレスバーが隠れ、上へ戻すと
 * 出てくる。そのたびに window.innerHeight が60〜100px変わるので、それを使うと
 * **読者が指を動かしただけで紙面が組み直される**。実測では高さ64pxの違いで
 * 1行36字→32字、総ページ25→27と変わり、巻物では文字出しが打ち切られた。
 *
 * svh はバーが出ている(＝画面が最も狭い)ときの高さなので、伸縮しても変わらない。
 * バーが隠れているあいだは下に少し余るが、組み直しは起きない。
 * PCでは dvh と同じ値になるので、これまでと変わらない。
 */
let probe: HTMLElement | null = null;
const screenHeight = () => {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;inline-size:0;block-size:100svh;visibility:hidden;pointer-events:none";
    document.body.append(probe);
  }
  // svh を解さないブラウザでは高さが出ないので、そのときは従来どおり
  return probe.getBoundingClientRect().height || window.innerHeight;
};

/** ヘッダーを除いた、読書に使える画面の高さ */
export const frameHeight = () => {
  // ヘッダーの高さは CSS の固定値だと実際とずれるため、その都度測る
  const chrome = document.querySelector<HTMLElement>(".chrome");
  return screenHeight() - (chrome?.offsetHeight ?? 0);
};

/**
 * 段組みに持たせる余裕(px)。
 *
 * 紙面の幅を「N行ぶん」ちょうどにすると、最後の1行が入らないことがある。
 * 宣言上の行送り(line-height)と実際の行の間隔は端数まで一致せず、実測では
 * 34.2px に対して 34.187px だった。20行で 0.25px しか余らないので、断片の
 * 切れ目で端数が乗ると溢れる。1行より十分小さい余裕を足せば、N行は必ず入り、
 * N+1行が紛れ込むこともない。
 */
export const FIT_SLACK = 2;

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
