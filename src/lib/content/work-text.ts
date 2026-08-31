/**
 * 本文の取得とキャッシュ。
 *
 * KV には「パース前の UTF-8 変換済みテキスト」を保存する。パース結果ではないため、
 * パーサーを書き換えてもキャッシュは無効化されない。
 * 詳細は docs/design.md「キャッシュ」を参照。
 */
import { fetchWorkText } from "./fetch-text";

/** wrangler.jsonc の kv_namespaces で定義したバインディング */
type WorkTextStore = {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type LoadResult = {
  text: string;
  /** キャッシュから返したか */
  cached: boolean;
  /** 取得した場合の zip バイト数。キャッシュ時は undefined */
  zipBytes?: number;
};

/**
 * 本文を返す。KV にあればそれを、無ければ取得して KV に入れる。
 *
 * KV が使えない環境(dev サーバーなど)では素通しで取得する。開発中に
 * 本文が読めなくなるより、キャッシュが効かないほうが害が小さい。
 */
export async function loadWorkText(
  workId: string,
  zipUrl: string,
  store: WorkTextStore | undefined,
): Promise<LoadResult> {
  if (store) {
    const hit = await store.get(workId, "text");
    if (hit !== null) return { text: hit, cached: true };
  }

  const fetched = await fetchWorkText(zipUrl);

  // 保存に失敗しても本文は返せるので、読者には影響させない
  if (store) {
    try {
      await store.put(workId, fetched.text);
    } catch (e) {
      console.warn(`本文をキャッシュできませんでした (${workId}):`, e);
    }
  }

  return { text: fetched.text, cached: false, zipBytes: fetched.zipBytes };
}
