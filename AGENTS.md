# kan-game — Agent 向け開発ガイド

kan-game.app のポータルと、各ゲームが共通に使う匿名 ID の基盤（ID 基盤）を 1 つの Cloudflare Worker で提供するリポジトリ。
最初の利用者は TAKO-SEN（`~/tako-sen`）で、vegtab は後から合流する。

## 仕様の参照先

**ID 基盤の仕様は [`docs/ID_DESIGN.md`](docs/ID_DESIGN.md) を正とする。** API、Cookie の形式、鍵の管理、D1 のスキーマ、各操作の流れを実装する前に必ず読む。
方針の正本は TAKO-SEN の `docs/NEXT_PHASE.md`「本番リリース計画（kan-game.app への移行）」で、作業段階（R0〜R6）と完了条件もそこにある。

- 仕様をこのファイルへ書き写さない。このファイルにはコードの構成、規約、開発上の知見だけを書く
- 設計書にない判断を実装で加えたら、設計書の該当箇所に「（本書で追加）」と付けて追記する（例: 退会済みの ID への `410 id_deleted`）
- 実装の都合で設計書と食い違いそうなときは、勝手に方針を変えずに利用者へ確認する

## 技術構成とコマンド

TypeScript、Cloudflare Workers、D1、Workers Rate Limiting、Vitest（`@cloudflare/vitest-plugin`）。外部のランタイム依存は持たない。

| コマンド               | 用途                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm test`             | テスト（Workers のランタイム上で、ローカルの D1 に対して実行）           |
| `npm run typecheck`    | 型検査（`tsc --noEmit`）                                                 |
| `npm run format`       | Prettier で整形（`docs/` と生成ファイルは対象外）                        |
| `npm run cf-typegen`   | `wrangler.jsonc` から `worker-configuration.d.ts` を作り直す             |
| `npm run generate-key` | 署名鍵（P-256）を作る。`-- --dev-vars` でローカル用の `.dev.vars` を書く |
| `npm run dev`          | `wrangler dev`（`http://localhost:8787`）                                |
| `npm run deploy:dev`   | `dev.kan-game.app` へデプロイ                                            |

変更後は `npm run typecheck`、`npm test`、`npx prettier --check .` を通す。

## ファイル構成

| パス                               | 責務                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                     | ルーター。パスから handler を引き、`POST` 以外と許可外の `Origin` をここで断る                                                 |
| `src/http.ts`                      | JSON の応答（`Cache-Control: no-store` 付き）、エラーの応答、`Origin` の確認、Cookie の組み立て、クライアントの IP             |
| `src/keys.ts`                      | 署名鍵と公開鍵の読み込み。isolate ごとに 1 回だけ import してキャッシュする。署名鍵の `kid` が公開鍵の一覧に無ければ失敗させる |
| `src/token.ts`                     | JWT（ES256）の署名と検証、Cookie ヘッダーの解析（同名の Cookie はすべて検証する `verifyIdCookie`）                             |
| `src/id.ts`                        | リクエストの Cookie から ID を読む `readIdClaims`、Cookie を設定して `{ id, name, status }` を返す `idResponse`                |
| `src/session.ts`                   | `POST /api/id/session`（ID の発行と延長）                                                                                      |
| `migrations/`                      | D1 のスキーマ。設計書の全テーブルを `0001_initial.sql` に持つ                                                                  |
| `scripts/generate-signing-key.mjs` | 鍵の生成                                                                                                                       |
| `test/`                            | テストと、テスト用の型（`env.d.ts`）、マイグレーションの適用（`apply-migrations.ts`）                                          |
| `wrangler.jsonc`                   | 先頭がローカル用、`env.dev` が `dev.kan-game.app` 用                                                                           |
| `worker-configuration.d.ts`        | `wrangler types` の生成物。手で編集しない                                                                                      |

## 実装の規約

- **`src/token.ts` は Web Crypto 以外に依存させない。** 各ゲームがこのファイルを写して Cookie の検証に使うため（設計書「鍵の管理」）。`src/` の他のファイルや npm のパッケージを import しない
- `/api/id/*` の API は `src/index.ts` の `ID_ROUTES` に足す。`POST` の限定と `Origin` の確認はルーターが行うので、handler で繰り返さない
- Cookie を設定して `{ id, name, status }` を返す API（session と 3 つの redeem）は `idResponse` で応答を組み立てる。署名と `Set-Cookie` を handler ごとに書かない
- Cookie から ID を読むときは `readIdClaims` を使う。要 ID の API を足すときは、`401 no_id` と退会済みの ID の扱いを handler ごとに書かず、ルーターか共通の関数にまとめる（未実装）
- エラーは `error(status, code)` で `{ "error": "<code>" }` を返す。コードは設計書の名前（`origin_not_allowed`、`no_id`、`rate_limited` など）に合わせる
- 時刻は Unix エポックからのミリ秒の整数で D1 に持つ。JWT の `iat` と `exp` だけは秒
- 鍵は `loadKeys(env)` から取る。リクエストごとに `importKey` しない
- 頻度の制限は IP（`CF-Connecting-IP`）単位。発行の制限は新しい ID を作るときだけ数え、延長では数えない
  - ヘッダーが無いリクエストは、すべて `unknown` という 1 つのキーで数える。ゲームの Worker が `/api/id/*` を中継するとき、元のリクエストのヘッダーを落とすと全ゲームの新規の利用者が 1 つの枠を共有し、すぐ `429` になる。中継は元のリクエストをそのまま渡す前提で、TAKO-SEN 側の中継を実装するときに確かめる

