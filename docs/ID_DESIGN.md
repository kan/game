# kan-game.app ID 基盤の設計書

ステータス: **承認済み**（2026-10-18）。
利用者の承認により、TAKO-SEN の本番リリース計画の段階 R0 の完了条件を満たした。

## 目的と範囲

kan-game.app の各ゲームで共通に使う匿名 ID の発行と検証の仕組みを定める。
対象は、ID の発行と延長、端末間の引き継ぎ、復旧コード、移行用の引き継ぎ用トークン、名前の登録、退会である。
ポータルの画面の設計と、各ゲームの記録の持ち方は対象外とする。

方針の正本は TAKO-SEN の `docs/NEXT_PHASE.md`「本番リリース計画（kan-game.app への移行）」である。
本書は同節の「ID 基盤の仕様」を前提にし、同節が本書に委ねた Cookie の形式、鍵の管理、API の一覧、D1 のスキーマを定める。
計画に書かれていない判断を本書で加えた箇所には「（本書で追加）」と記す。

## 計画から引き継ぐ前提

- ID は匿名で、初回アクセスで自動発行する。メールアドレスなどの個人情報は持たない
- 資格情報は `kan-game.app` 全体へ届く署名付きの Cookie で持つ。端末のストレージに `deviceId` やトークンを置かない
- 各ゲームの Worker は `/api/id/*` を Service Binding で ID 基盤の Worker へ中継する。画面から見ると同一オリジンの API になる
- 各ゲームの Worker は ID 基盤の公開鍵で Cookie の署名を検証する。API ごとに ID 基盤へ問い合わせない
- 名前は `kan-game.app` 全体で 1 つ。重複の判定は ID 基盤が持つ。公開への同意はゲームごとに取る
- 退会は `kan-game.app` 全体で一括。ゲーム単位の削除は設けない
- 開発環境は本番と別の D1、署名鍵、Cookie 名を使う
- 端末のデータを消したときの復旧手段は、利用者が控えた復旧コードだけとする（2026-10-18 に追加された決定）

## 構成

| 環境 | ホスト | Worker | D1 |
|---|---|---|---|
| 本番 | `kan-game.app` | `kan-game` | `kan-game-prod` |
| 開発 | `dev.kan-game.app` | `kan-game-dev` | `kan-game-dev` |
| ローカル | `localhost` | `wrangler dev` | ローカルの D1 |

1 つの Worker がポータルの画面、ID 基盤の API、アカウント画面を配る。
ゲームの Worker と ID 基盤の Worker は、互いに Service Binding を持つ。

- ゲーム → ID 基盤（binding 名 `ID`）: `/api/id/*` の中継と、名前の登録などの RPC
- ID 基盤 → ゲーム（binding 名 `GAME_<名前>`、例 `GAME_TAKO`）: 退会時の記録の削除の RPC

RPC は `WorkerEntrypoint` のメソッド呼び出しで行う（本書で追加）。
HTTP の口を公開しないので、ゲームと ID 基盤のあいだの呼び出しに署名や共有秘密が要らない。

## ID と Cookie

ID は `crypto.randomUUID()` が返す UUID v4 である。
ゲームはこの値をそのまま自分の D1 の `account_id` に使う。

Cookie の値は、ES256 で署名した JWT である。

| 項目 | 本番 | 開発 |
|---|---|---|
| Cookie 名 | `__Secure-kg_id` | `__Secure-kgdev_id` |
| `iss` | `kan-game.app` | `dev.kan-game.app` |
| 属性 | `Domain=kan-game.app; Path=/; Secure; HttpOnly; SameSite=Lax` | 同じ |
| 有効期限 | `Max-Age=34560000`（400 日） | 同じ |

JWT のヘッダーは `alg: ES256` と `kid`、クレームは `sub`（ID）、`iss`、`iat`、`exp`（`iat` の 400 日後）である。
ゲームが検証する項目は、署名、`alg`、`kid` が既知の鍵であること、`iss`、`exp` である。

