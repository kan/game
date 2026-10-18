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

| パス                                | 責務                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                      | Worker の本体。default export の `WorkerEntrypoint`（HTTP、定期実行、ゲーム向けの RPC `getName` / `registerName`）。**entrypoint 以外を export しない**（workerd が名前付き export を entrypoint の候補として扱うため）                                                                           |
| `src/router.ts`                     | ルーターの `handleFetch` と `ID_ROUTES`。`POST` 以外と許可外の `Origin` を断り、Cookie を検証して handler に渡す                                                                                                                                                                                  |
| `src/names.ts`                      | 名前の規則（TAKO-SEN の規則を写したもの）と、名前の取得と登録                                                                                                                                                                                                                                     |
| `src/account.ts`                    | 退会。`GAMES` に列挙した binding の `deleteAccount` を順に呼んでから ID を消す。`deleting` のまま残った ID を定期実行でやり直す `retryDeletions`                                                                                                                                                  |
| `src/rpc.ts`                        | ゲームとの RPC の契約の型（`IdRpc` / `RegisterNameResult` / `GameService`）。何も import しない                                                                                                                                                                                                   |
| `src/http.ts`                       | JSON の応答（`Cache-Control: no-store` 付き）、エラーの応答、`Origin` の確認、Cookie の組み立て、クライアントの IP                                                                                                                                                                                |
| `src/keys.ts`                       | 署名鍵と公開鍵の読み込み。isolate ごとに 1 回だけ import してキャッシュする。署名鍵の `kid` が公開鍵の一覧に無ければ失敗させる                                                                                                                                                                    |
| `src/token.ts`                      | JWT（ES256）の署名と検証、Cookie ヘッダーの解析（同名の Cookie はすべて検証する `verifyIdCookie`）                                                                                                                                                                                                |
| `src/id.ts`                         | handler の型と文脈（`IdHandler` / `IdContext` / `AuthedIdContext`）、要 ID の API を包む `requireId` と `requireActiveId`、ポータル限定の API を包む `portalOnly`、ID の行を引く `findId` と `resolveAccount`（退会済みなら `410`）、Cookie を設定して `{ id, name, status }` を返す `idResponse` |
| `src/codes.ts`                      | 利用者が入力するコード（32 種の文字）の生成と正規化、秘密の値の SHA-256（`hashSecret`）                                                                                                                                                                                                           |
| `src/redeem.ts`                     | 3 つの入力の API に共通の流れ（`redeemHandler`）。頻度制限、本文の解析、ID の切り替え                                                                                                                                                                                                             |
| `src/session.ts`                    | `POST /api/id/session`（ID の発行と延長）                                                                                                                                                                                                                                                         |
| `src/transfer.ts`                   | 引き継ぎコードの発行と入力                                                                                                                                                                                                                                                                        |
| `src/recovery.ts`                   | 復旧コードの発行と入力（ポータル限定）                                                                                                                                                                                                                                                            |
| `src/migration.ts`                  | 引き継ぎ用トークンの入力。トークンの登録は移行の作業で D1 へ直接行う                                                                                                                                                                                                                              |
| `src/maintenance.ts`                | 期限切れの引き継ぎコードと引き継ぎ用トークンを消す（1 日 1 回の定期実行）                                                                                                                                                                                                                         |
| `migrations/`                       | D1 のスキーマ。設計書の全テーブルを `0001_initial.sql` に持つ                                                                                                                                                                                                                                     |
| `public/`                           | ポータルの画面（Workers Static Assets）。トップ（`index.html`）、アカウント画面（`account.html`）、利用規約とプライバシーポリシー（準備中）、404、`_headers`（CSP など）                                                                                                                          |
| `public/favicon.svg` ほか           | アイコン（デフォルメしたゲームコントローラ）。`favicon.svg` が元で、`favicon-32.png` と `apple-touch-icon.png`（180px）はそこから描き出したもの。ヘッダーのロゴにも `favicon.svg` を使う。描き直したら PNG も作り直す                                                                             |
| `public/assets/lib.js`              | 画面の処理のうち DOM に触れない部分（API の呼び出し、エラーの文言、コードの区切り、入力したコードの種類の判定）。`test/portal-lib.test.ts` で試す。今はポータル専用で、ゲームへ写す前提のファイル（`src/token.ts` など）とは扱いが違う                                                            |
| `public/assets/account.js`          | アカウント画面の動作（引き継ぎコード、復旧コード、コードの入力、退会）                                                                                                                                                                                                                            |
| `scripts/generate-signing-key.mjs`  | 鍵の生成                                                                                                                                                                                                                                                                                          |
| `scripts/generate-test-vectors.mjs` | `test-vectors/id-token.json` の生成（`npm run generate-vectors`）。いつ実行するかは「実装の規約」を参照                                                                                                                                                                                           |
| `test-vectors/id-token.json`        | ゲームが写した `src/token.ts` を照合するテストベクター。照合の仕方は `test/vectors.test.ts`                                                                                                                                                                                                       |
| `test/`                             | テストと、テスト用の型（`env.d.ts`）、マイグレーションの適用（`apply-migrations.ts`）                                                                                                                                                                                                             |
| `wrangler.jsonc`                    | 先頭がローカル用、`env.dev` が `dev.kan-game.app` 用                                                                                                                                                                                                                                              |
| `worker-configuration.d.ts`         | `wrangler types` の生成物。手で編集しない                                                                                                                                                                                                                                                         |

