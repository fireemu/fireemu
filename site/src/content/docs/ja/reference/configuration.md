---
title: 設定スキーマ
description: fireemu.tomlのJSON Schemaと、最上位の各設定セクションのガイドを探します。
---

`fireemu.toml`は、JSON Schemaで記述されています。同じ設定は、TOML(`fireemu.toml`)でもJSON(`fireemu.json`)でも書けます。どのファイルが読み込まれるかは、[設定ファイル](../../guides/configuration/)を参照してください。

Fireemuは起動時にファイルを検証します。スキーマでは表現できないルールも含まれ、受け付けられない値があるとエラーで停止します。`npx fireemu config show`は、すべてのキーを、有効な値とその由来とともに表示します。

## スキーマを入手する

- [このサイトのfireemu.schema.json](../../../spec/config/fireemu.schema.json)。
- [GitHubのspec/config/fireemu.schema.json](https://github.com/fireemu/fireemu/blob/main/spec/config/fireemu.schema.json)。同じファイルが各リリースタグにもあります(`https://raw.githubusercontent.com/fireemu/fireemu/v<version>/spec/config/fireemu.schema.json`)。リリース済みのバイナリの`fireemu init`は、新しいファイルにこの場所を書き込みます(ソースからのビルドは`main`の場所を書き込みます)。
- `npx fireemu config schema --out fireemu.schema.json`は、実行しているバイナリに同梱されたスキーマを書き出します。受け付けるキーは、そのバイナリが検証に使うキーと同じです。

## 最上位のセクション

| セクション | 設定する内容 | ガイド |
|---|---|---|
| `schemaVersion` | 常に`1` | |
| `profile`, `productionExact` | 本番または公式エミュレータの動作 | [プロファイルとproductionExact](../../guides/profiles/) |
| `firebaseJson` | ポート、ルール、インデックス、Functionsを読み込む`firebase.json` | [設定ファイル](../../guides/configuration/) |
| `firestore` | エディション、APIモード、インデックス、上限、履歴 | [Cloud Firestore](../../products/firestore/) |
| `rules` | FirestoreのSecurity Rulesのソースと、FirestoreおよびStorageの拒否ログ | [Security Rules](../../guides/security-rules/) |
| `auth` | `requireClientApiKey`(デフォルトは`false`)は、emulatorプロファイルで、APIキーまたはAuthorizationヘッダーのないクライアントリクエストを、公式エミュレータと同じ403で拒否するようにします。strictは変わりません。そのほかに、サインイン方法、パスワードポリシー、MFA、テナント、プロバイダー、トークンを設定し、Firestore、Storage、Realtime DatabaseのSecurity Rulesの対象が署名なしのモックIDトークンを受け付けるかどうか(`allowUnsignedIdTokens`)も設定します | [Authentication](../../products/auth/) |
| `storage` | StorageのSecurity Rules、オブジェクトサイズ、バッファリングされたボディと保存バイト数の上限、バケットの宣言(`undeclaredBuckets`)、バケットCORS(`cors`)、署名付きURLの鍵(`signedUrlKeys`) | [Cloud Storage](../../products/storage/) |
| `database` | ルールファイルのないRealtime Databaseインスタンスが何を許可するか(`defaultAccess`)。`auth.allowUnsignedIdTokens`は、両方のプロファイルで、そのルールが`@firebase/rules-unit-testing`のモックトークンを受け付けるかどうかを決めます | [Realtime Database](../../products/realtime-database/) |
| `hosting` | strictプロファイルの2つの開発用デフォルト。`cacheControl`(デフォルトは`"none"`。`productionExact`で`"production"`になり、ファイルに`Cache-Control: max-age=3600`を追加します)と`clientCountry`(デフォルトは`"honoured"`。`productionExact`で`"ignored"`になります) | [Firebase Hosting](../../products/hosting/#プロファイル) |
| `remoteConfig` | `updateUser`（`email`は必須、`name`と`imageUrl`は任意）。ローカルのRemote Configテンプレート管理が`updateUser`として報告するIDです。デフォルトでは無効です | [Remote Config templates](https://github.com/fireemu/fireemu/blob/main/docs/remote-config.md) |
| `functions` | コードベース、ランナー、アプリケーションクロック、提供しないトリガー、提供する関数の固定リスト(`manifest`)、`isolation`(デフォルトは`"codebase"`。`productionExact`で`"function"`になり、関数ごとに1つのランナープロセスが、最初のトリガーで起動されます)、`taskNameReuse`、`taskDispatchDeadlineSeconds`、`taskRetryDefaults`、`taskRetryBackoff`(Cloud Tasksキューの開発用デフォルトで、`productionExact`が本番の値にします。[プロファイル](../../guides/profiles/)を参照)、`authBlockingToken`(デフォルトは`"emulated"`。`strict`の`productionExact`で`"production"`になり、署名付きトークンを配信して、PythonランナーがSDKのルールに従って検証します。Nodeの関数は、本番と同じ形式のトークンを受け取りますが検証しないため、従来どおりに動作します) | [Cloud Functions](../../products/functions/) |
| `scheduler` | スケジュール関数のタイムゾーン、キャッチアップ、重複実行 | [時刻とスケジュール関数](../../guides/time/) |
| `pubsub`, `eventarc` | 認証と配信の設定。`pubsub.restNegativeCache`(デフォルトは`"off"`。`"production"`はstrictでの明示的なオプトインで、本番が接続で示した、実際の`404`の後に約10秒間キャッシュされる`404`を再現します。`productionExact`はこれを選択しません) | [Pub/SubとEventarc](../../products/pubsub-eventarc/) |
| `appCheck` | アプリ、デバッグトークン、強制 | [App Check](../../products/app-check/) |
| `daemon` | ポート、プロジェクト、開始時刻、クロックの進め方(`clock`) | [時刻とスケジュール関数](../../guides/time/) |
| `network` | ループバック以外でのリッスン(`allowNonLoopbackHosts`)と、エミュレータが応答する追加の`Host`名(`allowedHosts`。DNSリバインディング対策) | [CIとコンテナ](../../guides/ci-and-containers/#エミュレーターが応答するホスト名) |
| `bind` | 受け付けられますが、現時点では効果がありません。デーモンはループバックアドレスにバインドし、`firebase.json`の`emulators.<name>.host`でサービスごとにホストを設定します | [CIとコンテナ](../../guides/ci-and-containers/) |
| `projects` | `demo-`で始まるプロジェクトIDだけを受け付けるかどうか(`requireDemoPrefix`)と、別のプロジェクトを指定するリクエストを処理するか拒否するか(`unknownProjects`) | [プロファイルとproductionExact](../../guides/profiles/) |
| `limits` | 上限カタログ、警告、クォータ集計、プランの上書きのために予約されています。現時点で動作を変えるメンバーはありません。それぞれ、効果なしで受け付けられるか、空またはデフォルトの値だけを受け付け、それ以外は拒否します。Firestoreの上限は`firestore.enforceLimits`で切り替えます | |
| `events` | 関数トリガーイベントの配信。`retry`付きで宣言された関数の`maxAttempts`(デフォルトは4)。`delivery`は`exactly-once-test`のみ受け付けます | [プロファイルとproductionExact](../../guides/profiles/) |
| `trace` | 受け付けられますが、現時点では効果がありません | |

効果なしで受け付けられるキーは、実行がそれを読み込んだときに`note:`行を表示します。そのような設定があるCIジョブを失敗させるには、`fireemu config lint --deny-ineffective`を実行します。該当するものを一覧表示し、それぞれが`--allow`のエントリでカバーされていない限り、終了コード1で終了します([`config lint`](../cli/#config-lint)を参照)。

## Storageのサイズ上限

| キー | 設定内容 | デフォルト | 最大値 |
|---|---|---|---|
| `storage.maxObjectBytes` | 1つのオブジェクトの最大サイズ。リクエストボディの上限は、この値に4194304バイトを足した値です | 268435456バイト | 2143289343 |
| `storage.bufferedBodyBudgetBytes` | バッファリングされるStorageのリクエストボディに対する、プロセス全体の予算 | 1073741824バイト | 2147483647 |

どちらの値も、正の整数でなければなりません。保存バイト数とレジューマブルアップロードの上限は別にあります。[Cloud Storage](../../products/storage/)を参照してください。