- 加えて、`typ` が `JWT` であること、`iat` と `exp` が整数の秒であること、`iat` が現在より 5 分を超えて未来でないこと、`exp - iat` が 400 日以内であることも確かめる（本書で追加）
- 同じ名前の Cookie が複数届いたときは、すべてを検証し、最初に有効なものを使う。検証する数に上限は設けない（本書で追加）
  - 上限があると、先頭に並んだ偽の Cookie で本物が隠れる。サブドメインのスクリプトは、パスの長い偽の Cookie を足して先に送らせることができる。本物が隠れると新しい ID が発行され、本物の Cookie は上書きされて利用者は ID を失う
  - 検証の回数は、リクエストヘッダーの合計の上限（128 KB）で、多くても 400 回ほどに抑えられる

本番と開発の Cookie はどちらも `Domain=kan-game.app` なので、開発のホストにも本番の Cookie が届く。
名前と署名鍵が違うので、開発の Worker は本番の Cookie を ID として受け付けない。

発行済みの Cookie を個別に失効させる仕組みは設けない（本書で追加）。
退会した ID の Cookie は、ゲームと ID 基盤の両方が削除済みの ID として断る（「退会」を参照）。
そのほかに Cookie を無効にしたい場面（端末の紛失など）は、匿名 ID の用途では想定しない。

## 鍵の管理

署名鍵は P-256 の鍵ペアである。

- 秘密鍵は JWK として ID 基盤の Worker の secret `ID_SIGNING_KEY` に置く。`kid` を JWK に含める
- 公開鍵の一覧は JWK の配列として、ID 基盤とゲームの Worker の環境変数 `ID_PUBLIC_KEYS` に置く
- ゲームの Worker は公開鍵を isolate ごとに 1 回だけ読み込む（TAKO-SEN の `docs/PERFORMANCE.md` の方針）

鍵の入れ替えは次の順で行う。

1. 新しい公開鍵を、ID 基盤とすべてのゲームの `ID_PUBLIC_KEYS` に足してデプロイする
2. ID 基盤の `ID_SIGNING_KEY` を新しい秘密鍵に替える。以後の発行と延長は新しい鍵で署名する
3. 古い公開鍵は、ゲームからは 30 日後に外す。ID 基盤には 400 日のあいだ残す

ID 基盤に古い公開鍵を残すのは、ゲームが古い鍵の Cookie を断ったあとでも、延長の API がその Cookie を受け取って新しい鍵で署名し直せるようにするためである。
各ゲームは起動時に延長の API を呼ぶので、30 日のあいだに 1 度でも遊んだ端末は新しい鍵へ移る。

署名の検証のコードは、各ゲームが写して持つ（本書で追加）。
`kan/game` は private なので、npm の依存として配ると各ゲームの CI に読み取りの権限が要る。
写しが食い違わないように、`kan/game` に検証用のテストベクター（正しい Cookie、期限切れ、別の `iss`、未知の `kid`）を置き、各ゲームのテストで読む。

- 写すのは `src/token.ts`（署名の検証）と `src/rpc.ts`（RPC の契約の型）で、どちらも書き換えずに写す（本書で追加）
- テストベクターは `test-vectors/id-token.json` で、公開鍵、`iss`、検証の基準時刻 `now`、トークンと期待する結果の組、Cookie ヘッダーと期待する ID の組を持つ。設計書が挙げた 4 つに、下のケースを加えた。照合の仕方は `test/vectors.test.ts` を写す（本書で追加）
  - 鍵の切り替え中を想定した、2 本目の公開鍵で署名したトークン
  - `exp` の境界（ちょうど `now` と、その 1 秒後）
  - 改ざんした署名と本文、`alg` の違い、文字列でない `kid`、`iat` の無い本文、64 バイトでない署名、UUID でない `sub`、形式の誤り
  - 同名の Cookie の並び（有効なものが前と後ろ）と、名前が前方または後方だけ一致する Cookie
  - `typ` の無いトークン、整数でない `iat`、`iat` の境界（現在の 5 分後と、その 1 秒後）、`exp - iat` が 400 日を超えるトークン、多数の偽の Cookie（署名の検証まで届くものを含む）の後ろにある本物の Cookie