## 実装の規約

- **`src/token.ts` は Web Crypto 以外に依存させない。** 各ゲームがこのファイルを写して Cookie の検証に使うため（設計書「鍵の管理」）。`src/` の他のファイルや npm のパッケージを import しない
  - テストベクターを作り直すのは、`src/token.ts` の検証の結果が変わる変更をしたときと、ベクターのケースを足すときだけにする。`npm run generate-vectors` で作り直したら、`src/token.ts` とテストベクターの両方を各ゲームの写しに配る
  - 秘密鍵は生成時だけ使って捨てるので、ケースを 1 つ足すだけでも全トークンと公開鍵が入れ替わる。それ以外の理由（整形や、ただの再実行）では作り直さない
- **`src/rpc.ts` は何も import しない。** 各ゲームが写して、`ID` binding の型付けと `GameService` の実装に使うため。RPC のメソッドを変えたら、このファイルとゲーム側の写しを合わせて直す
- ゲームを足すときは、`GAME_<名前>` の service binding と、環境変数 `GAMES` への列挙を、環境ごと（先頭と `env.dev`）に両方書く。`GAMES` に列挙した binding が無いと退会は失敗する
- `/api/id/*` の API は `src/router.ts` の `ID_ROUTES` に足す。`POST` の限定、`Origin` の確認、鍵の読み込み、Cookie の検証はルーターが行うので、handler で繰り返さない
  - 要 ID の API は `requireId(handler)` で包んで登録する。`401 no_id` と `410 id_deleted` は `requireId` が返し、handler は ID の行（`context.account`）を受け取る。退会の途中の ID を断る API は `requireActiveId` で包む（`409 id_deleting` も返す）
  - それ以外の handler は `context.claims`（検証済みの Cookie、無ければ null）を受け取る。その ID が退会済みかは確かめていないので、要るなら `resolveAccount` を呼ぶ
  - ポータルだけが呼べる API（復旧コード、退会）は `portalOnly(...)` で包む。要 ID でもある API は `portalOnly(requireId(handler))` の順にする
  - 許可するオリジンは `PORTAL_ORIGIN`（常に許可）と `ALLOWED_ORIGINS`（ゲームのオリジン）。ポータルのオリジンを `ALLOWED_ORIGINS` に重ねて書かない
- 入力の API（redeem）は `redeemHandler` に、API 名、本文のフィールド名、正規化（`parse`）、ID の引き方（`resolve`）を渡して作る。1 回限りの値は、見つける文と同じ文で、ID が active のときだけ消費する。active でない ID は `redeemHandler` が断る
- 退会の途中（`deleting`）の ID は、ほかの端末へ広げない。コードの発行は `requireActiveId` で `409 id_deleting` として断り、入力は `400 invalid_code` で断る
- Cookie を設定して `{ id, name, status }` を返す API（session と 3 つの redeem）は `idResponse` で応答を組み立てる。署名と `Set-Cookie` を handler ごとに書かない
- 入力の API（redeem）の頻度制限は、1 つの binding `REDEEM_RATE_LIMITER` を共有し、キーを `<API 名>:<IP>` にして API ごとに数える（設計書の上限が 3 種とも 5 回 / 60 秒のため）。制限の確認は本文を読む前に行い、誤ったコードの試行も数える
- 利用者が入力するコードは `src/codes.ts` の `randomCode` と `normalizeCode` で作り、受け付ける
- エラーは `error(status, code)` で `{ "error": "<code>" }` を返す。コードは設計書の名前（`origin_not_allowed`、`no_id`、`rate_limited` など）に合わせる
  - エラーのコードは `src/http.ts` の型 `ErrorCode` にまとめてある。コードを足すときは `ErrorCode` に足す。画面の文言（`public/assets/lib.js` の `ERROR_MESSAGES`）が無いと、`test/portal-lib.test.ts` の型検査が落ちて気付ける
  - 入力したコードの正規化（区切りや全角の扱い）と長さを変えたら、`lib.js` の `redeemPath` も合わせる。`test/portal-lib.test.ts` が、サーバーの `normalizeCode` と判定が一致するかを確かめている
