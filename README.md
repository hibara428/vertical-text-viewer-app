# 縦書きビューア

青空文庫の作品を読む、日本語縦書きのビューアです。<https://viewer.hibara428.dev>

目的は読み方モードを複数作って比べることそのもので、そこから使いやすいものへ
収束させることを狙っています。

## 読み方モード

| モード | 内容 |
| --- | --- |
| 巻物 | 縦書き。1紙面ぶんを中央に置き、文字を読む順に出す。読み終わると次へ送る |
| ページ | 縦書き。紙面ごとに区切って左右に送る |
| 縦段組 | 縦書き。紙面を帯に分けて縦にスクロールする |
| ブログ | 横書き。上から下へ流す |

## 構成

Astro + Cloudflare Workers。作品一覧と検索は静的生成し、本文は青空文庫から
その都度取得して KV にキャッシュします。CMS は使いません。

## 開発

Node 24.20.0（`.node-version` / `.mise.toml`）。

```sh
npm install
npm run dev      # 開発サーバー
npm run build    # ビルド + 検索索引の生成
npm run preview  # ビルド結果を Workers 上で確認
npm run deploy   # ビルドして公開
```

`main` への push でも自動で公開されます（Cloudflare Workers Builds）。

生成物の作り直し（普段は不要）。

```sh
npm run update-index        # 青空文庫の公式CSVから作品・人物の索引を作る
npm run build-gaiji-table   # 外字注記の面区点→Unicode 変換表を作る
```

## ドキュメント

- [`docs/requirements.md`](docs/requirements.md) — 何を作るか
- [`docs/design.md`](docs/design.md) — システム設計
- [`docs/viewer-design.md`](docs/viewer-design.md) — ビューアの詳細設計。各モードの方式比較と却下した案

## 出典

本文・メタデータは[青空文庫](https://www.aozora.gr.jp/)の著作権切れ作品によります。