- テストベクターの秘密鍵は生成時だけ使って捨てる。トークンの形式を変えるときだけ `scripts/generate-test-vectors.mjs` で作り直し、ゲームの写しも合わせて更新する（本書で追加）

## HTTP の API

画面からは `/api/id/*` として呼ぶ。
ポータルでは `kan-game.app/api/id/*`、ゲームでは自分のオリジンの `/api/id/*`（ゲームの Worker が中継する）になる。

| メソッドとパス | 要 ID | 呼べるオリジン | 内容 |
|---|---|---|---|
| `POST /api/id/session` | 不要 | 全体 | ID の発行と延長。応答は `{ id, name, status }` |
| `POST /api/id/transfer-codes` | 要 | 全体 | 引き継ぎコードの発行。応答は `{ code, expiresAt }` |
| `POST /api/id/transfer-codes/redeem` | 不要 | 全体 | 引き継ぎコードの入力。本文は `{ code }` |
| `POST /api/id/recovery-code` | 要 | ポータル | 復旧コードの発行と再発行。応答は `{ code }` |
| `POST /api/id/recovery-code/redeem` | 不要 | ポータル | 復旧コードの入力。本文は `{ code }` |
| `POST /api/id/migration/redeem` | 不要 | 全体 | 引き継ぎ用トークンの入力。本文は `{ token }` |
| `POST /api/id/delete` | 要 | ポータル | 退会 |

- すべて `POST` で、`Origin` が環境ごとの許可済みのオリジン（ポータルのオリジンと、環境変数 `ALLOWED_ORIGINS` に書いたゲームのオリジン）と一致しないものは `403 origin_not_allowed` で断る
- 「呼べるオリジン」がポータルのものは、ポータルのオリジンだけを許可する。復旧コードと退会の画面はポータルにだけ置くため（本書で追加）
  - ポータルのオリジンは環境変数 `PORTAL_ORIGIN` に置く。ほかのオリジンからは `403 origin_not_allowed` を返す（本書で追加）
  - `PORTAL_ORIGIN` はすべての API で常に許可する。`ALLOWED_ORIGINS` にはゲームのオリジンだけを書く（本書で追加）
- 入力の API（`redeem`）は、成功するとその端末の Cookie を対象の ID に切り替え、応答は `{ id, name, status }` とする。切り替え前の ID は、どの端末にも紐付かなくなる。記録を統合しない
- 要 ID の API に有効な Cookie がないときは `401 no_id` を返す
- 要 ID の API に、署名は有効だが退会済みの ID の Cookie が届いたときは、`410 id_deleted` を返して Cookie を消す（本書で追加）
- 入力の API で、コードやトークンが誤り、期限切れ、使用済みのいずれかなら、区別せずに `400 invalid_code` を返す。本文が JSON のオブジェクトでなければ `400 invalid_request` を返す（本書で追加）
- 頻度の制限を超えたときは `429 rate_limited` を返す
- 応答の `expiresAt` は Unix エポックからのミリ秒である（本書で追加）

`status` は `active` か `deleting`（退会の途中）である。

## ゲームとの RPC

ID 基盤がゲームに提供するもの（`ID` binding）は次のとおり。

| メソッド | 結果 |
|---|---|
| `getName(id)` | 名前、または `null` |
| `registerName(id, name)` | `ok`（登録した名前）、`name_taken`、`invalid`、`already_named`（既存の名前） |

