# セキュリティポリシー

## 脆弱性の報告

kan-game.app のポータルと ID 基盤に脆弱性を見つけたら、公開の Issue には書かず、GitHub の [Private vulnerability reporting](https://github.com/kan/game/security/advisories/new) から報告してください。報告の内容は、修正を公開するまでメンテナーにだけ見えます。

報告には次の内容を書いてください。

- 脆弱性の内容
- 再現の手順
- 想定される影響（読み書きできるデータ、必要な権限など）

受け取った報告は、できるだけ早く確認して返信します。

## 対象

対象は、このリポジトリのコード（`main` ブランチの最新）と、それを動かしている https://kan-game.app です。リリースの版は切っていないので、古いコミットへの修正の適用は行いません。

次のものは、それぞれの報告先へお願いします。

- 各ゲームの問題: そのゲームのリポジトリ（TAKO-SEN なら [kan/tako-sen](https://github.com/kan/tako-sen/security/policy)）
- 依存しているパッケージの脆弱性: そのパッケージの報告先
