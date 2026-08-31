/**
 * 青空文庫の本文取得。
 *
 * 公式サイトが配布する zip を取得し、展開して UTF-8 のテキストにする。
 * Web標準APIのみで完結するため Cloudflare Workers 上でも動作する。
 * 詳細は docs/design.md「本文の取得」を参照。
 */

/** ZIP のローカルファイルヘッダの署名 */
const LOCAL_FILE_HEADER = 0x04034b50;

export type FetchResult = {
  /** UTF-8 に変換した本文 */
  text: string;
  /** zip 内のファイル名 */
  fileName: string;
  /** 取得した zip のバイト数 */
  zipBytes: number;
};

/**
 * 青空文庫のサーバは User-Agent の無いリクエストを受け付けない。
 * 加えて、どこからのアクセスかを名乗るのは外部サイトを利用する側の礼儀でもある。
 */
const USER_AGENT = "vertical-text-viewer-app (+https://github.com/hibara428/vertical-text-viewer-app)";

export async function fetchWorkText(zipUrl: string): Promise<FetchResult> {
  const res = await fetch(zipUrl, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`本文の取得に失敗しました (${res.status}): ${zipUrl}`);
  }
  const zip = new Uint8Array(await res.arrayBuffer());
  const { bytes, fileName } = await extractSingleFile(zip);
  return { text: decodeShiftJis(bytes), fileName, zipBytes: zip.length };
}

/**
 * zip から最初の 1 ファイルを取り出す。
 * 青空文庫の zip は 1 ファイル構成なので、ローカルファイルヘッダだけ読めば足りる。
 */
async function extractSingleFile(
  zip: Uint8Array,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER) {
    throw new Error("zip 形式ではありません");
  }

  const method = view.getUint16(8, true);
  const compressedSize = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);

  const fileName = decodeShiftJis(zip.subarray(30, 30 + nameLength));
  const start = 30 + nameLength + extraLength;
  const body = zip.subarray(start, start + compressedSize);

  if (method === 0) return { bytes: body, fileName }; // 無圧縮
  if (method !== 8) throw new Error(`未対応の圧縮方式です: ${method}`);

  const stream = new Blob([body as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { bytes, fileName };
}

/**
 * 青空文庫のテキストは Shift_JIS。
 * TextDecoder が shift_jis を扱えない実行環境に備えて、素性を明示して失敗させる。
 */
function decodeShiftJis(bytes: Uint8Array): string {
  try {
    return new TextDecoder("shift_jis").decode(bytes);
  } catch (cause) {
    throw new Error("この実行環境では Shift_JIS のデコードができません", { cause });
  }
}