## テスト

- `vitest.config.ts` が実行のたびに鍵ペアを 3 つ生成し、binding として渡す。現在の署名鍵、ローテーションで退いた鍵（公開鍵だけ `ID_PUBLIC_KEYS` に残る）、未知の鍵。**秘密鍵をリポジトリに置かない**
- 環境変数は `wrangler.jsonc` の先頭（ローカル用）を読み、`vitest.config.ts` の `miniflare.bindings` で開発環境の値に上書きしている
- マイグレーションは `test/apply-migrations.ts`（setupFiles）が `applyD1Migrations` で適用する
- handler は `worker.fetch(request, { ...env, ...overrides })` で直接呼ぶ。`CF-Connecting-IP` と env の一部を差し替えられるため
- Rate Limiting の binding はテストの間で数を共有する。テストごとに IP を変える（`sessionRequest()` は呼ぶたびに別の IP を使う）
- テスト用の binding を足したら `test/env.d.ts` に型を足す

## 開発上の知見

2026-10-18 に R1 の雛形を作ったときに分かったこと。

- **`@cloudflare/vitest-pool-workers` は `@cloudflare/vitest-plugin` に改名され、旧名は更新されない。** 旧名を入れない。設定は `cloudflareTest()` を Vite のプラグインとして渡す形で、`readD1Migrations` も同じパッケージから import する
- `wrangler types` はオプションなしだと `vars` をリテラル型にする。テストで値を差し替えられないので `--strict-vars=false` で生成する（`npm run cf-typegen`）
- `secrets.required` に書いた `ID_SIGNING_KEY` は、生成される型で省略可能（`?: string`）になる。`loadKeys` で未設定を検査している
- テストの実行時に `Missing required secrets: ID_SIGNING_KEY` の警告が出るが、`miniflare.bindings` で渡しているので動作に影響しない
- `.dev.vars` の値は `wrangler.jsonc` の `vars` より優先される。ローカルの `ID_PUBLIC_KEYS` は `wrangler.jsonc` では `[]` にしておき、`.dev.vars` で与える（`wrangler dev` と curl で確認済み）
- `d1_databases`、`ratelimits`、`secrets` は `env.dev` へ継承されないので、環境ごとに書く。Rate Limiting の `namespace_id` はアカウント内で環境ごとに別の値にする（ローカル `1001`、dev `1101`）。期間は 10 秒か 60 秒しか選べない
- 公開鍵の一覧に署名鍵の公開鍵が無いままデプロイすると、発行した Cookie をどれも検証できず、呼ぶたびに新しい ID ができる。`env.dev` の `ID_PUBLIC_KEYS` は `[]` のまま置いてあるので、`loadKeys` が失敗させて気付けるようにしている
- 1 つのブラウザが同じ名前の Cookie を 2 つ持つことがある（host-only と `Domain=kan-game.app`）。先頭の 1 つだけを見ると、無効な方が有効な方を隠して毎回新しい ID を発行してしまうので、すべてを検証する
- npm 11 は install script を承認制にしており、`npm install` で workerd と esbuild の postinstall が止められる。プラットフォーム別のバイナリは optional dependency として入るので、テストと `wrangler dev` は動く
- エディタの TypeScript の診断が `tsconfig.json` の `types` を読み直さず、`Env` や `cloudflare:workers` が見つからないと出し続けることがある。`npm run typecheck` の結果を正とする
- Workers の `Uint8Array.fromBase64` / `toBase64` は実行時に使えるが、TypeScript 5.9 の lib に型がない。`src/token.ts` はゲームが写すので型宣言を足さず、`btoa` / `atob` で base64url を扱っている
- curl は `http://localhost` でも `Secure` の Cookie を送るので、ローカルの確認に使える。ブラウザが `__Secure-` の Cookie を `http://localhost` で受け付けるかは未確認（設計書「ローカルの開発」で R1 に確かめるとしている）

## 進み具合（R1）

- 済: Worker と D1 の雛形、`POST /api/id/session`、鍵の生成スクリプト、テスト
- 未着手: 引き継ぎコード、復旧コード、引き継ぎ用トークン、退会、ゲームとの RPC（`WorkerEntrypoint`）、期限切れの行を消す定期実行、ポータルとアカウント画面、検証用のテストベクター、`dev.kan-game.app` へのデプロイ（`kan-game-dev` の D1 の作成から）

段階を進めたらこの節を更新する。
