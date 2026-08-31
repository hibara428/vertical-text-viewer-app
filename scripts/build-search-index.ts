/**
 * 索引データから Pagefind の検索インデックスを生成する。
 *
 *   npm run build   (build のあとに自動で走る)
 *
 * 作品ページはオンデマンド生成でビルド時に存在しないため、HTMLのクロールでは
 * なく Node API の addCustomRecord にレコードを直接渡す。
 * 詳細は docs/design.md「検索」を参照。
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";

const INDEX_DIR = fileURLToPath(new URL("../src/data/index/", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../dist/client/pagefind/", import.meta.url));

type Contributor = { personId: string; role: string };
type Work = {
  id: string;
  title: string;
  titleKana: string;
  contributors: Contributor[];
};
type Person = { id: string; name: string; nameKana: string };

async function main() {
  const people: Record<string, Person> = JSON.parse(
    await readFile(`${INDEX_DIR}people.json`, "utf8"),
  );

  const works: Work[] = [];
  for (const file of await readdir(`${INDEX_DIR}works`)) {
    const shard: Record<string, Work> = JSON.parse(
      await readFile(`${INDEX_DIR}works/${file}`, "utf8"),
    );
    works.push(...Object.values(shard));
  }
  console.log(`検索対象: 作品 ${works.length.toLocaleString()} 件`);

  const { index, errors } = await pagefind.createIndex({ forceLanguage: "ja" });
  if (!index) throw new Error(`インデックスを作成できません: ${errors.join(", ")}`);

  for (const work of works) {
    const authors = work.contributors
      .filter((c) => c.role === "著者")
      .map((c) => people[c.personId])
      .filter((p): p is Person => Boolean(p));

    // 読み仮名も検索対象に含める。漢字の読みが分からなくても引けるようにするため
    const terms = [
      work.title,
      work.titleKana,
      ...authors.flatMap((a) => [a.name, a.nameKana]),
    ].filter(Boolean);

    await index.addCustomRecord({
      url: `/works/${work.id}`,
      content: terms.join(" "),
      language: "ja",
      meta: {
        title: work.title,
        author: authors.map((a) => a.name).join("、"),
      },
    });
  }

  const written = await index.writeFiles({ outputPath: OUT_DIR });
  if (written.errors.length) throw new Error(written.errors.join(", "));
  console.log(`出力: ${OUT_DIR}`);
}

await main();
