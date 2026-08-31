/**
 * 索引データの参照。
 *
 * 作品は ID でシャーディングされているため、該当する 1 ファイルだけを読む。
 * 人物はブラウジング用に 1 ファイルにまとまっており、ビルド時にのみ読む。
 * 生成は scripts/update-index.ts、設計は docs/design.md「メタデータ索引」。
 */

export type Contributor = { personId: string; role: string };

export type Work = {
  id: string;
  title: string;
  titleKana: string;
  sortKana: string;
  contributors: Contributor[];
  sourceUrl: string;
  cardUrl: string;
};

export type Person = {
  id: string;
  name: string;
  nameKana: string;
  sortKana: string;
};

/** 作品IDの下2桁。scripts/update-index.ts と同じ規則 */
const SHARD_DIGITS = 2;

/** シャードは import.meta.glob で束ねる。参照されたものだけが読み込まれる */
const shards = import.meta.glob<Record<string, Work>>("../../data/index/works/*.json", {
  import: "default",
});

function shardOf(workId: string): string {
  return workId.slice(-SHARD_DIGITS).padStart(SHARD_DIGITS, "0");
}

export async function findWork(workId: string): Promise<Work | null> {
  const loader = shards[`../../data/index/works/${shardOf(workId)}.json`];
  if (!loader) return null;
  const entries = await loader();
  return entries[workId] ?? null;
}

/** 著者(役割フラグが「著者」)の人物IDを返す */
export function authorsOf(work: Work): string[] {
  return work.contributors.filter((c) => c.role === "著者").map((c) => c.personId);
}
