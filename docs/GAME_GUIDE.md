# kan-game.app のゲームの作り方

kan-game.app で動くゲームに共通の構成と、実装の注意をまとめる。新しいゲームを足すときと、既存のゲームの間で実装をそろえるときに読む。

- ID 基盤そのものの仕様（API、Cookie、鍵、退会の流れ）は [`ID_DESIGN.md`](ID_DESIGN.md) を正とする。この文書は、ゲームの側から見た使い方だけを書く
- 各ゲームのルールと契約は、それぞれの repo の `docs/DESIGN.md`（vegtab と Pu-Jan は `docs/SPEC.md`）と `docs/DATA_CONTRACT.md` を正とする
- ここに書いた内容は 2026-11-16 に TAKO-SEN、NYORO-RIN、Vege-Table のコードを比べてまとめた。ゲームの側で作りを変えたら、この文書も直す

## ゲームの一覧

| ゲーム | repo | 本番 | dev | 構成 | kan/game の binding |
|---|---|---|---|---|---|
| TAKO-SEN | `kan/tako-sen` | `tako.kan-game.app`（Worker `tako`） | `tako-dev.kan-game.app` | 1 パッケージ | `GAME_TAKO` |
| Vege-Table | `kan/vegtab` | `vegtab.kan-game.app`（Worker `vegtab-api-production`） | `vegtab-dev.kan-game.app` | workspace（`engine` / `frontend` / `backend`） | `GAME_VEGTAB` |
| NYORO-RIN | `kan/nyoro-rin` | `nyoro.kan-game.app`（Worker `nyoro`） | `nyoro-dev.kan-game.app` | 1 パッケージ | `GAME_NYORO` |
| Pu-Jan | `kan/pujan` | 未公開 | `pujan-dev.kan-game.app` | workspace（`engine` / `frontend` / `backend`） | `GAME_PUJAN`（dev だけ） |

kan-game.app のゲームの基本形は、TAKO-SEN と NYORO-RIN の構成（1 パッケージ）とする。**新しいゲームは NYORO-RIN を手本にする。** NYORO-RIN は TAKO-SEN を手本に後から作ったので、TAKO-SEN で後から分かった改良を初めから持ち、画面とルーティングの分け方も整理されている。TAKO-SEN にしか無い機能（デイリー、週間ランキング、通知、実績）は TAKO-SEN を見る。ゲームの間で共通にする部品（kan/game#3）も、この構成から使う形を基準にする。

Vege-Table と Pu-Jan は、独立したアプリとして作ってから合流したので、workspace の構成と Hono を使う。ID 基盤とのつなぎ方は同じで、置き場所が違う（`src/worker/` の代わりに `backend/src/`）。Vege-Table は、ゲームのモードを足す前に基本形へそろえる（kan/vegtab#125）。Pu-Jan をそろえるかは、まだ決めていない。

## 全体の構成

```text
ブラウザ ──(Cookie: __Secure-kg_id)──> <game>.kan-game.app（ゲームの Worker）
                                          │ binding ID ─────────> kan-game（ID 基盤の Worker）
                                          │   /api/id/* の中継、registerName などの RPC
                                          │ D1（ゲームの記録）
                                          │
kan-game（ID 基盤）── binding GAME_<名前> ─> ゲームの Worker の GameService
                         退会のときの deleteAccount(id)
```

- 1 つのゲームは 1 つの Worker で、画面（Workers Static Assets）と API（`/api/*`）を配る。`assets.run_worker_first: ["/api/*"]` で API だけを Worker に通し、ほかは SPA として配る
- ID 基盤とゲームは互いに Service Binding を持つ。HTTP の口を公開しないので、署名や共有の秘密は要らない
- ゲームは ID の Cookie を自分で検証する。検証のたびに ID 基盤へは問い合わせない
- ID と名前は ID 基盤が持ち、記録はゲームの D1 が持つ。ゲームの D1 は ID（UUID）をそのまま `account_id` に使う

### 守ること