- ポータルの画面
  - フレームワークとビルドを使わず、素の HTML と JavaScript（ES modules）で書く。型は JSDoc で付け、`tsconfig.public.json` で検査する（`npm run typecheck` が両方を回す）
  - **インラインの `<script>` と `style` 属性を書かない。** `public/_headers` の CSP が `'self'` 以外を許さないため
  - ID（UUID）を画面に出さない。TAKO-SEN と同じく、認証の ID は表示しない
  - 画面は起動時とオフラインからの復帰時に `POST /api/id/session` を呼ぶ（`lib.js` の `startSession`）
  - 利用規約とプライバシーポリシーは本文を別に用意する（R4 の前提）。エージェントが法的な文面を書いて公開しない
- 時刻は Unix エポックからのミリ秒の整数で D1 に持つ。JWT の `iat` と `exp` だけは秒
- 鍵は `loadKeys(env)` から取る。リクエストごとに `importKey` しない
- 頻度の制限は IP（`CF-Connecting-IP`）単位。発行の制限は新しい ID を作るときだけ数え、延長では数えない
  - ヘッダーが無いリクエストは、すべて `unknown` という 1 つのキーで数える。ゲームの Worker が `/api/id/*` を中継するとき、元のリクエストのヘッダーを落とすと全ゲームの新規の利用者が 1 つの枠を共有し、すぐ `429` になる。中継は元のリクエストをそのまま渡す前提で、TAKO-SEN 側の中継を実装するときに確かめる

## テスト

- `vitest.config.ts` が実行のたびに鍵ペアを 3 つ生成し、binding として渡す。現在の署名鍵、ローテーションで退いた鍵（公開鍵だけ `ID_PUBLIC_KEYS` に残る）、未知の鍵。**秘密鍵をリポジトリに置かない**
- 環境変数は `wrangler.jsonc` の先頭（ローカル用）を読み、`vitest.config.ts` の `miniflare.bindings` で開発環境の値に上書きしている
- マイグレーションは `test/apply-migrations.ts`（setupFiles）が `applyD1Migrations` で適用する
- HTTP の API は `handleFetch(request, { ...env, ...overrides })` で直接呼ぶ（`test/helpers.ts` の `call`）。`CF-Connecting-IP` と env の一部を差し替え、偽の `GAME_*` binding を足せるため。リクエストの組み立ての補助も `test/helpers.ts` にある
- RPC は `import { exports } from "cloudflare:workers"` の `exports.default` から呼ぶ。ゲームの `ID` binding と同じく、本物の RPC を通る。`IdPlatform.fetch` の配線も `test/entrypoint.test.ts` で `exports.default.fetch` を通して確かめる
- 見えない文字（結合文字、異体字セレクタなど）は、ソースとテストに文字そのものを書かず `\u{3099}` の形で書く
- Rate Limiting の binding はテストの間（ファイルをまたいでも）で数を共有し、数は実行の後も最長 60 秒残る。**固定の IP を書かない。** 同じ IP で何度も呼ぶテストは `uniqueIp()` で IP を作る（`apiRequest()` は呼ぶたびに `uniqueIp()` を使う）
- テスト用の binding を足したら `test/env.d.ts` に型を足す

## 開発上の知見

2026-10-18 に R1 の雛形を作ったときに分かったこと。

