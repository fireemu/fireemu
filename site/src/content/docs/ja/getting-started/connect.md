---
title: アプリを接続する
description: Firebase Admin SDK、クライアントSDK、Security RulesユニットテストをFireemuに接続する方法です。
---

FireemuはFirebase Local Emulator Suiteと同じプロトコルと既定ポートで待ち受けるため、対応しているサービスでは同じSDKのエミュレータ接続方法で接続できます。ポートとプロジェクトIDは、Fireemuの実行に合わせてください。

## サーバーコードとAdmin SDKを接続する

Firebase Admin SDKとGoogle Cloudクライアントライブラリは環境変数からエミュレータを認識します。`fireemu exec`経由でコマンドを実行すると、これらの変数が自動で設定されます。

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| 変数 | 値 |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firestoreの`host:port` |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authenticationの`host:port` |
| `FIREBASE_STORAGE_EMULATOR_HOST`、`STORAGE_EMULATOR_HOST` | Storageの`host:port`および`http://host:port` |
| `GCLOUD_PROJECT`、`GOOGLE_CLOUD_PROJECT` | プロジェクトID |
| `FIREEMU_CONTROL_URL`、`FIREEMU_CONTROL_TOKEN` | FireemuコントロールAPI（`fireemu/testing`が使用） |

Realtime Database、Pub/Sub、Eventarc、Cloud Tasks、App Check、Hubの環境変数は[環境変数](../../reference/environment-variables/)を参照してください。

`exec`経由で実行する場合、Admin SDK側に特別な接続コードは不要です。

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// `fireemu exec`経由では、Admin SDKが環境変数からエミュレータを自動認識します。
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### シェルにすでにある変数

今回の実行で起動しないエミュレータの環境変数は書き換えられません。シェルに既存のホスト変数が残っている場合はそのまま引き継がれ、警告が出ます。

- `fireemu exec --plan -- <command>`で、Fireemuが設定するエミュレータ変数と、シェルから引き継ぐエミュレータ変数の扱いを事前に確認できます。
- [`--deny-inherited-emulator-env`](../../reference/cli/#継承されたエミュレータ変数)を付けると、意図しない残存変数がある場合に起動前にエラーで止めます。

## クライアントSDKを接続する

クライアントSDKの接続方法はLocal Emulator Suiteと同じです。プロジェクトIDはFireemuが解決したものに揃えてください。優先順位は`--project`を含めて[プロジェクトID](#プロジェクトid)に記載しています。

```js
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const app = initializeApp({
  projectId: 'demo-app',
  apiKey: 'fake-api-key',
  storageBucket: 'demo-app.appspot.com',
});

connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099');
connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8080);
connectStorageEmulator(getStorage(app), '127.0.0.1', 9199);
connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
```

ポート一覧は[デフォルトポート](../install/#デフォルトポート)を参照してください。次の2サービスのみ接続方法が異なります。

- **Realtime Database**：クライアント設定に`databaseURL`が必要です（[Realtime Database](../../products/realtime-database/#接続)）。
- **Hosting**：通常のHTTPでアクセスでき、SDK設定は不要です（[Firebase Hosting](../../products/hosting/)）。

## Security Rulesのユニットテストを実行する

`@firebase/rules-unit-testing`もそのまま動作します。

- `authenticatedContext()`が生成する署名なしモックIDトークンは、`strict`プロファイルでも既定で受け付けられます。
- Firestore・Storageルールの動的読み込みと`testEnv.clearFirestore()`に対応しています。
- `withFunctionTriggersDisabled`も動作します。ブラウザ由来のヘッダー（`Origin`、`Sec-Fetch-Site`）を持たないクライアントからの`PUT /functions/disableBackgroundTriggers` / `enableBackgroundTriggers`を、コントロールトークンなしで受け付けます。

拒否ログやモックトークンの制御については[Security Rules](../../guides/security-rules/)を参照してください。

## プロジェクトID

プロジェクトIDは次の優先順で決まります。

1. コマンドラインの`--project`（`-P`）で指定したIDまたは`.firebaserc`エイリアス。
2. 読み込まれた`firebase.json`と同じディレクトリにある`.firebaserc`のデフォルトプロジェクト。
3. `fireemu.toml`の`daemon.authProject`。
4. `demo-app`。

## 関連項目

- [環境変数](../../reference/environment-variables/)
- [Security Rules](../../guides/security-rules/)
- [CIとコンテナ](../../guides/ci-and-containers/)