- ID が無くても、通信できなくても遊べるようにする。問題の生成とプレイは端末で完結させ、サーバーは記録の検証、ランキング、デイリーの配布だけを受け持つ
- パズルの判定はコア（`src/core/` / `engine/`）に置き、画面と Worker から同じものを呼ぶ。Worker で判定を書き直さない。サーバーが記録を確かめるときは、コアでシードから盤面を作り直す
- 所有権の証明は ID の Cookie だけで行う。端末で作った匿名の ID や、本文に書かれた ID を信じない
- ほかの人の ID（`account_id`）を応答に出さない。自分の行は、サーバーで比べて `isSelf` だけを返す。ポータルの画面も ID を表示しない。プライバシーポリシー（`public/privacy.html`）は「ID は公開しない」と書いている

## リポジトリの構成（1 パッケージの場合）

```text
src/
  core/       盤面、ルール、Solver、Generator、難易度、成績、保存、送信キュー（pure TypeScript）
  ui/         入力、画面のコンポーネント、盤面生成の Web Worker、ID とオンラインの処理
  worker/     API、GameService、kan/game からの写し
  App.vue
migrations/   D1 のマイグレーション
scripts/      dev.mjs、ライセンス一覧の生成、集計 CLI など
tests/        テスト。kan/game の写しは tests/kan-game/
docs/         DESIGN.md、DATA_CONTRACT.md、DEPLOY.md
AGENTS.md     エージェント向けの規則（仕様は書かず、docs/ を正とする）
```

- `src/worker/main.ts` を `wrangler.jsonc` の `main` にし、`index.ts` の default export と `GameService` をここで export する。`GameService` は `cloudflare:workers` を import するので Workers のランタイムでしか読めず、`index.ts` を Node のテストから import できるようにするため
- `App.vue` に画面を詰め込まない。NYORO-RIN は画面を `MenuDialog.vue` などに、処理を composable（`use-play.ts`、`use-online.ts` など）に分けている。TAKO-SEN の `App.vue` は 3000 行を超えている
- 文書は、ゲームのルールと設計の正本（`DESIGN.md`）、ID、保存データ、API、D1 の契約（`DATA_CONTRACT.md`）、デプロイの手順（`DEPLOY.md`）に分ける。AGENTS.md には仕様を写さず、規則と開発の知見だけを書く

## ID 基盤との接続

### 写すファイル

kan/game の次のファイルを、書き換えずに写す。

| 写し元（kan/game） | 写し先（NYORO-RIN、TAKO-SEN） | 写し先（vegtab） | 用途 |
|---|---|---|---|
| `src/token.ts` | `src/worker/id-token.ts` | `backend/src/lib/id-token.ts` | Cookie の検証 |
| `src/rpc.ts` | `src/worker/id-rpc.ts` | `backend/src/lib/id-rpc.ts` | `ID` binding の型と `GameService` の契約 |
| `testing/fake-id-platform.ts` | `tests/kan-game/` | `backend/test/kan-game/` | テスト用の `IdRpc` の偽物 |
| `testing/test-id-cookie.ts` | `tests/kan-game/` | `backend/test/kan-game/` | テスト用の鍵と Cookie |
| `test-vectors/id-token.json` | `tests/id-token-vectors.json` | `backend/test/kan-game/id-token-vectors.json` | 写した `id-token.ts` の照合 |

- 写したら、kan/game の `test/vectors.test.ts` と同じ照合をゲームのテストに入れる
- AGENTS.md に、写しのファイルの一覧と写し元のコミットを書く。kan/game が変わったとき、`git log <コミット>.. -- src/token.ts src/rpc.ts testing test-vectors` で写し直しが要るかを確かめられる。今の写しはどのゲームも kan/game の `258c299` と一致する
- kan/game のマイグレーションを写してテストに使う場合（TAKO-SEN の `tests/kan-game/0001_initial.sql`）も、写しの一覧に入れる

### wrangler.jsonc