- 結果は `{ result, name? }` の形で返す。`name` は `ok` と `already_named` のときだけ付く（本書で追加）
- ID が存在しないか退会の途中なら、`registerName` は `no_id` を返す。`getName` は退会済みの ID に `null` を返す（本書で追加）
- ID 基盤の Worker の default export は `WorkerEntrypoint` で、ゲームの `ID` binding は entrypoint を指定せずにつなぐ（本書で追加）
- RPC の契約の型は `kan/game` の `src/rpc.ts` に置く。このファイルは何も import しないので、各ゲームは写して使う（本書で追加）

ゲームが ID 基盤に提供するもの（`GAME_<名前>` binding）は次のとおり。

| メソッド | 内容 |
|---|---|
| `deleteAccount(id)` | 削除済みの ID として記録し、その ID の記録をすべて消す。何度呼んでも同じ結果になる |

## 各操作の流れ

### ID の発行と延長

ゲームとポータルの画面は、起動したときと、オフラインから復帰したときに `POST /api/id/session` を呼ぶ。

- 有効な Cookie があり、その ID が D1 にあれば、新しい `exp` で署名し直した Cookie を返す。`last_seen_at` は 1 日に 1 回だけ更新する
- Cookie がない、または署名が無効なら、新しい ID を発行して Cookie を返す
- 署名は有効だが ID が D1 にない（退会済み）なら、Cookie を消す応答を返し、新しい ID は発行しない。画面が再び呼べば新しい ID になる
  - この応答は `410 id_deleted` とする（本書で追加）

計画は「Cookie なしで初めて届いたリクエストで発行する」としている。
本書では発行を `POST /api/id/session` に限る（本書で追加）。
`GET` やクローラーのアクセスで ID が作られないようにするため。

ID 基盤に届かないときも、ゲームは止めない。
発行と延長は、次に起動したときか、オフラインから復帰したときに再試行する。

### 引き継ぎコード

vegtab と同じ仕様にする。

- 8 文字で、英大文字と数字から紛らわしい文字（0、O、1、I）を除いた 32 種を使う
- 有効期限は 10 分、1 回限り。新しいコードを発行すると、同じ ID の古いコードは消える
- 入力されたコードは大文字に揃えてから探す。探すことと消費は 1 つのトランザクションで行う
  - 大文字へ揃える前に NFKC で正規化し、空白とハイフン（全角や長音記号を含む）を除く。日本語の入力で全角になった文字と、利用者が区切って書き写したコードを受け付けるため（本書で追加）
- 退会の途中（`status` が `deleting`）の ID は、引き継ぎコードを発行できない（`409 id_deleting`）。退会の前に発行したコードを入力されても、切り替えずに `400 invalid_code` を返す。消す途中の ID がほかの端末へ広がらないようにするため（本書で追加）

### 復旧コード

- 20 文字で、引き継ぎコードと同じ 32 種の文字を使う（100 ビット）。表示は 4 文字ずつ区切る
- 発行時に一度だけ表示する。ID 基盤は SHA-256 のハッシュだけを保存する。乱数の長さが十分なので、遅いハッシュは使わない
- 1 つの ID に有効な復旧コードは 1 つ。再発行すると古いコードは使えなくなる
- 入力すると、その端末の Cookie を復旧コードの ID に切り替える。使ったあとも、再発行するまで有効とする（本書で追加）
- 応答の `code` は区切らない 20 文字で返し、4 文字ずつの区切りはポータルの画面が付ける。入力は引き継ぎコードと同じ規則で正規化するので、区切ったまま入力してもよい（本書で追加）
- 退会の途中の ID は、引き継ぎコードと同じく、復旧コードを発行できない（`409 id_deleting`）。入力されても切り替えずに `400 invalid_code` を返す（本書で追加）
- SHA-256 のハッシュは 16 進の小文字で保存する。引き継ぎ用トークンも同じ（本書で追加）

### 引き継ぎ用トークン

