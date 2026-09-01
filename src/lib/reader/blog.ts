import type { ReaderMode } from "./mode";

/**
 * ブログ: 横書き・縦スクロール。通常のWebページと同じ読み方。
 *
 * 体裁は CSS(BlogMode.astro)だけで決まるため、ここでやるのは位置合わせのみ。
 */
export const blogMode: ReaderMode = {
  id: "horizontal",

  mount() {
    window.scrollTo(0, 0);
  },

  unmount() {
    // インラインスタイルを付けていないので戻すものがない
  },
};