| 項目 | ローカル | dev | 本番 |
|---|---|---|---|
| `services` の `ID` | `kan-game-local` | `kan-game-dev` | `kan-game` |
| `ID_COOKIE_NAME` | `__Secure-kgdev_id` | `__Secure-kgdev_id` | `__Secure-kg_id` |
| `ID_ISSUER` | `localhost` | `dev.kan-game.app` | `kan-game.app` |
| `ID_PUBLIC_KEYS` | `[]`（`scripts/dev.mjs` が kan/game の `.dev.vars` から渡す） | dev の公開鍵 | 本番の公開鍵 |
| `ALLOWED_ORIGINS` | `scripts/dev.mjs` が渡す | `https://<game>-dev.kan-game.app` | `https://<game>.kan-game.app` |

- `ID` binding は entrypoint を指定せずにつなぐ（ID 基盤の default export が `WorkerEntrypoint`）
- 署名鍵を入れ替えるときは、すべてのゲームの `ID_PUBLIC_KEYS` に新しい公開鍵を足してデプロイしてから、ID 基盤の鍵を替える（ID_DESIGN.md「鍵の管理」）。ゲームを足したら、その手順の対象にも入る
- `d1_databases`、`services`、`triggers`、`vars`、`secrets` は `env` へ継承されないので、環境ごとに書く
- `compatibility_date` は新しいもの（今は `2026-09-15`）にし、`observability` を有効にする

### Cookie の検証（`src/worker/auth.ts`）

- 公開鍵は isolate ごとに 1 回だけ import してキャッシュする。import に失敗したときはキャッシュしない
- `verifyIdCookie` で同名の Cookie をすべて検証する（1 つ目だけを見ない）
- 検証を通った ID でも、`deleted_accounts` にあるものは退会済みとして `410` で断る
- 結果は `ok` / `unauthorized` / `deleted` の 3 つで返し、API ごとに必要な結果を選ぶ

### `/api/id/*` の中継

画面は自分のオリジンの `/api/id/*` を呼び、Worker は `env.ID.fetch(request)` で元のリクエストをそのまま渡す。例外のときは `503` を返す。

- ヘッダーを組み立て直さない。ID 基盤は `CF-Connecting-IP` で頻度を数えるので、落とすと全ゲームの新規の利用者が 1 つの枠を共有し、すぐ `429` になる
- `Origin` も ID 基盤が確かめる。ゲームのオリジンを kan/game の `ALLOWED_ORIGINS` に足す

### 名前

- 名前は `POST /api/id/session` の応答で受け取る。`getName` は使わなくてよい
- 名前の登録は、ゲームの API が `registerName` の RPC を呼び、結果をゲームの D1（TAKO-SEN `leaderboard_profiles`、NYORO-RIN `profiles`）にも写す
- 結果（`ok` / `already_named` / `name_taken` / `invalid` / `no_id`）は `switch` で分け、`default` で `never` に代入して網羅を型で検査する。kan/game が結果を足したときに気付ける
- 画面で名前を前もって確かめる規則（`src/core/account-profile.ts`）は、kan/game の `src/names.ts` と同じ規則を手で写している。kan/game の規則を変えたら、各ゲームの規則も直す

### 退会（`GameService.deleteAccount`）

- `deleted_accounts` への INSERT と、`ACCOUNT_TABLES` に並べた表からの DELETE を、1 つの `batch` で行う。何度呼んでも同じ結果にする
- 退会の途中に書かれた行を消すため、定期実行で `sweepDeletedAccounts` を回す。デイリーの生成など、別の処理の定期実行に相乗りさせない（止めたときに掃除も止まる）
- **`account_id` を持つ表を足したら、`ACCOUNT_TABLES` にも足す。** 並べ忘れをテストで検出する（D1 の `sqlite_master` から `account_id` 列を持つ表を列挙して比べる。kan/tako-sen#29、kan/nyoro-rin#12）
- R2 や KV に ID ごとのものを置いた場合も、`deleteAccount` で消す（vegtab はリプレイとランキングのキャッシュ）
- 退会で消えるものと残るものは、プライバシーポリシーに書いてある。表を足したら、ポリシーの該当箇所と食い違わないかを確かめる

