# 読書記録（My Record of Reading）

読んだ本と読書時間を記録する、Windows向けの個人用デスクトップアプリです。
ISBNを入れる（バーコードリーダーで読む）だけで本を登録できます。

## できること（最小版）

- ISBN（10桁・13桁）から書誌情報と表紙を自動取得して登録
  - openBD → Google Books → 国立国会図書館サーチ の順に検索し、見つからなければ書名だけ手入力
- 本の一覧（状態タブ、タグでの絞り込み）
- タグ（ジャンル）を1冊に複数付ける
- 読書回の記録：状態（積読・読書中・読了・中断）、開始日・読了日、5段階評価、所感、日常に活かせそうなこと
- 再読：同じ本に2回目、3回目の読書回を追加。回ごとに評価と所感を残せる
- 読書時間：タイマー（アプリを閉じても続く）または手入力。本ごと・回ごとの合計と、今日の読書時間を表示

統計、年間目標、読書カレンダーなどはステップ3で追加します。

## 使い方（Windows）

1. [Node.js](https://nodejs.org/ja) のLTS版をインストールします。
2. このリポジトリをクローンして、フォルダで次を実行します。

   ```
   npm install
   npm start
   ```

USBバーコードリーダーはキーボード入力として扱われるので、ISBN欄にカーソルがある状態で本の裏表紙のバーコード（978で始まる方）を読めば、そのまま登録確認に進みます。

データは `%APPDATA%\my-record-of-reading\reading-log.sqlite` に保存されます。このファイルをコピーすればバックアップになります。

## 開発

| コマンド | 内容 |
| --- | --- |
| `npm start` | ビルドしてアプリを起動 |
| `npm test` | 単体テスト（データ保存、ISBN処理） |
| `npm run typecheck` | 型チェック |

構成：Electron + React + TypeScript、データはSQLite（sql.js。ネイティブモジュールのビルドが不要）。

Windows 11 のスマートアプリコントロールは署名のないネイティブ部品（`.node` や `.exe`）の実行を止めるため、`package.json` の `overrides` で Rollup と esbuild を WebAssembly 版（`@rollup/wasm-node`、`esbuild-wasm`）に置き換えています。ビルドは少し遅くなりますが、結果は同じです。

また、一部のWindows環境ではNode.jsの乱数取得（`crypto.getRandomValues`）が `entropy source strength too weak` で失敗し、esbuild（WebAssembly版）が起動できません。`npm run build:renderer` は `scripts/build-renderer.cjs` 経由で Vite を起動し、乱数取得が失敗したときだけ代わりの値を使うようにしています（`scripts/random-fallback.cjs`。esbuild内部のハッシュ用で、安全性には関係しません）。

```
src/main      メインプロセス（DB、ISBN検索、IPC）
src/preload   画面に公開するAPI
src/renderer  画面（React）
src/shared    共通の型
tests         単体テスト
```
