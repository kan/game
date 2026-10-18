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

## 5. 本番の移行（R4）の当日

当日の順序の正本は TAKO-SEN の `docs/DEPLOY_PROD.md`「本番の移行（R4）」にある。kan/game 側の作業は次のとおり。どれも利用者の承認を得てから行う。

1. 予行のデータを消す（この文書の 4）。TAKO-SEN の 1 と同じ時点で行う
2. TAKO-SEN が書き出し直した `kan-game-import.sql` を取り込み、件数を確かめる（この文書の 3）。TAKO-SEN の 4 と同じ時点で行う
3. 検索エンジンに載せ、規約とポリシーを確定する。TAKO-SEN の 5（`tako` の `X-Robots-Tag` を外す）と同じ時点で出す
   - 2026-10-18 に、次の変更を用意してコミットした。当日は `npm run deploy:production` で出すだけでよい
     - `public/_headers`: `X-Robots-Tag: noindex` を `https://dev.kan-game.app/*` だけに付ける（`_headers` は URL にホスト名を含めて書ける）
     - `public/terms.html` と `public/privacy.html`: 「公開前の下書き」の注記と `<meta name="robots" content="noindex">` を消し、制定日を 2026 年 10 月 19 日にした
   - 出したら、本番の HTML に `X-Robots-Tag` が無く、dev には残ることを確かめる

     ```sh
     curl -sI https://kan-game.app/terms | grep -i x-robots-tag       # 何も出ない
     curl -sI https://dev.kan-game.app/terms | grep -i x-robots-tag   # noindex
     ```

## 6. 運用

2026-10-18 に利用者と決めた最小限の運用。濫用の監視（頻度制限と週 1 回のログの確認）とバックアップ（D1 の Time Travel）の方針は、TAKO-SEN の `docs/DEPLOY_PROD.md`「運用」と共通。

### 不適切な名前を消す

名前は本人が変えられないので、規約の連絡先で連絡を受け、運営者が消す。消された本人は、次にゲームを開いたときに名前を決め直せる（`getName` が `null` を返し、`registerName` がまた通る）。

1. kan/game 側で、その ID の名前の行を消す。ID は残るので、引き継ぎコード、復旧コード、ゲームの記録はそのまま使える

   ```sh
   npx wrangler d1 execute kan-game-prod --env production --remote --command "DELETE FROM names WHERE id = '<ID>'"
   ```

2. TAKO-SEN 側で、プロフィールの名前を仮の文字列に替えて同意を外す（TAKO-SEN の `docs/DEPLOY_PROD.md`「ゲーム名への対応」）。`WHERE` に元の名前を入れる。1 と 2 のあいだに本人が名前を決め直したとき、新しい名前を上書きしないため

注意:

- 消した名前はすぐに空き、誰でも（本人も）同じ名前を登録し直せる。kan/game には、使えない名前の一覧がない。同じ名前が繰り返されるようなら、一覧を設ける
- 名前は外部キーで ID につながるだけなので、行を消してもほかの表には影響しない

### 障害時の復旧

- Worker: 版を戻す。版の一覧は `npx wrangler versions list --env production` で見て、`npx wrangler rollback <版の ID> --env production` で戻す
  - **鍵の入れ替え（`ID_DESIGN.md`「鍵の管理」）より前の版へ戻さない。** 戻した版の `ID_PUBLIC_KEYS` に、新しい `kid` が無い。新しい鍵で署名された Cookie を検証できず、その端末は新しい ID を受け取り、元の ID を失う
  - 版を戻しても D1 のスキーマは戻らない。マイグレーションを当てた後に戻すときは、古い版がそのスキーマで動くかを確かめる
- D1: Time Travel で戻す。その時刻より後の書き込みは消えるので、利用者の承認を得てから行う

  ```sh
  npx wrangler d1 time-travel info kan-game-prod --env production   # 現在の地点
  npx wrangler d1 time-travel restore kan-game-prod --env production --timestamp <時刻>
  ```
- **`kan-game-prod` と `tako-prod` を片方だけ戻すと、ID と名前が食い違う。** 戻すときは、両方を同じ時刻へ戻すか、食い違いを確かめる
  - `kan-game-prod` だけを戻すと、その時刻より後に作られた ID は行が無くなる。Cookie の署名は有効なので、kan/game はその ID を退会済みとして扱う（`410 id_deleted` で Cookie を消す）。本人は次に開いたときに新しい ID を受け取り、`tako-prod` に残った記録には戻れない。その後に決めた名前も消え、ほかの人が取れるようになる
  - `tako-prod` だけを戻すと、kan/game には名前があるのに、ゲームの側でプロフィールと記録が消える。ゲームが名前を `getName` で引き直せば、名前は食い違わない
