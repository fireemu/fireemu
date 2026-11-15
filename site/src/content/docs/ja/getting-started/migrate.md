---
title: Local Emulator Suiteから移行する
description: プロジェクトをfirebase emulators:execからFireemuに移し、strictプロファイルで失敗するテストに対処します。
---

Fireemuは既存の`firebase.json`を読み込み、同じデフォルトポートで動作し、公式のコマンド名も受け付けます。そのため、ほとんどのプロジェクトはコマンドを1つ変えるだけで移行できます。

## 始める前に

使っているプロダクトが[対応プロダクトの一覧](../../#supported-products)に含まれているか確認してください。Local Emulator SuiteはApp Hosting、Data Connect、Extensionsにも対応していますが、Fireemuは対応しておらず、Realtime Databaseは部分的な対応です。

## コマンドを切り替える

1. Fireemuをインストールし、`firebase.json`を参照する`fireemu.toml`を作成します。

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   デフォルトの`profile = "strict"`のままにします。

2. コマンドを置き換えます。

   | 変更前 | 変更後 |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   `fireemu emulators:exec`と`fireemu emulators:start`も使えます。また、`exec`は公式の引用符付きスクリプト形式も受け付けます。

3. テストを実行します。

## `strict`でテストが失敗するとき

公式エミュレータでは通っていたテストが`strict`で失敗する場合、多くは、アプリケーションが本番でも遭遇する動作が表に出ています。テストまたはアプリケーションを修正するか、下記の個別の設定だけを緩めてください。プロファイル全体を`emulator`に切り替えることは避けてください。

### 署名なしのエミュレータIDトークン

`@firebase/rules-unit-testing`の`authenticatedContext()`とクライアントSDKの`mockUserToken`は、`strict`でもデフォルトで動作します。

- `auth.allowUnsignedIdTokens`を`false`にすると、Security Rulesの対象でのそれらのフォールバックが無効になり、本番がそれらを拒否する動作をテストできます。
- 拒否のテストでは、SDKヘルパーのデフォルトである`iat: 0` / `exp: 3600`を使い、有効期限後の時刻にクロックを設定します。通常の検証を通るFireemu発行のトークンは、引き続き受け付けられます。
- `auth.idTokenSigning = "session-rsa"`を使うと、署名なしのIDトークンはすべて拒否されます。

[署名なしのモックIDトークン](../../products/auth/#unsigned-mock-id-tokens)を参照してください。

### 名前付きデータベース

本番で作成が必要なのと同じように、名前付きデータベースはそれぞれ`firebase.json`の`firestore`配列で`rules`ファイルと`indexes`ファイルとともに宣言するか、Admin APIで作成してください。実行時に作成されたデータベースには、ルールを読み込むまでSecurity Rulesがありません([Firestore](../../products/firestore/#named-databases)を参照)。

### 複合インデックス

クエリは、本番と同様に、宣言されたインデックスに対して検査されます。クエリに必要なインデックスは、`firebase.json`から参照される`firestore.indexes.json`で宣言してください。

- インデックスが存在しないクエリは、本番と同様に、インデックスへのリンクを添えた`FAILED_PRECONDITION`で拒否されます。
- 単一フィールドの複合インデックスは、`firebase deploy`が拒否するのと同様に、ファイルの読み込み時に拒否されます。`fieldOverrides`を使ってください。
- インデックスを追加している間もそのようなクエリを実行し続けるには、`firestore.missingIndexes`を`"report"`に設定します。クエリは実行され、不足している各インデックスが、データベースごとに1回、標準エラー出力に報告されます。報告には本番の拒否メッセージと`firestore.indexes.json`のエントリが含まれます。`productionExact`はこのキーを変更しません。
- ORクエリでは、標準エラー出力の補足的な診断が、不足している分岐のインデックスをすべて重複なく列挙するため、それらの定義をまとめて追加できます。`strict`は引き続き、最初のインデックス作成リンクを含む既存のSDKエラーを返し、`emulator`プロファイルは引き続きそのクエリを実行します。繰り返される提案は重複排除され、診断キャッシュには上限があります。

### 本番プロジェクトを反映する設定

プロファイルを切り替えるのではなく、本番プロジェクトに合わせてこれらを設定してください。

| 設定 | `strict`での動作 |
|---|---|
| `auth.improvedEmailPrivacy` | メール列挙保護で、新しい本番プロジェクトではオンです。本番プロジェクトでオフにしている場合にのみ`false`にしてください。その場合、サインインは公式のAuthエミュレータと同様に`EMAIL_NOT_FOUND`と`INVALID_PASSWORD`を返します。 |
| `auth.mfa` | プロジェクトの多要素認証の設定です。`strict`ではSMSとTOTPが有効な状態で始まり、`productionExact`では新しい本番プロジェクトと同様に多要素認証がオフの状態で始まります。[Authentication](../../products/auth/#multi-factor-authentication)を参照してください。 |
| `firestore.enforceLimits` | 本番では常にStandardエディションのクエリ制限が適用されます。`false`にすると本番が拒否するクエリが通るため、特別な理由がない限りオンのままにしてください。`strict`では、クエリ制限だけを切り替えます。 |

## 公式CLIとの違い

- `--export-on-exit`が失敗した場合、コマンド自体が成功していても、実行は終了コード1で終了します。公式CLIは警告を出して終了コード0で終了するだけです。Fireemuは、保存されたデータに依存するCIジョブがそのデータなしに成功することがないよう、この点で異なります。
- Unixでは、見つかった`fireemu.toml`または`firebase.json`は、所有者が信頼できる場合にのみ読み込まれます。[設定ファイル](../../guides/configuration/#file-ownership-checks)を参照してください。
- `strict`では、Security Rulesのないプロジェクトは、ルールをリリースしていない本番プロジェクトと同様に動作し、クライアントのリクエストは拒否されます。[Security Rules](../../guides/security-rules/)を参照してください。

## 関連項目

- [アプリを接続する](../connect/)
- [プロファイルとproductionExact](../../guides/profiles/)
- [互換性の表](../../compatibility/)
- [制限事項](../../compatibility/limitations/)