## Worker の API

### 応答と入力

- JSON の応答は 1 つの関数（`json()`）で作り、`Cache-Control: no-store` を付ける。ID ごとに違う応答を、途中のキャッシュに持たせないため
- エラーは `{ "error": "<code>" }` で返す。コードは `snake_case` の識別子にし、文を入れない
- 本文は上限つきで読む（`readLimitedBody`）。`Content-Type` の確認と JSON の解析は `readJsonBody` にまとめ、`415` と `400` を API ごとに書かない
- ルートは表で持つ（NYORO-RIN の `ACCOUNT_ROUTES`）。if の連鎖にすると、メソッドの許可や制限の付け忘れが見えにくい
- `Origin` の確認: POST は許可したオリジンを必須にする。`Origin` の無い GET は通す。`ALLOWED_ORIGINS` が空なら `503`
- 予期しない例外は `500` と `{ "error": "internal_error" }` にし、ログに出す（Hono なら `app.onError`）

### 回数の制限

ゲームの Worker は Workers Rate Limiting を使わず、D1 の表で ID ごとに数えている（ID 基盤は Rate Limiting の binding を使う）。

- **重い処理（盤面の作り直し、リプレイの検証）より前に数える。** NYORO-RIN の `/api/plays` の順が手本になる
  1. 保存済みの記録と同じなら、作り直さずに結果を返す（`compareStoredPlay`）
  2. 新しい記録だけ、枠を取る（`takeUploadSlot`、60 秒に 10 件）。取れなければ `429`
  3. 枠が取れたら検証して保存する
- 制限に使う表も `account_id` を持つので、`ACCOUNT_TABLES` に入れる

### 記録とランキング

- 端末の完了記録は、名前を決める前から送ってよい。ランキングに載せるのは、名前と公開への同意を設定した後のクリアだけにする
- 同意の版は定数にし、SQL に直接書かない（NYORO-RIN の `RANKING_CONSENT_VERSION`）
- 問題 ID の形式の確認は 1 つの関数にする（NYORO-RIN の `isPuzzleId()`）
- 記録の正しさは、シードから作り直した盤面と照合して確かめる。TAKO-SEN と NYORO-RIN は解の照合で、時間とヒントの回数は申告値として扱う。vegtab は操作列を engine で再生して確かめる
- ランキングは、応答に ID を入れず、Cookie があれば `isSelf` を付ける。Cookie が無くても読めるようにする

### デイリー

- 日付は日本時間の暦日（UTC+9 固定）で、0 時に切り替える
- 盤面はサーバーで作って D1 に置き、画面へは正解を含まないスナップショットを配る
- **seed を日付から計算できる形にしない。** repo を公開しているので、日付だけで作ると、先の日の盤面を誰でも前もって解ける。vegtab の `backend/src/lib/seed.ts`（kan/vegtab#116）のように、Worker の secret の HMAC（`HMAC-SHA256(secret, "<game>-daily:<日付>")`）から作る。TAKO-SEN は日付から作っていて、kan/tako-sen#23 で直す
- 前日のうちに作っておくのはよい。当日より先の日の盤面や seed は返さない
- 盤面の版は通常の問題と分け、凍結する。作り方を変えるときは版を上げ、切り替えの日より前の日は旧版のまま残す

## 画面

### PWA

- `vite-plugin-pwa` で manifest と Service Worker を作る。TAKO-SEN と NYORO-RIN の `vite.config.ts` が同じ設定を持つ
  - `registerType: "autoUpdate"`、`injectRegister: false`、`skipWaiting`、`clientsClaim`
  - `navigateFallbackDenylist: [/^\/api\//]`