TAKO-SEN の開発環境の記録を本番へ移すときに使う。

- 32 バイトの乱数を base64url で表した文字列。ID 基盤は SHA-256 のハッシュと ID と有効期限だけを保存する
- 移行の作業で、手元のスクリプトがトークンとハッシュを作り、ハッシュを `wrangler d1 execute` で ID 基盤の D1 に登録する。登録の API は設けない（本書で追加）
- 有効期限までは、同じトークンを複数の端末で使える
- base64url は `=` を付けない 43 文字とし、ハッシュはこの文字列の SHA-256 とする。退会の途中の ID のトークンは、入力されても切り替えずに `400 invalid_code` を返す（本書で追加）

### 名前

名前の規則は TAKO-SEN の現行の規則を全体の規則にする。

- NFC に正規化し、前後の空白を除く
- 見た目の文字数（書記素クラスタ）で 2〜20 文字。UTF-16 で 256 単位まで
- 使える文字は、文字、数字、結合文字、空白、`_`、`-`、絵文字。絵文字でない文字に異体字セレクタ（U+FE0E、U+FE0F）を付けない
- 正規化後の文字列が既存の名前と同じなら、重複として断る（似た文字の同一視はしない）
- 変更はできない（計画の「変更は保留」）

名前は次の順で登録する。

1. 画面が名前と公開への同意をゲームの Worker に送る
2. ゲームの Worker が `registerName` を呼ぶ。`already_named` なら、既存の名前を使う
3. 登録できたら、ゲームの Worker が名前と同意を自分の D1 に書く

3 で失敗しても、同じ名前で `registerName` をもう一度呼べば `ok` を返すので、画面から再送できる。
画面は名前を聞く前に `POST /api/id/session` の `name` を見て、名前を設定済みなら同意だけを求める。

### 退会

ポータルのアカウント画面から `POST /api/id/delete` を呼ぶ。

1. ID の `status` を `deleting` にする
2. 登録されているすべてのゲームの `deleteAccount(id)` を順に呼ぶ
3. すべて成功したら、ID、名前、引き継ぎコード、復旧コード、引き継ぎ用トークンを消し、Cookie を消す応答を返す
4. 1 つでも失敗したら `503` を返し、`status` を `deleting` のまま残す。アカウント画面は `status` が `deleting` のとき、退会をやり直すよう案内する

ゲームは `deleteAccount` を受けた時点で、その ID を削除済みとして記録し、以後その ID からの書き込みを断る。
Cookie は退会後も最長 400 日有効なので、ゲームは自分の D1 に削除済みの ID を残し続ける。
ID 基盤は ID の行が消えていることで退会済みと判定する（「ID の発行と延長」）。

次の点は本書で追加した。

- 「登録されているすべてのゲーム」は、環境変数 `GAMES` に列挙した binding（カンマ区切り）である。列挙した順で呼び、失敗したゲームがあればそこで止める。列挙した binding が無ければ、ID を変更する前に `500 deletion_misconfigured` を返す。設定を書き忘れたゲームが、誰も気付かないまま削除の対象から外れることを防ぐため
- 成功したら `200` と本文 `{ "status": "deleted" }` を返し、失敗したら `503 deletion_incomplete` を返す
- `status` が `deleting` の ID も、この API を呼べる（やり直しのため）
- `deleting` のまま残った ID は、1 日 1 回の定期実行でも退会をやり直す。ゲームの障害で止まった退会を、利用者が戻らなくても完了させるため。1 回の実行で扱う ID はランダムに選んだ 50 件までとし、最初に失敗した時点でその回をやめる。障害の続くゲームのタイムアウトを ID の数だけ待たないため（2026-10-18 に利用者と決めた）

退会した ID の名前は、ほかの ID が取得できるようになる（本書で追加）。

## 濫用への対策

頻度の制限は Workers の Rate Limiting binding で、IP 単位に行う。
この binding の期間は 10 秒か 60 秒しか選べないので、60 秒あたりの回数で決める。

