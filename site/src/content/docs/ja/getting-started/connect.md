---
title: アプリを接続する
description: Firebase Admin SDK、クライアントSDK、Security RulesのユニットテストをFireemuのエミュレータに向けます。
---

FireemuはLocal Emulator Suiteと同じプロトコルとデフォルトポートで動作するため、同じ方法で接続できます。

## サーバーコードとAdmin SDKを接続する

Firebase Admin SDKとGoogle Cloudクライアントライブラリは、エミュレータの環境変数を読み取ります。`fireemu exec`は、実行するコマンドに対してこれらを設定します。

```sh
npx fireemu exec -- node ./scripts/seed.mjs
```

| 変数 | 値 |
|---|---|
| `FIRESTORE_EMULATOR_HOST` | Firestoreの`host:port` |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authenticationの`host:port` |
| `FIREBASE_STORAGE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` | Storageの`host:port`と`http://host:port` |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | プロジェクトID |
| `FIREEMU_CONTROL_URL`, `FIREEMU_CONTROL_TOKEN` | FireemuのコントロールAPI。`fireemu/testing`が使います |

ほかのエミュレータ(Realtime Database、Pub/Sub、Eventarc、Cloud Tasks、App Check、Hub)の変数は、設定条件とともに[環境変数](../../reference/environment-variables/)に一覧があります。

`exec`の下では、Admin SDKに接続用のコードは不要です。

```js
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Under `fireemu exec`, the Admin SDK finds the emulators from the environment.
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
await getFirestore().doc('notes/n1').set({ text: 'hello' });
```

### シェルにすでにある変数

選択されていないエミュレータの変数は、環境にあったままの状態で残ります。実行で起動しないエミュレータについて、シェルがすでに持っている変数はそのまま残り、警告が出ます。

- `fireemu exec --plan -- <command>`は、コマンドから見える内容を一覧表示します。
- [`--deny-inherited-emulator-env`](../../reference/cli/#inherited-emulator-variables)を指定すると、そのような実行は開始前に失敗します。

## クライアントSDKを接続する

クライアントSDKは、Local Emulator Suiteと同様にコードで接続します。Fireemuが実行時に使うプロジェクトIDを使ってください。`.firebaserc`のデフォルト、なければ`fireemu.toml`の`daemon.authProject`、それもなければ`demo-app`です。

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

デフォルトポートは[インストールと実行](../install/#default-ports)に一覧があります。接続方法が異なるプロダクトが2つあります。

- **Realtime Database。** クライアントに専用の`databaseURL`が必要です。[Realtime Database](../../products/realtime-database/#connect)を参照してください。
- **Hosting。** 通常のHTTPで、SDKの設定は不要です([Firebase Hosting](../../products/hosting/))。

## Security Rulesのユニットテストを実行する

`@firebase/rules-unit-testing`はFireemuで動作します。

- 署名なしのモックIDトークン(`authenticatedContext()`)は、`strict`プロファイルでも、デフォルトで受け付けられます。
- FirestoreとStorageのルールを読み込むためのルートと、Firestoreをクリアするためのルート(`testEnv.clearFirestore()`)に対応しています。
- `withFunctionTriggersDisabled`に対応しています。ブラウザのメタデータ(`Origin`、`Sec-Fetch-Site`)を送らないクライアントからであれば、Hubはトークンなしで`PUT /functions/disableBackgroundTriggers`と`enableBackgroundTriggers`を受け付けます。

[Security Rules](../../guides/security-rules/)を参照してください。

## プロジェクトID

Fireemuは、次のうち最初に設定されているものからプロジェクトIDを決めます。

1. コマンドラインの`--project`(`-P`)。IDまたは`.firebaserc`のエイリアスを指定します。
2. 読み込まれた`firebase.json`の隣にある`.firebaserc`のデフォルトプロジェクト。
3. `fireemu.toml`の`daemon.authProject`。
4. `demo-app`。

## 関連項目

- [環境変数](../../reference/environment-variables/)
- [Security Rules](../../guides/security-rules/)
- [CIとコンテナ](../../guides/ci-and-containers/)