- API の応答は Service Worker でキャッシュしない
- 新しい版を出した直後に、古い画面が消えたチャンクを読みに行って失敗する。`main.ts` で `vite:preloadError` を受けて読み込み直す（`src/ui/stale-chunk.ts`、60 秒に 1 回まで）。router の `onError` だけでは、router を通らない動的 import と CSS の preload を拾えない
- Service Worker の登録は、最初の盤面の表示と競わないよう、load の後に行う（NYORO-RIN の `registerSW()`）

### ホーム画面に追加

`src/ui/install.ts` と `InstallSteps.vue`（TAKO-SEN と NYORO-RIN で同じ）を使う。

- `beforeinstallprompt` を受け取れるブラウザでは、ボタンからそのままインストールさせる
- iPhone と iPad の Safari には、共有メニューから追加する手順を出す。`isSafari()` は UA に `Safari/` を含むアプリ内ブラウザ（`CriOS`、`FxiOS`、`EdgiOS`、`OPiOS`、`GSA/`、`YJApp`、`Line/`、`Instagram`、`FBAN`、`FBAV`）を除く。どれも共有メニューの位置や項目が手順と違う
- ホーム画面から開いているとき（`display-mode: standalone`）はボタンを出さない

### 「このゲームについて」とライセンス一覧

- 載せるもの: kan-game.app のポータル、利用規約、プライバシーポリシーへのリンク、アプリの版、使っている OSS のライセンス
- 版は `vite.config.ts` で `package.json` の version と短縮した commit から作り、`__APP_VERSION__` で埋め込む（NYORO-RIN の `appVersion()`）。プレイログや感想に送る `app_version` と同じ値にする
- ライセンス一覧は `scripts/licenses-plugin.ts` が build のときに `licenses.json` を作る。今いちばん新しいのは TAKO-SEN のもの（kan/tako-sen@de78c18）
  - Vite と Rollup の `LICENSE.md` からは「Licenses of bundled dependencies」の節を外す（画面に入らない Node 側の依存のため）
  - 同じ `name@version` は 1 件にまとめる。ライセンスのファイルは名前の順にすべて読み、同じ本文は 1 回にする
- Service Worker に入る workbox のパッケージは手で並べるので、`scripts/check-sw-licenses.ts` で `dist/workbox-*.js` と突き合わせ、ずれたら build を失敗させる

### ID とオンライン（`src/ui/auth.ts`）

- 起動時と `online` イベントで `POST /api/id/session` を呼ぶ
- 確認が取れていない間（`status` が `ready` でも `loading` でもない間）は、30 秒ごとに問い合わせ直す。保存済みの ID を持つ端末も対象にする（NYORO-RIN の `UNCONFIRMED_RETRY_MS`）。`401` が続くときは間隔を延ばす
- 引き継ぎと復旧はポータルのアカウント画面で行う。ゲームの画面に引き継ぎの入力を置く場合（TAKO-SEN）は、引き継ぎとセッションの応答が競合したとき、最後に送った方を正にする

### 端末の保存

- キーは `<game>.<名前>.v<版>` の形にし、ID ごとのものは `:<ID>` を後ろに付ける。設定は 1 つの JSON にまとめる（NYORO-RIN の `nyoro-rin.settings.v1`）
- 形式を変えるときは版を上げ、旧版からの移し方と、壊れたデータの扱いをテストする
- `localStorage` へのアクセスが例外を投げる環境があるので、読み書きは 1 か所の関数を通す（NYORO-RIN の `ui/browser-storage.ts`）
- 送れなかった記録のキューは、件数に上限を持たせ（NYORO-RIN の `Outbox<T>`、100 件）、ID ごとに分ける。別の ID の分を送らない。読めないキューは捨てずに退避する（TAKO-SEN の `.corrupt`）
- ゲームの状態を CSS class や表示色で表さない

### ブラウザの機能の失敗に備える

- 盤面を作る Web Worker の返答には期限を付け、過ぎたらメインスレッドで作る（TAKO-SEN の `REPLY_TIMEOUT_MS`）
- 振動は 1 つの関数から呼び、例外を拾う（TAKO-SEN の `requestVibration`）

### 応答のヘッダー（`public/_headers`）

