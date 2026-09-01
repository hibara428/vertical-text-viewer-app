/**
 * 読み方モードの共通の型。
 *
 * モードごとに markup も CSS も挙動も違うため、共有するのは本文だけにしている。
 * 共通の基底を置いて各モードが上書きする形にすると、上書き漏れがそのまま
 * 不具合になる。詳細は docs/viewer-design.md「モードごとに実装を分ける」を参照。
 */

/** モードが触ってよい要素。これ以外には手を出さない */
export type ModeContext = {
  /** ビューアの枠 */
  reader: HTMLElement;
  /** 本文。全モードで同じ要素を使い回す */
  body: HTMLElement;
};

export type ReaderMode = {
  /** data-mode の値。ボタンの識別にも使う */
  id: string;
  /** 表示を組み立て、読み始めの位置に置く */
  mount(ctx: ModeContext): void;
  /**
   * 自分が加えた変更をすべて戻す。
   * 残すと次のモードへ持ち越され、モードをまたいで不具合が漏れる。
   */
  unmount(ctx: ModeContext): void;
  /** 画面の大きさが変わったとき。測り直しが要るモードだけ実装する */
  resize?(ctx: ModeContext): void;
};
