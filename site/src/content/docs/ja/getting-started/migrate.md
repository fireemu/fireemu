---
title: Local Emulator Suiteから移行する
description: firebase emulators:execからの移行手順と、strictプロファイルでテストが失敗したときの対処方法です。
---

Fireemuは既存の`firebase.json`をそのまま読み込み、同じ既定ポートで動作し、Firebase CLI互換のコマンド名も受け付けます。そのため、多くのプロジェクトは実行コマンドを1か所差し替えるだけで移行できます。

## 始める前に

利用しているサービスが[対応サービスの一覧](../../#supported-products)に含まれているか確認してください。公式のLocal Emulator SuiteはApp Hosting、Data Connect、Extensionsにも対応していますが、Fireemuでは未対応で、Realtime Databaseも一部対応にとどまります。

## コマンドを切り替える

1. Fireemuをインストールし、`firebase.json`を参照する`fireemu.toml`を生成します。

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   プロファイルは既定の`profile = "strict"`のままにしておきます。

2. npmスクリプトやCIの実行コマンドを置き換えます。

   | 変更前 | 変更後 |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   `fireemu emulators:exec`や`fireemu emulators:start`もエイリアスとして使え、引用符で囲んだスクリプト文字列形式もそのまま渡せます。

3. テストを実行します。

## `strict`でテストが失敗するとき

公式エミュレータでは通っていたテストが`strict`で失敗する場合、アプリケーションが本番でも遭遇する制約が表に出ている可能性があります。失敗の内容を確認し、アプリやテストを修正するか、必要な個別設定だけを調整してください。プロファイル全体を`emulator`へ切り替えると、本番ではなく公式エミュレータの挙動に合わせることになるため、避けてください。

### 署名なしのエミュレータIDトークン

`@firebase/rules-unit-testing`の`authenticatedContext()`とクライアントSDKの`mockUserToken`は、`strict`でも既定で動作します。

- `auth.allowUnsignedIdTokens = false`にすると、Security Rulesでのモックトークンフォールバックが無効になり、本番と同じく署名なしトークンが拒否される挙動を検証できます。
- 拒否ケースのテストでは、SDKヘルパー既定の`iat: 0` / `exp: 3600`に対し、有効期限後の時刻へ時計を進めてください。通常の検証を通るFireemu発行トークンは引き続き受け付けられます。
- `auth.idTokenSigning = "session-rsa"`を指定すると、すべての署名なしIDトークンを拒否します。

詳しくは[署名なしのモックIDトークン](../../products/auth/#署名なしのモックidトークン)を参照してください。

### 名前付きデータベース

本番と同じく、名前付きデータベースは`firebase.json`の`firestore`配列に`rules`と`indexes`とあわせて宣言するか、Admin APIで作成してください。実行時に作成したデータベースは、ルールを読み込むまでSecurity Rulesが未設定の状態になります（[Firestoreの名前付きデータベース](../../products/firestore/#名前付きデータベース)）。

### 複合インデックス

クエリは本番と同じルールで、`firebase.json`が参照する`firestore.indexes.json`と照合されます。

- `strict`で`firestore.missingIndexes`が既定の`"refuse"`のとき、必要なインデックスが未定義のクエリは、作成リンク付きで`FAILED_PRECONDITION`になります。
- `strict`では、`indexes`内の通常の単一フィールド複合インデックス定義は、`firebase deploy`と同様にファイル読み込み時に拒否されます。代わりに`fieldOverrides`を使ってください。`(__name__ DESC)`など、本番が受け付ける形は受け付けます。
- インデックスを段階的に追加したい間は、`firestore.missingIndexes = "report"`を設定します。クエリ自体は通しつつ、不足しているインデックスごとにデータベース単位で1回、本番の拒否文言と`firestore.indexes.json`用エントリを標準エラーへ出力します。この設定は`productionExact`では上書きされません。
- 複数ブランチのインデックスが必要なORクエリでは、不足している全ブランチの定義を標準エラーの補足診断でまとめて出力します（重複排除・上限付きキャッシュあり）。`strict`で`"refuse"`のときはSDKエラーに最初の作成リンクが返り、`emulator`プロファイルではクエリが実行されます。

### 本番プロジェクトを反映する設定

本番プロジェクト側で既定と異なる設定にしている場合は、プロファイルを変えずに該当項目だけ合わせてください。

| 設定 | `strict`での動作 |
|---|---|
| `auth.improvedEmailPrivacy` | メール列挙保護です。新しい本番プロジェクトに合わせて既定でオンになっています。本番でオフにしている場合のみ`false`にしてください（サインイン時に`EMAIL_NOT_FOUND`や`INVALID_PASSWORD`が返るようになります）。 |
| `auth.mfa` | 多要素認証の設定です。テストしやすいよう`strict`ではSMS・TOTPが既定で有効になっており、`productionExact`では新規本番プロジェクトと同じくオフで始まります（[Authenticationの多要素認証](../../products/auth/#多要素認証)）。 |
| `firestore.enforceLimits` | 本番で常に適用されるStandardエディションのクエリ制限です。特別な事情がない限りオンのままにしてください。`strict`ではこのキーはクエリ制限だけを制御します。 |

## 公式CLIとの違い

- **`--export-on-exit`失敗時の終了コード**：テストコマンドが成功してもエクスポートに失敗した場合は終了コード1で終わります（公式CLIは警告を出して0で終了します）。保存データに依存するCIジョブが気づかず成功するのを防ぐためです。
- **Unixでのファイル所有者チェック**：自動探索で見つけた`fireemu.toml`や`firebase.json`は、信頼できるユーザーが所有している場合のみ読み込みます（[ファイル所有者のチェック](../../guides/configuration/#ファイル所有者のチェック)）。
- **Security Rules未設定時の挙動**：`strict`では、ルールを読み込んでいないプロジェクトはルール未デプロイの本番プロジェクトと同じくクライアントからのリクエストを拒否します（[Security Rules](../../guides/security-rules/)）。

## 関連項目

- [アプリを接続する](../connect/)
- [プロファイルとproductionExact](../../guides/profiles/)
- [互換性の表](../../compatibility/)
- [制限事項](../../compatibility/limitations/)
