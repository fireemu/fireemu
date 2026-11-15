---
title: Security Rules
description: Firestore、Storage、Realtime Database の Security Rules を読み込み、リクエストが拒否された理由を調べます。
---

Firestore、Storage、Realtime Database の Security Rules を読み込み、リクエストを拒否した条件を確認し、モックトークンでテストします。

## ルールを読み込む

Firebase CLI と同様に、`firebase.json` でルールファイルを指定します。

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" }
}
```

または `fireemu.toml`(Firestore は `rules.source`、Storage は `storage.rules`)で指定します。起動時の出力には、ルールが読み込まれているかどうかを示す `firestore rules:` 行と `storage rules:` 行があります。

Realtime Database のルールは、`firebase.json` の `database` セクションから読み込まれます。デフォルトインスタンスには 1 つのファイル、またはインスタンスごとやデプロイターゲットごとに 1 つのファイルを指定します。起動時の出力の `database rules:` 行に、各ファイルとそのインスタンスが示されます。各プロファイルが受け付ける認証情報、ルールのないインスタンスが許可する内容、公式エミュレーターとの違いについては、[Realtime Database](../../products/realtime-database/#security-rules)を参照してください。

`@firebase/rules-unit-testing` は、実行時にルールを読み込むこともできます。`initializeTestEnvironment` は渡した `firestore.rules` と `storage.rules` をエミュレーターに送り、`testEnv.clearFirestore()` にも対応します。

読み込み時に確認されること:

- 公式エミュレーターとの比較は、記録したケースに限られます。
- 一覧にある非対応の構文と評価のケースは、ルールの読み込み時に拒否されるか、ルールエラーになります。
- 公式エミュレーターの determinization リソース制限によって拒否される、記録済みの 8 つのパターンは、評価されない式の分岐も含め、Fireemu がルールを読み込むときにも拒否されます。これは、正規表現の完全な等価性や本番との等価性を保証するものではありません。

## ルールのないプロジェクト

`strict` では、Security Rules のないプロジェクトは、ルールリリースのない本番プロジェクトと同じ動作をします。

- Firestore へのクライアントリクエストはすべて `PERMISSION_DENIED` で拒否されます。
- Storage へのエンドユーザーのリクエストはすべて、本番の 400「bucket has not been set up」の応答で拒否されます。

Admin SDK とその他のオーナー認証情報は影響を受けません。

これらの応答は本番の文言のままです。そのため、データベースとバケットごとに最初に拒否されたリクエストでは、ルールが読み込まれていないことと読み込み方を示す警告も標準エラーに出力されます。

`emulator` プロファイルは、公式エミュレーターと同様に、すべての Firestore リクエストと、`demo-*` プロジェクトのすべての Storage リクエストを許可します。

## リクエストが拒否された理由

本番は拒否を短いメッセージ(Firestore の `PERMISSION_DENIED`「Missing or insufficient permissions.」、Storage の 403)で応答し、どのルールが拒否したかは示しません。Fireemu は、エンドユーザーのリクエストの拒否ごとに、リクエストが評価したすべての `allow` 条件とその評価結果も標準エラーに出力します。

```text
note: firestore: Security Rules denied get on "notes/n1" in "database (default)" (request.auth.uid "bob"): no allow statement evaluated to true; line 5:22 `request.auth.uid == resource.data.owner` was false
```

- これらの行を出力しないようにするには(たとえば多数の拒否をアサートするスイートで)、`fireemu.toml` で `rules.denialLog` を `"off"` にします。クライアントへの応答はどちらでも同じです。
- Rules ページと `GET /v1/sessions/default/rules/requests` には、トレースされた直近 100 件の Firestore の判定が表示されます。トレースは UI または最初の control API の読み取りで開始され、新しいルールセットを読み込むと履歴は消去されます。これはデバッグ用のビューであり、完全なリクエストログではありません。

### 診断の上限

これらの上限は診断にのみ影響し、許可/拒否の判定には影響しません。

- Firestore と Storage の Rules の診断は、式ごとに最大 64 個の異なる値を保持します。
- 文字列の値とエラーメッセージは、1,024 UTF-8 バイト以内の文字境界で切り詰められます。
- Firestore のカバレッジ JSON/HTML と control リクエストのトレースでは、切り詰められた値に `truncated: true` が付きます。省略された観測には `valuesOmitted` と `valuesCountMayBeLower: true` が追加されます。そのため、表示される件数は、値の実際の件数より少なくなることがあります。

## モックトークンを使ったユニットテスト

`@firebase/rules-unit-testing` の `authenticatedContext()` と、クライアント SDK の `mockUserToken` オプションは、署名のないモック ID トークンを送ります。Fireemu は、`strict` でもデフォルトでこれを受け付け、公式エミュレーターと同様に、そのクレームから `request.auth` を構築します。`strict` で受け付けられるのはまさにその形のトークンだけで、それ以外のトークンはすべて、有効期限も含めて検証されます。

署名のないトークンを本番が拒否する動作をテストするには、`auth.allowUnsignedIdTokens` を `false` に設定するか、[`productionExact`](../profiles/) を設定します。

## Rules 言語の詳細

Fireemu が Rules を評価するときのエッジケースです。

### ドキュメントでないパスに対する `get()` と `exists()`

`get()` と `exists()` は、リクエストが実行されているデータベースのドキュメントへのパスを受け取ります。次のパスはドキュメントを指さないため、呼び出しは評価エラーになります。

- コレクションへのパス(`/databases/$(database)/documents/users`。`documents` の後のセグメント数が奇数)。
- 別のデータベースへのパス(`/databases/other/documents/users/u1`)。
- `documents` のないパス(`/databases/$(database)/users/u1`)。

他の Rules のエラーと同様に、条件は失敗します。`||` または `&&` のもう一方が結果を決める場合を除き、リクエストは拒否されます(`exists(<such a path>) || true` は許可します。このような組み合わせに対する本番の応答は記録していません)。`!exists(...)` と `get(...) == null` は、パスを「存在しない」と読み取らず、許可もしません。本番はこれらを拒否し、公式エミュレーターも同様です。

存在しないドキュメントへのパスは、存在しないドキュメントのままです。`exists()` は `false`、`get()` は `null` です。

入力ミスのパスによるドキュメント ID の欠落がよくある原因なので、拒否ログの `was an error` の行が、その呼び出しを示します。

### クエリと保存されたドキュメント

Firestore のクエリは、本番と同様に、返されるドキュメントからではなく、フィルターから認可されます。

例外が 1 つあります。単一の `documentId() ==` フィルターを持つクエリの分岐は、他のフィルター、limit、offset、カーソルが何であっても、本番と公式エミュレーターの判定と同様に、保存されたそのドキュメントによって判定されます。その証明では、`resource.data` はクエリがフィルターまたは並べ替えに使うフィールドだけを保持するため、`keys()`、`size()`、`in`、`get(key, default)` はそれらのフィールドだけから応答します。

1 つのドキュメントを指定する分岐と、どのドキュメントも指定しない分岐が混在する `OR` クエリは、プロファイルによって異なります。

- `emulator` プロファイルは、公式エミュレーターと同様に、分岐ごとに認可します。
- `strict` プロファイルは、すべての分岐をそのフィルターから証明します。本番はそのクエリにインデックス欠落エラーで応答し、その Rules の応答は記録されていないためです。

### ルール内の文字列

Firestore と Storage の Rules は、本番と同様に、文字列を UTF-16 コードユニットでインデックス化し、長さを測ります。`"é🔥x".size()` は 4 で、`"é🔥x"[3] == "x"` です。`lower()` と `upper()` が変更するのは ASCII 文字だけで、文字列が正規化されることはありません。正規表現は、引き続き補助文字を 1 文字として扱います。

サロゲートペアの片方の扱いは、プロファイルによって異なります。

- `strict` では、それは自分自身にだけ等しい断片であり、単独のサロゲートを含む `split()`、`replace()`、`matches()` のパターンは、本番の応答と同様にルールを失敗させます。
- `emulator` プロファイルは、公式エミュレーターと同様に、単独のユニットを保持します。

## 関連

- [Cloud Firestore](../../products/firestore/)
- [Cloud Storage](../../products/storage/)
- [Realtime Database](../../products/realtime-database/#security-rules)
- [プロファイルと productionExact](../profiles/)
