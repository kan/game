# kan-game

kan-game.app のポータルと ID 基盤の Worker。
設計は [`docs/ID_DESIGN.md`](docs/ID_DESIGN.md)、方針の正本は TAKO-SEN の `docs/NEXT_PHASE.md`「本番リリース計画（kan-game.app への移行）」にある。

## 構成

| パス                               | 内容                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `src/index.ts`                     | Worker の本体（HTTP、定期実行、ゲーム向けの RPC）                            |
| `src/router.ts`                    | `/api/id/*` のルーター                                                       |
| `src/names.ts`                     | 名前の規則と、名前の取得と登録（RPC）                                        |
| `src/account.ts`                   | 退会                                                                         |
| `src/rpc.ts`                       | ゲームとの RPC の契約の型。各ゲームはこのファイルを写して使う                |
| `src/session.ts`                   | `POST /api/id/session`（ID の発行と延長）                                    |
| `src/transfer.ts`                  | 引き継ぎコードの発行と入力                                                   |
| `src/recovery.ts`                  | 復旧コードの発行と入力（ポータル限定）                                       |
| `src/migration.ts`                 | 引き継ぎ用トークンの入力                                                     |
| `src/redeem.ts`                    | 入力の API に共通の流れ                                                      |
| `src/maintenance.ts`               | 期限切れの行を消す定期実行                                                   |
| `src/id.ts`                        | Cookie からの ID の読み取りと、Cookie を設定する応答の組み立て               |
| `src/token.ts`                     | Cookie の JWT（ES256）の署名と検証。各ゲームはこのファイルを写して検証に使う |
| `migrations/`                      | D1 のスキーマ                                                                |
| `scripts/generate-signing-key.mjs` | 署名鍵（P-256）の生成                                                        |

## ローカルの開発

```sh
npm install
npm run generate-key -- --dev-vars   # .dev.vars にローカル用の鍵を書く
npx wrangler d1 migrations apply DB --local
npm run dev                          # http://localhost:8787
```

`wrangler.jsonc` の先頭の設定がローカル用で、Cookie は `localhost` だけに付く。
別のポートで動かすゲームから ID の API を呼ぶときは、そのオリジン（例 `http://localhost:5173`）を `.dev.vars` の `ALLOWED_ORIGINS` に書く。

## テスト

```sh
npm test            # @cloudflare/vitest-plugin でローカルの D1 に対して実行
npm run typecheck
```

テスト用の鍵は実行のたびに `vitest.config.ts` が生成する。
`wrangler.jsonc` を変えたら `npm run cf-typegen` で `worker-configuration.d.ts` を作り直す。

## 開発環境（dev.kan-game.app）へのデプロイ

初回だけ次を行う。

1. `npx wrangler d1 create kan-game-dev` を実行し、表示された `database_id` を `wrangler.jsonc` の `env.dev` に書く
2. `npm run generate-key` で鍵を作る。秘密鍵を `npx wrangler secret put ID_SIGNING_KEY --env dev` で登録し、公開鍵を `env.dev.vars.ID_PUBLIC_KEYS` の配列に足す
3. `npx wrangler d1 migrations apply DB --env dev --remote`

以後は `npm run deploy:dev` で出す。
