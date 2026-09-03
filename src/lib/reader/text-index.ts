/**
 * 本文の文字を通し番号で引くための索引。
 *
 * 読書位置はページ番号やスクロール量ではなく、本文中の位置で覚える。
 * 文字や画面の大きさが変わると組み方ごと変わるため、表示側の数字はそのたびの
 * 結果でしかない。詳細は docs/viewer-design.md「読書位置の持ち方」。
 *
 * ページと縦段組が同じ換算を使う。片方だけ直すと組み替え後の戻り先がずれるため、
 * ここに一本化する。
 */

export type TextIndex = {
  nodes: Text[];
  /** nodes[k] の先頭が通し番号のいくつ目か */
  starts: number[];
  total: number;
};

/** 本文の文字を読み順に並べる。ルビは親文字の脇に出るので読み順には含めない */
export const buildIndex = (root: HTMLElement): TextIndex => {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    if (!t.data.trim() || t.parentElement?.closest("rt")) continue;
    nodes.push(t);
    starts.push(total);
    total += t.data.length;
  }
  return { nodes, starts, total };
};

/** 通し番号の文字そのもの。位置が要らないときは Range を作らずに済む */
export const charAt = ({ nodes, starts }: TextIndex, i: number) => {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= i) lo = mid;
    else hi = mid - 1;
  }
  return nodes[lo]!.data[i - starts[lo]!] ?? "";
};

/**
 * 通し番号の文字を指す Range。
 *
 * 段や紙面をまたぐ段落に getBoundingClientRect() を使うと全断片を覆う矩形が
 * 返る。文字1つの Range なら必ず1つの断片に収まる。
 */
export const rangeAt = ({ nodes, starts }: TextIndex, i: number) => {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= i) lo = mid;
    else hi = mid - 1;
  }
  const node = nodes[lo]!;
  const offset = Math.min(i - starts[lo]!, node.data.length - 1);
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  return range;
};

/**
 * 条件を満たす最初の文字を探す。
 *
 * 文字は読み順に沿って必ず後の紙面・後の帯へ進み、前に戻らない。この単調さが
 * あるので全文を走らずに二分探索できる。7万字でも十数回の測定で済む。
 *
 * 渡す条件も単調でなければならない。紙面や帯の番号はよいが、画面上の縦位置は
 * 行ごとに上へ戻るため使えない。
 */
export const findFirst = (index: TextIndex, reached: (i: number) => boolean) => {
  let lo = 0;
  let hi = index.total - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (reached(mid)) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
};
