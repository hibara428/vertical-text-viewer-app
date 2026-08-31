/**
 * 五十音による著者ブラウジング。
 *
 * ここで使うデータはビルド時にしか読まないため、索引をまとめて読み込んでよい。
 * エッジで動く作品ページは index-lookup.ts のシャード参照を使う。
 */
import peopleJson from "../../data/index/people.json";
import type { Person, Work } from "./index-lookup";

const worksJson = import.meta.glob<Record<string, Work>>("../../data/index/works/*.json", {
  eager: true,
  import: "default",
});

/** 五十音の行。境界は濁点・半濁点まで含める(が → か行、ぽ → は行) */
export const ROWS = [
  { id: "a", label: "あ行", from: "あ", to: "お" },
  { id: "ka", label: "か行", from: "か", to: "ご" },
  { id: "sa", label: "さ行", from: "さ", to: "ぞ" },
  { id: "ta", label: "た行", from: "た", to: "ど" },
  { id: "na", label: "な行", from: "な", to: "の" },
  { id: "ha", label: "は行", from: "は", to: "ぽ" },
  { id: "ma", label: "ま行", from: "ま", to: "も" },
  { id: "ya", label: "や行", from: "や", to: "よ" },
  { id: "ra", label: "ら行", from: "ら", to: "ろ" },
  { id: "wa", label: "わ行", from: "わ", to: "ん" },
] as const;

export type Row = (typeof ROWS)[number];

export type Author = Person & { workCount: number };

const people = peopleJson as Record<string, Person>;

/** 索引全体。ビルド時にのみ構築する */
let cache: { authors: Author[]; worksByAuthor: Map<string, Work[]> } | null = null;

function load() {
  if (cache) return cache;

  const worksByAuthor = new Map<string, Work[]>();
  for (const shard of Object.values(worksJson)) {
    for (const work of Object.values(shard)) {
      for (const c of work.contributors) {
        if (c.role !== "著者") continue;
        if (!worksByAuthor.has(c.personId)) worksByAuthor.set(c.personId, []);
        worksByAuthor.get(c.personId)!.push(work);
      }
    }
  }

  for (const list of worksByAuthor.values()) {
    list.sort((a, b) => a.sortKana.localeCompare(b.sortKana, "ja"));
  }

  const authors: Author[] = [...worksByAuthor]
    .map(([id, list]) => ({ ...people[id]!, workCount: list.length }))
    .sort((a, b) => a.sortKana.localeCompare(b.sortKana, "ja"));

  cache = { authors, worksByAuthor };
  return cache;
}

export function rowOf(sortKana: string): Row | null {
  const head = sortKana[0];
  if (!head) return null;
  return ROWS.find((r) => head >= r.from && head <= r.to) ?? null;
}

/** 行ごとの著者数。トップページで件数を出すのに使う */
export function authorCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of load().authors) {
    const row = rowOf(a.sortKana);
    if (row) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  }
  return counts;
}

export function authorsInRow(rowId: string): Author[] {
  return load().authors.filter((a) => rowOf(a.sortKana)?.id === rowId);
}

export function findAuthor(personId: string): Author | null {
  return load().authors.find((a) => a.id === personId) ?? null;
}

export function worksOf(personId: string): Work[] {
  return load().worksByAuthor.get(personId) ?? [];
}

/** 作品の著者名(著者ページ以外で添えるため) */
export function authorNamesOf(work: Work): string[] {
  return work.contributors
    .filter((c) => c.role === "著者")
    .map((c) => people[c.personId]?.name ?? c.personId);
}
