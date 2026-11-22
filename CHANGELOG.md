# Changelog

パッケージ `kan-game`（ゲームへ配る ID の契約）の変更履歴。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。ポータルと ID 基盤の Worker の
変更は、ゲームへ配るファイルが変わらない限りここに書かない。

## [Unreleased]

### Changed

- ゲームへ配るファイルに変更はない。ゲームを `kan-game` に切り替えたあと、Dependabot が git の tag の
  依存に更新の PR を出すかを確かめるために出す版（[#5](https://github.com/kan/game/issues/5)）

## [1.0.0] - 2026-11-22

### Added

- ID の契約をパッケージとして配るようにした。ゲームは `github:kan/game#semver:^1.0.0` で依存に書き、
  `kan-game/token`、`kan-game/rpc`、`kan-game/name-rules`、`kan-game/testing/fake-id-platform`、
  `kan-game/testing/test-id-cookie`、`kan-game/test-vectors/id-token.json` を import する
  （[#3](https://github.com/kan/game/issues/3)）

[1.0.0]: https://github.com/kan/game/releases/tag/v1.0.0