```text
/*
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; form-action 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

https://<game>-dev.kan-game.app/*
  X-Robots-Tag: noindex
```

dev は検索エンジンに載せない。NYORO-RIN がこの形で、TAKO-SEN（kan/tako-sen#26）と vegtab（kan/vegtab#120）は足りない。

## ローカルの開発

`scripts/dev.mjs` が、ID 基盤（kan/game の `wrangler dev`）、ゲームの API（`wrangler dev`）、画面（`vite`）をまとめて起動する。TAKO-SEN で作り、ほかのゲームが写した。

- kan/game はゲームの隣（`../game`）に置く。別の場所なら `KAN_GAME_DIR` で指定する。kan/game 側で `npm install`、`npm run generate-key -- --dev-vars`、`npx wrangler d1 migrations apply DB --local` を済ませておく
- ゲームの API は wrangler の dev registry で、別プロセスの ID 基盤（`kan-game-local`）に `ID` binding でつながる。ローカルでも本番と同じ経路で ID を発行し、ログインを省く仕組みは作らない
- API と ID 基盤のポートは起動のたびに空いているものを選び、Vite の proxy とポータルの URL に環境変数で渡す
- 画面のオリジンは `--var ALLOWED_ORIGINS` で API と ID 基盤へ渡す（NYORO-RIN）。`.dev.vars` にオリジンを書き足さない
- roji が使える環境では `npm run dev:roji` で起動する。roji の URL とポータル（`localhost`）はホストが違うので、ID の Cookie を共有しない。ポータルを通して確かめるときは `npm run dev:all` で起動する
- API の `wrangler dev` は `dist` が無いと起動しないので、初回は `npm run build` を済ませる

## テスト

- コア: ルール、Solver、Generator、難易度、保存の形式。Generator の版ごとの盤面は固定ハッシュのテストで守る
- Worker: TAKO-SEN と NYORO-RIN は `wrangler` の `getPlatformProxy` で D1 を動かし、マイグレーションを当ててから API を呼ぶ。共通の準備は 1 つのファイルにまとめる（NYORO-RIN の `tests/worker-env.ts`）。vegtab と kan/game は `@cloudflare/vitest-plugin` で Workers のランタイム上で動かす
- ID: 写した `testing/` の偽物と Cookie で、本物と同じ経路を通す。認証を差し替えるモックだけで済ませない
- テスト用の `wrangler.jsonc` の `database_id` は、本物の ID でなくダミー（`00000000-...`）にする
- 退会: `ACCOUNT_TABLES` の網羅、退会済みの ID の書き込みを断ること、何度呼んでも同じ結果になること

## CI、依存、セキュリティ

| ファイル | 内容 |
|---|---|
| `.github/workflows/ci.yml` | `format:check`、型検査（`vue-tsc --noEmit`）、テスト、build。デプロイは CI に入れない |
| `.github/workflows/verify-lockfile.yml` と `actions.lock` | action の commit を固定し、lockfile を検査する。`uses:` を変えたら `gh actions-lock` を実行する |
| `.github/dependabot.yml` | npm と GitHub Actions を週に 1 度、まとめて出す。cooldown は npm が 7 日（メジャーは 14 日）、actions が 3 日 |
| `SECURITY.md` | 脆弱性の報告先（非公開の脆弱性報告） |

- `package.json` に次を置く
  - `engines.node`（`>=22.18`。`.ts` を node で直接実行するため）
  - `cf-typegen`（`wrangler types --strict-vars=false`）
  - `deploy:dev` / `deploy:production`（build → マイグレーション → deploy）
- 型検査の対象に `scripts/**/*.ts` と `*.config.ts` も入れる
- repo は公開している。issue、コミット、PR に、プレイログや感想の本文、ID の一部を載せない

## 新しいゲームを足す手順

