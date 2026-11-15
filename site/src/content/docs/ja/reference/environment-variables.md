---
title: 環境変数
description: FireemuがコマンドとFunctionsのコードのために設定する環境変数と、Fireemuが読み取る環境変数を調べます。
---

この一覧は、`fireemu`バイナリとnpmパッケージのソースから作成しています。ここに載っていないものは実装の詳細であり、変更されることがあります。

## `fireemu exec`が設定するもの

`exec`は、実行しているエミュレータの変数を、実行するコマンドに渡します。それ以外のものは、独自には何も渡しません。名前と形式は、`firebase emulators:exec`が書き出すものに従います。

選択されていないエミュレータの変数は、環境にあったままの状態で残るため、エミュレータが欠けていても、SDKが誤って本番に接続することはありません。`exec`はそれぞれについて警告を出し、`--deny-inherited-emulator-env`を指定すると、代わりに実行を拒否します([継承されたエミュレータ変数](../cli/#継承されたエミュレータ変数)を参照)。

| 変数 | 値 | 設定される条件 |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_FIRESTORE_EMULATOR_ADDRESS` | Firestoreの`host:port` | Firestoreが実行されている |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authenticationの`host:port` | Authenticationが実行されている |
| `FIREBASE_STORAGE_EMULATOR_HOST` | Storageの`host:port` | Storageが実行されている |
| `STORAGE_EMULATOR_HOST` | Cloud Storageクライアントライブラリ用のStorageのURL(`http://host:port`)。StorageのApp Checkが`enforced`で、`appCheck.storageServerRequests`が`"capability"`のときは、実行ごとのAdminケイパビリティも含みます([App Check](../../products/app-check/)を参照) | Storageが実行されている |
| `FIREBASE_DATABASE_EMULATOR_HOST` | Realtime Databaseの`host:port` | Realtime Databaseが実行されている |
| `PUBSUB_EMULATOR_HOST` | Pub/Subの`host:port` | Pub/Subが実行されている |
| `CLOUD_EVENTARC_EMULATOR_HOST` | EventarcのURL(`http://host:port`) | Functionsが実行されている |
| `CLOUD_TASKS_EMULATOR_HOST` | Cloud Tasksの`host:port` | Functionsが実行されている |
| `FIREEMU_FUNCTIONS_HOST` | Functionsの`host:port` | Functionsが実行されている |
| `FIREEMU_APP_CHECK_EMULATOR_HOST`, `FIREEMU_APP_CHECK_JWKS_URL` | App Checkの交換ホストとJWKSのURL | App Checkが利用できる([App Check](../../products/app-check/)を参照) |
| `FIREBASE_EMULATOR_HUB` | Emulator Hubの`host:port` | Hubが実行されている |
| `FIREBASE_LOGGING_EMULATOR_HOST` | Loggingエミュレータの`host:port` | Loggingエミュレータが実行されている |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | プロジェクトID | 常に |
| `FIREBASE_CONFIG` | プロジェクトIDから設定されます | 環境にすでにある場合を除く |
| `FIREEMU_CONTROL_URL` | コントロールAPIのベースURL。末尾は`/v1/` | 常に |
| `FIREEMU_CONTROL_TOKEN` | コントロールAPIのBearerトークン。`fireemu/testing`と、[Cloud Firestore](../../products/firestore/#不足インデックスでciジョブを失敗させる)のスクリプトが使います | 常に |

`fireemu up`は、シェルに変数を設定しません。起動時の出力に各`host:port`が表示され(たとえば`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`)、Emulator UIのOverviewページの「Environment for SDKs」にも表示されます。

## Functionsのコード向けに設定されるもの

Functionsのコードベースは、実行中のサービスについて同じエミュレータのホスト変数に加えて、`FUNCTIONS_EMULATOR=true`、プロジェクトIDの変数、`FIREBASE_CONFIG`を持って実行されます。

デーモンから継承されるのは、ごく限られた変数だけです。認証情報は意図的に渡されません。`GOOGLE_APPLICATION_CREDENTIALS`、`FIREBASE_TOKEN`、`CLOUDSDK_*`は関数のコードには届きません。`FIREEMU_RUNNER*`変数は内部用です。

## Fireemuが読み取るもの

| 変数 | 効果 |
|---|---|
| `FIREEMU_BINARY_PATH` | `fireemu`ランチャーは、プラットフォームパッケージのバイナリの代わりに、このバイナリを実行します。公開されたバイナリのないプラットフォームや、自分でビルドしたバイナリのためのものです。 |
| `FIREEMU_NODE` | Functionsのコードベースを実行するNode.js実行ファイルの絶対パス。実行ファイルへの絶対パスでない場合は拒否されます。指定がない場合、Fireemuは`PATH`のディレクトリ(とVoltaのディレクトリ。`VOLTA_HOME`を参照)から`node`を探します。 |
| `FIREEMU_RUNNER_NODE`, `FIREEMU_RUNNER_PYTHON` | 同梱のものの代わりに使う、Functionsランナースクリプト(`index.mjs`、`runner.py`)のパス。ファイルが存在しない場合はエラーです。 |
| `FIREEMU_WORKER_THREADS` | 非同期ワーカースレッドの数。1から64。デフォルト: 利用可能なコア数。ただし最大4。 |
| `FIREEMU_MAX_BLOCKING_THREADS` | ブロッキングスレッドの上限。1から512。デフォルト: 64。 |
| `FIREEMU_CONTROL_TOKEN` | `fireemu doctor --connect`は、これをコントロールAPIへのBearerトークンとして送ります。`fireemu exec`の中では、すでに設定されています。 |
| `FIREBASE_CONFIG` | `exec`は、これが設定されているのを見つけると、プロジェクトIDから値を書き込む代わりに、その値を保持します。 |
| `PATH`, `VOLTA_HOME` | `FIREEMU_NODE`が設定されていないときに、Node.jsを探す場所。 |
| `HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA` | Authenticationのセッション署名鍵のキャッシュを保存する場所(所有者のみのディレクトリ)。使えるキャッシュがない場合、鍵は起動のたびにメモリ内で生成されます。 |
| `SUDO_UID` | Fireemuがrootとして実行されている場合、ここで指定されたユーザーも、見つかった設定ファイルの信頼できる所有者になります。[ファイル所有者の検査](../../guides/configuration/#ファイル所有者のチェック)を参照してください。 |
| `ComSpec` | Windowsで、`fireemu exec "script"`のスクリプト形式を実行するシェル。デフォルト: `cmd.exe`。 |
| `FIREEMU_TRACE_WEBCHANNEL`, `FIREEMU_TRACE_STORAGE` | 任意の値を設定すると、クライアントの問題を診断するために、リクエストのトレース(`[webchannel] ...`、`[storage] ...`)が標準エラー出力に表示されます。通常の実行用ではありません。 |