| 操作 | 上限 |
|---|---|
| ID の発行 | 10 回 / 60 秒 |
| 引き継ぎコードの入力 | 5 回 / 60 秒 |
| 復旧コードの入力 | 5 回 / 60 秒 |
| 引き継ぎ用トークンの入力 | 5 回 / 60 秒 |

制限の数は Cloudflare の拠点ごとに数えられ、厳密な上限にはならない。
引き継ぎコードは 40 ビットで有効期限が 10 分なので、この程度の誤差では総当たりが成り立たない。

`Origin` の確認は、計画のとおり状態を変えるすべての API で行う。

## D1 のスキーマ

時刻は Unix エポックからのミリ秒の整数で持つ（TAKO-SEN と同じ）。

```sql
CREATE TABLE ids (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE names (
  id TEXT PRIMARY KEY REFERENCES ids(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE transfer_codes (
  code TEXT PRIMARY KEY,
  id TEXT NOT NULL REFERENCES ids(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX transfer_codes_id ON transfer_codes (id);

CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY REFERENCES ids(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE migration_tokens (
  token_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL REFERENCES ids(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX migration_tokens_id ON migration_tokens (id);
```

期限切れの引き継ぎコードと引き継ぎ用トークンは、1 日 1 回の定期実行で消す。

## ローカルの開発

`wrangler dev` に ID 基盤とゲームの設定を両方渡して起動すると、Service Binding がローカルでつながる。
ローカルでは環境変数 `COOKIE_DOMAIN` を空にし、Cookie を `localhost` だけに付ける。
`__Secure-` の Cookie を `http://localhost` で受け付けるかはブラウザによって違うので、R1 で確かめる。

## テスト

- 単体と結合のテストは `@cloudflare/vitest-plugin`（旧名 `@cloudflare/vitest-pool-workers`）で、ローカルの D1 に対して行う
- 計画の R1 の完了条件（発行、検証、引き継ぎ、名前の登録と重複の拒否、退会を自動テストと 2 端末で確認する）に、復旧コードと引き継ぎ用トークンの入力を加える
- 2 端末の確認には iPhone の Safari を含める。Safari がサーバーの設定した Cookie の有効期限を短くする条件に当たらないかを確かめる

## vegtab からの変更点

| 項目 | vegtab | 本書 |
|---|---|---|
| 資格情報 | 端末のストレージに `deviceId`、Bearer の JWT | `Domain=kan-game.app` の Cookie に入れた JWT |
| 署名 | HS256 の共有秘密 | ES256。ゲームは公開鍵だけを持つ |
| トークン | アクセス 1 時間とリフレッシュ 90 日。リフレッシュは使うたびに作り直す | 1 本で 400 日。起動時に延長する |
| 端末の管理 | `user_devices` で `deviceId` と ID を結ぶ | 持たない。端末は Cookie だけで ID を持つ |
| 復旧 | なし | 復旧コード |
| 時刻の型 | `datetime('now')` の文字列 | ミリ秒の整数 |

リフレッシュトークンの作り直しは、盗まれたトークンの再利用を見つけるための仕組みである。
匿名 ID の Cookie は `HttpOnly` で画面のスクリプトから読めず、失って困る個人情報も持たないので、本書では採らない。

## 草案の段階で決めたこと

2026-10-18 に利用者と確認した。

1. 復旧コードは、使ったあとも再発行するまで有効とする。1 回で無効にする方式では、利用者が復旧のあと毎回新しいコードを発行して控え直す必要がある
2. 退会した ID の名前は、ほかの ID が取得できる。TAKO-SEN の現行の退会も名前の行を消すので、同じ扱いになる
3. 長く使われていない ID は消さない。消す場合は、各ゲームの記録とランキングへの影響を別に決める
4. 頻度の制限の数は「濫用への対策」の表のとおりとする
