# 本番環境（kan-game.app）の手順

kan/game の本番環境を作り、動かすための手順。
環境の構成は [`ID_DESIGN.md`](ID_DESIGN.md)「構成」、作業段階は TAKO-SEN の `docs/NEXT_PHASE.md`「本番リリース計画」による。

| 項目 | 値 |
|---|---|
| Worker | `kan-game`（`wrangler.jsonc` の `env.production`） |
| D1 | `kan-game-prod` |
| ホスト | `kan-game.app`（カスタムドメイン） |
| Cookie | `__Secure-kg_id`（`Domain=kan-game.app`） |
| `iss` | `kan-game.app` |
| `ALLOWED_ORIGINS` | `https://tako.kan-game.app` |
| `PORTAL_ORIGIN` | `https://kan-game.app` |
| ゲーム | `GAME_TAKO`（Worker `tako` の entrypoint `GameService`） |

## 1. 初回の作成（R3）

2026-10-18 に手順 1〜5 を済ませた（D1 `9c10d958-…`、署名鍵の `kid` は `2026-10-18-ccfc63`）。同日、3 の予行の取り込み（11 人分）も済ませた。

TAKO-SEN の本番 Worker `tako` と kan-game は、互いを service binding で指す。
kan-game を `GAME_TAKO` なしで先に出し、`tako` が出てから `GAME_TAKO` 付きで出し直す。

1. D1 を作り、表示された `database_id` を `env.production` の `d1_databases` に書く

   ```sh
   npx wrangler d1 create kan-game-prod
   ```

2. 本番の署名鍵を作る。秘密鍵は一時ファイルにだけ書かれ、端末には公開鍵だけが表示される。公開鍵を `env.production.vars.ID_PUBLIC_KEYS` の配列に書き、TAKO-SEN にも渡す（`tako` の `ID_PUBLIC_KEYS` に写す）

   ```sh
   npm run generate-key -- --secrets-file <一時ファイル>
   ```

3. スキーマを適用する

   ```sh
   npx wrangler d1 migrations apply DB --env production --remote
   ```

4. 秘密鍵を secret として登録しながら出し、一時ファイルを消す

   ```sh
   npx wrangler deploy --env production --secrets-file <一時ファイル>
   rm <一時ファイル>
   npx wrangler secret list --env production   # ID_SIGNING_KEY が secret_text であること
   ```

5. TAKO-SEN が `tako` を出したら、`env.production` に `GAME_TAKO` を足して出し直す

   ```jsonc
   "services": [{ "binding": "GAME_TAKO", "service": "tako", "entrypoint": "GameService" }],
   // vars
   "GAMES": "GAME_TAKO",
   ```

   ```sh
   npm run deploy:production
   ```

   **`tako` が無いうちに `GAME_TAKO` 付きで出さない。** binding の先が無く、退会が毎回 `503 deletion_incomplete` になる。

## 2. 普段の更新

```sh
npx wrangler d1 migrations apply DB --env production --remote   # マイグレーションを足したとき
npm run deploy:production
```

署名鍵の入れ替えは `ID_DESIGN.md`「鍵の管理」の順に行う。新しい秘密鍵も、1 の手順 2、4 のように `--secrets-file` で渡す。

## 3. 移行データの取り込み（R3 の予行と R4 の本番）

TAKO-SEN の移行スクリプトが作る SQL を `wrangler d1 execute` で流す。

```sh
npx wrangler d1 execute kan-game-prod --env production --remote --file <SQL ファイル>
```

SQL は次の前提を満たすこと。満たさない行は、取り込めても ID 基盤が正しく扱えない。

- `ids` を、`names` と `migration_tokens` より先に入れる（外部キーがあるため）
  - `id` は小文字の UUID v4（`crypto.randomUUID()` の形）。Cookie の検証が小文字の UUID v4 だけを受け付ける
  - `status` は `'active'`。`created_at` と `last_seen_at` はミリ秒の整数で、取り込む時刻を入れてよい
- `names` の `display_name` は、ID 基盤の名前の規則で正規化済みの形（NFC、前後の空白なし）にする。`testing/fake-id-platform.ts` の `normalizeName(name) === name` で確かめられる。名前は全体で一意（`UNIQUE`）
- `migration_tokens` の `token_hash` は、トークン（`=` の無い 43 文字の base64url）の文字列を UTF-8 で SHA-256 にかけた 16 進の小文字。`expires_at` はミリ秒の整数
- トリガーは無い。取り込みのために足す列も無い

取り込んだら、件数を確かめる。

```sh
npx wrangler d1 execute kan-game-prod --env production --remote --command "SELECT (SELECT COUNT(*) FROM ids) AS ids, (SELECT COUNT(*) FROM names) AS names, (SELECT COUNT(*) FROM migration_tokens) AS tokens"
```

## 4. R4 の前に空に戻す

R3 の予行で入れたデータを、R4 の本番の取り込みの前に消す。
`ids` を消すと、外部キーの `ON DELETE CASCADE` で `names`、`transfer_codes`、`recovery_codes`、`migration_tokens` も消える。

```sh
npx wrangler d1 execute kan-game-prod --env production --remote --command "DELETE FROM ids"
```

- 消したら、3 の件数の確認で、どれも 0 になったことを確かめる
- TAKO-SEN の本番 D1（`tako-prod`）も同じ時点で空に戻す（TAKO-SEN の手順による）。片方だけ戻すと、ゲームの記録と ID が食い違う
- D1 の Time Travel には、消した時点より前の状態が 30 日残る。取り込みをやり直すときは、消した後の空の状態から始める
- 予行のあいだに `kan-game.app` で作られた ID（予行の確認で開いた端末など）も消える。その端末は、次に開いた時点で新しい ID になる

## 5. 告知（R4）で検索エンジンに載せる

告知までは、`public/_headers` の `X-Robots-Tag: noindex` で、dev と本番の両方を検索エンジンに載せない。
`_headers` は dev と本番で共有なので、告知のときに本番だけ外す方法を決める（例: 本番の Worker で、HTML の応答からこのヘッダーを外す）。利用規約とプライバシーポリシーの下書きの表示を外し、制定日を入れるのも同じ時点にする。