- **`@cloudflare/vitest-pool-workers` は `@cloudflare/vitest-plugin` に改名され、旧名は更新されない。** 旧名を入れない。設定は `cloudflareTest()` を Vite のプラグインとして渡す形で、`readD1Migrations` も同じパッケージから import する
- `wrangler types` はオプションなしだと `vars` をリテラル型にする。テストで値を差し替えられないので `--strict-vars=false` で生成する（`npm run cf-typegen`）
- `secrets.required` に書いた `ID_SIGNING_KEY` の型は、`wrangler types` を実行した環境に `.dev.vars` があれば `string`、無ければ省略可能（`?: string`）になる。リポジトリの `worker-configuration.d.ts` は `.dev.vars` がある状態で生成する（README の手順で最初に作る）。`loadKeys` はどちらの型でも未設定を検査している
- テストの実行時に `Missing required secrets: ID_SIGNING_KEY` の警告が出るが、`miniflare.bindings` で渡しているので動作に影響しない。`.dev.vars` があると `Using secrets defined in .dev.vars` と出て読み込まれるが、同じ名前は `miniflare.bindings` が上書きする
- `.dev.vars` の値は `wrangler.jsonc` の `vars` より優先される。ローカルの `ID_PUBLIC_KEYS` は `wrangler.jsonc` では `[]` にしておき、`.dev.vars` で与える（`wrangler dev` と curl で確認済み）
- `d1_databases`、`ratelimits`、`secrets` は `env.dev` へ継承されないので、環境ごとに書く。Rate Limiting の `namespace_id` はアカウント内で環境ごとに別の値にする（ローカル `1001` `1002`、dev `1101` `1102`）。期間は 10 秒か 60 秒しか選べない
- 公開鍵の一覧に署名鍵の公開鍵が無いままデプロイすると、発行した Cookie をどれも検証できず、呼ぶたびに新しい ID ができる。`env.dev` の `ID_PUBLIC_KEYS` は `[]` のまま置いてあるので、`loadKeys` が失敗させて気付けるようにしている
- 1 つのブラウザが同じ名前の Cookie を 2 つ持つことがある（host-only と `Domain=kan-game.app`）。先頭の 1 つだけを見ると、無効な方が有効な方を隠して毎回新しい ID を発行してしまうので、すべてを検証する
- npm 11 は install script を承認制にしており、`npm install` で workerd と esbuild の postinstall が止められる。プラットフォーム別のバイナリは optional dependency として入るので、テストと `wrangler dev` は動く
- エディタの TypeScript の診断が `tsconfig.json` の `types` を読み直さず、`Env` や `cloudflare:workers` が見つからないと出し続けることがある。`npm run typecheck` の結果を正とする
- Workers の `Uint8Array.fromBase64` / `toBase64` は実行時に使えるが、TypeScript 5.9 の lib に型がない。`src/token.ts` はゲームが写すので型宣言を足さず、`btoa` / `atob` で base64url を扱っている
- curl は `http://localhost` でも `Secure` の Cookie を送るので、ローカルの確認に使える
- Chromium は `http://localhost` でも `__Secure-` の Cookie を保存する（2026-10-18 に Playwright で確認、期限は 400 日のまま）。Firefox と Safari は未確認
- Playwright の MCP でブラウザを操作するとき、`page.once("dialog")` で確認ダイアログを処理すると、ツール側がダイアログを横取りして止まることがある。`browser.newContext()` で作ったページに `page.on("dialog", ...)` を付けると処理できる。新しいコンテキストは、別の端末に見立てるのにも使える
- Playwright の MCP は、スクリーンショットなどを repo の `.playwright-mcp/` にしか書けない（git の対象外にしてある）

## 進み具合（R1）

- 済: Worker と D1 の雛形、`POST /api/id/session`、鍵の生成スクリプト、引き継ぎコード、復旧コード、引き継ぎ用トークンの入力、退会、ゲームとの RPC（名前の取得と登録）、期限切れの行を消す定期実行と止まった退会のやり直し、検証用のテストベクター、テスト
- `dev.kan-game.app` へのデプロイ: 2026-10-18 に済（API だけ。`GAMES` は空）
- ポータルとアカウント画面: 2026-10-18 に済（利用規約とプライバシーポリシーは準備中のページだけ）。ローカルで、Playwright の 3 つのコンテキストを端末に見立てて、引き継ぎ、復旧、退会を確認した
- 未着手: 実機の 2 端末（iPhone の Safari を含む）での確認、Firefox と Safari が `__Secure-` の Cookie を `http://localhost` で受け付けるかの確認、利用規約とプライバシーポリシーの本文

段階を進めたらこの節を更新する。