1. ゲームの repo を NYORO-RIN の構成で作り、kan/game の写しを置く。写し元のコミットを AGENTS.md に書く
2. `wrangler.jsonc` に、ローカル、dev、本番の 3 つの環境を書く（上の表）。`GameService` を `src/worker/main.ts` から export する
3. D1（`<game>-dev`、`<game>-prod`）を作り、dev の Worker を出す
4. kan/game の `wrangler.jsonc` の `env.dev` に、`GAME_<名前>` の service binding（`entrypoint: "GameService"`）、`GAMES` への列挙、`ALLOWED_ORIGINS` へのオリジンを足して出す。**ゲームの Worker を先に出す。** binding の先が無いと、退会が毎回 `503 deletion_incomplete` になる
5. dev のポータルで退会し、ゲームの D1 の `deleted_accounts` に行が入ることを確かめる
6. 本番も 3〜5 と同じ順で行う。ローカルの kan/game（`wrangler.jsonc` の先頭）にも binding を足すかを決める
7. kan/game のポータルに載せる: `public/index.html` のゲームの一覧と、`public/assets/games/<game>.svg` のアイコン。ゲームの一覧には、本番に出したゲームだけを載せる
8. kan/game のプライバシーポリシー（`public/privacy.html`）の「ゲームごとの記録」と「公開される情報」に、そのゲームの分を足す。本文を変えるのは利用者が承認してからで、改定は「12. 改定」に従って知らせる
9. 鍵の入れ替えの手順（ID_DESIGN.md「鍵の管理」）の対象に、そのゲームの `ID_PUBLIC_KEYS` が入ったことを確かめる

kan/game の設定を変える作業は、ゲームの repo の作業とは分けて、利用者に確かめてから行う。本番へのデプロイ、リモートの D1 への書き込み、secret の登録も同じ。

## ゲームの間で残っているずれ

2026-11-16 の比較で見つけたもので、それぞれの repo に issue を立てた。直したらこの表から消す。

| repo | issue | 内容 |
|---|---|---|
| kan/game | #3 | ゲームの間でほぼ同じコードを、写しとして配る範囲を広げるか決める |
| kan/tako-sen | #23 | デイリーの seed を日付から計算できない形にする |
| kan/tako-sen | #24 | 記録の送信で、再送の照合と回数の制限を盤面の作り直しより前に行う |
| kan/tako-sen | #25 | 同意の版、パズル ID の形式、本文の読み込みを 1 か所にまとめる |
| kan/tako-sen | #26 | 画面の応答のセキュリティのヘッダー |
| kan/tako-sen | #27 | CI の format の検査、型検査の対象、npm script |
| kan/tako-sen | #28 | 写しの一覧と写し元のコミットを AGENTS.md に書く |
| kan/tako-sen | #29 | `ACCOUNT_TABLES` の網羅のテスト、退会者の掃除の定期実行 |
| kan/tako-sen | #30 | 保存済みの ID を持つ端末の再確認 |
| kan/tako-sen | #31 | 問題別ランキングの `isSelf` |
| kan/nyoro-rin | #11 | ライセンス一覧に TAKO-SEN の改良を戻す |
| kan/nyoro-rin | #12 | `ACCOUNT_TABLES` の網羅のテスト |
| kan/nyoro-rin | #13 | 盤面を作る Web Worker の返答の期限、振動の例外 |
| kan/nyoro-rin | #14 | 写し元のコミットを AGENTS.md に書く |
| kan/vegtab | #118 | ランキングの応答からほかの人の ID を外す |
| kan/vegtab | #119 | スコアの送信などの回数の制限 |
| kan/vegtab | #120 | 画面のヘッダー、dev の noindex、API の `no-store` とエラーの扱い |
| kan/vegtab | #121 | ホーム画面に追加、`vite:preloadError`、版の表示 |
| kan/vegtab | #122 | `compatibility_date`、`observability`、Dependabot の cooldown |
| kan/vegtab | #123 | 送れなかったスコアのキューの上限 |
| kan/vegtab | #124 | ライセンス一覧の改良と、Service Worker の一覧の検査 |
| kan/vegtab | #125 | コードの構成を基本形（1 パッケージ）にそろえる |
