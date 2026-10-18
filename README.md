# kan-game

kan-game.app のポータルと ID 基盤の Worker。
設計は [`docs/ID_DESIGN.md`](docs/ID_DESIGN.md)、方針の正本は TAKO-SEN の `docs/NEXT_PHASE.md`「本番リリース計画（kan-game.app への移行）」にある。

## 構成

| パス                               | 内容                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/index.ts`                     | Worker の本体（HTTP、定期実行、ゲーム向けの RPC）                                                |
| `src/router.ts`                    | `/api/id/*` のルーター                                                                           |
| `src/names.ts`                     | 名前の規則と、名前の取得と登録（RPC）                                                            |
| `src/account.ts`                   | 退会（止まった退会の定期実行でのやり直しを含む）                                                 |
| `src/rpc.ts`                       | ゲームとの RPC の契約の型。各ゲームはこのファイルを写して使う                                    |
| `src/session.ts`                   | `POST /api/id/session`（ID の発行と延長）                                                        |
| `src/transfer.ts`                  | 引き継ぎコードの発行と入力                                                                       |
| `src/recovery.ts`                  | 復旧コードの発行と入力（ポータル限定）                                                           |
| `src/migration.ts`                 | 引き継ぎ用トークンの入力                                                                         |
| `src/redeem.ts`                    | 入力の API に共通の流れ                                                                          |
| `src/maintenance.ts`               | 期限切れの行を消す定期実行                                                                       |
| `src/id.ts`                        | Cookie からの ID の読み取りと、Cookie を設定する応答の組み立て                                   |
| `src/token.ts`                     | Cookie の JWT（ES256）の署名と検証。各ゲームはこのファイルを写して検証に使う                     |
| `migrations/`                      | D1 のスキーマ                                                                                    |
| `public/`                          | ポータルの画面。トップ、アカウント画面、利用規約とプライバシーポリシー（どちらも公開前の下書き） |
| `public/assets/`                   | 画面の JavaScript（`lib.js` / `portal.js` / `account.js`）と CSS                                 |
| `scripts/generate-signing-key.mjs` | 署名鍵（P-256）の生成                                                                            |
| `test-vectors/id-token.json`       | ゲームが写した `src/token.ts` を照合するテストベクター                                           |

## ゲームから使う

各ゲームは次のファイルを書き換えずに写す（`kan/game` は private なので npm の依存にしない）。

- `src/token.ts`: Cookie の検証。写したら `test-vectors/id-token.json` も写し、`test/vectors.test.ts` と同じ照合をゲームのテストに入れる
- `src/rpc.ts`: `ID` binding の型（`Service<IdRpc>`）と、ゲームが実装する `GameService`
- `testing/fake-id-platform.ts`（テスト用）: `IdRpc` の偽物。名前の規則と結果は本物と同じで、「別の ID が名前を持っている」「別のゲームで名前を設定済み」「退会の途中」の状態を作れる
- `testing/test-id-cookie.ts`（テスト用）: 鍵を作り、`ID_PUBLIC_KEYS` の値と、指定した ID で署名した Cookie を返す

`testing/` のファイルは何も import しない。本物と食い違わないことは `test/testing-kit.test.ts` で確かめている。

## ローカルの開発

```sh
npm install
npm run generate-key -- --dev-vars   # .dev.vars にローカル用の鍵を書く
npx wrangler d1 migrations apply DB --local
npm run dev                          # http://localhost:8787（ポータル）、/account（アカウント画面）
```

画面は `public/` の静的ファイルで、ビルドは要らない。編集して読み込み直せば反映される。
画面は `http://localhost:8787` で開く。`127.0.0.1` や別のポートで開くと、オリジンが `PORTAL_ORIGIN` と合わず、API が `origin_not_allowed` で断られる（変えるなら `.dev.vars` で `PORTAL_ORIGIN` を上書きする）。

`wrangler.jsonc` の先頭の設定がローカル用で、Cookie は `localhost` だけに付く。
別のポートで動かすゲームから ID の API を呼ぶときは、そのオリジン（例 `http://localhost:5173`）を `.dev.vars` の `ALLOWED_ORIGINS` に書く。

## テスト

```sh
npm test            # @cloudflare/vitest-plugin でローカルの D1 に対して実行
npm run typecheck   # Worker（tsconfig.json）と画面の JavaScript（tsconfig.public.json）
```

テスト用の鍵は実行のたびに `vitest.config.ts` が生成する。
`wrangler.jsonc` を変えたら `npm run cf-typegen` で `worker-configuration.d.ts` を作り直す。

## 開発環境（dev.kan-game.app）へのデプロイ

2026-10-18 に初回のデプロイを済ませた（D1 `kan-game-dev`、Worker `kan-game-dev`、カスタムドメイン `dev.kan-game.app`）。普段は次の 2 つだけでよい。

```sh
npx wrangler d1 migrations apply DB --env dev --remote   # マイグレーションを足したとき
npm run deploy:dev
```

署名鍵を入れ替えるときは、秘密鍵を端末に出さないよう `--secrets-file` を使う。手順の全体は設計書「鍵の管理」にある。

```sh
npm run generate-key -- --secrets-file <一時ファイル>   # 公開鍵だけが表示される
# 表示された公開鍵を env.dev.vars.ID_PUBLIC_KEYS の配列に足す
npx wrangler deploy --env dev --secrets-file <一時ファイル>
rm <一時ファイル>
```
