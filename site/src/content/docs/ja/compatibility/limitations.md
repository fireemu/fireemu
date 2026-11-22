---
title: 制限事項
description: ローカルの結果に頼る前に、Fireemuが対応していないことと、どのローカルエミュレータにも再現できないことを確認します。
---

Fireemuは、本番のFirebaseのすべての機能と動作をまだ再現していません。ここに挙げるのは主な制限事項で、網羅的な一覧ではありません。個々のAPIは[機能マニフェスト](../#機能マニフェスト)で確認するか、次を実行してください。

```sh
npx fireemu capabilities
```

## 非対応のプロダクト

App HostingとData Connectには現在対応していません。Firebase Extensionsへの対応は予定していません。

## 部分的に対応しているプロダクト

- **Realtime Database。** 記録されたケースに限って提供し、本番と照合して検証しています([本番との照合](../#本番との照合)を参照)。それ以外の本番との互換性は未検証で、公式エミュレータとの同等性も主張しません。詳細は[Realtime Database](../../products/realtime-database/#公式エミュレータとの違い)と、以下のリストを参照してください。

## 非対応の機能

### Cloud Firestore

- Enterprise Pipeline APIが対応する読み取り操作は、限られたサブセットです([Enterpriseパイプライン](../../products/firestore/#enterpriseパイプライン)を参照)。
- Enterpriseのテキスト検索は、有限なローカルの語彙検索と、明示的なビルド制御を提供します。解析とランキングは近似です。`productionExact`は、観測されていない検索のセマンティクスを拒否します。

### Authentication

- 外部のIDプロバイダーと通信するサインインフロー、ホスト型の認可コード交換、およびライブの鍵の検出とローテーションには対応していません。
- ローカルで設定された署名付きOIDC/SAMLの検証には、strictの署名付きアサーションの経路で対応しています。`auth.idpSigners`の公開鍵、またはSAMLプロバイダーに設定された証明書を使います。
- 有限のSAML検査は、ステータス、宛先、発行者、オーディエンス、有効期間の各フィールドが存在する場合と、デーモンが発行した既知のリクエストへの応答を対象とします。フィールドが存在しない場合、解析できない時刻、およびその他の記録されていない組み合わせは、観測されないままです。

### Cloud Storage

- 署名付きURLまたはPOSTポリシーの署名の検証(有効期限と条件は検査されます)。
- `allUsers`の読み取り以外のオブジェクトACL、IAM、およびバケットレベルの公開アクセス。
- オブジェクトの合成(`compose`)と通知の設定。
- **`strict`で記録されたStorage CORS。** `conformance/storage-strictness-obs/recordings/run-2.json`には、バケットのCORSがない場合、空の場合、設定されている場合のそれぞれについて、JSON APIのメタデータ、メディア、バケット、一覧、UBLAのACLエラーの応答、アップロードのプリフライト、レジューマブルアップロードの開始、キャンセル、キャンセル済みセッションの読み取りが記録されています。strictは`productionExact`を必要とせず、記録されたCORSの値を使います。emulatorプロファイルは従来の動作を維持します。要求ヘッダーの大文字小文字の混在の保持、UBLAのPATCHと切り替えの動作、公開リストを他の応答に適用することは、記録されていない前提です。作成時には、記録されたリージョンと、無効化されたソフト削除のヒントを受け付けますが、それらのサービスはモデル化しません。ローカルのテストは、UBLAのエクスポート/インポートと、空の作成済みバケットを対象としています。[バケットCORS](../../products/storage/#バケットのcors)を参照してください。

### Realtime Database

- 記録されたケースに限って本番と照合して検証しています([本番との照合](../#本番との照合)を参照)。それ以外の本番との互換性は未検証で、公式エミュレータとの同等性も主張しません。比較は、記録された公式エミュレータのケースに限られます。
- 記載されている非対応の構文と評価のケース(正規表現の構文要素、大文字小文字の変換、およびそこに挙げた他の違い)は、ルールの読み込み時に拒否されるか、ルールエラーになります。`query.endBefore`、`query.isOrderByChild()`、`OrderByKey`、`OrderByValue`、`OrderByPriority`という名前、`http.encodeURL()`、呼び出しのないメソッドの読み取り、および三項演算子の呼び出し先は、本番が動作すると記録された通りに読み込まれ、評価されます。
- 公式エミュレータの決定化のリソース制限によって拒否される、記録済みの8つのパターンは、Fireemuがルールを読み込むときにも、評価されない式の分岐の中を含めて拒否されます。これによって、正規表現の完全な同等性や、本番との同等性が確立されるわけではありません。
- Functionsのトリガー配信は、限られた記録済みのハンドラーと書き込みについて観測されています。それ以外のケースは未検証です。
- 本番が観測されていない部分について公式エミュレータから取り入れた動作は、変更される可能性があります。

[Realtime Database](../../products/realtime-database/#公式エミュレータとの違い)を参照してください。

### Cloud Functions

- Fireemuがイベントを配信しないプロダクトのトリガー。たとえばData Connect(延期)です。Fireemuのローカルのテンプレート管理でRemote Configのクライアントテンプレートを公開またはロールバックすると、2026-11-21に本番で記録した形のイベントがv1とv2のハンドラーに届きます。サーバーテンプレートの公開ではイベントを配信しません。本番での挙動が記録されていないためです。重複配信と順序の保証も記録されていません。
- Dartのコードベース、およびFirestoreイベント以外のprotobuf CloudEventsの受信。FirestoreイベントはPython SDKにprotobufとして、`strict`ではNodeの第2世代関数にprotobufとして届きます。
- Storageのアーカイブイベントの正確な形式は、記録されていないままです。
- Pythonのコードベースは、HTTP、callable、Firestore、Pub/Sub、Storage、Eventarc、Realtime Database、スケジュール、タスクキュー、Authブロッキングの各関数を提供します。実時間のみを見ます(仮想クロックはありません)。アプリケーションのソースの変更は再読み込みしますが、`venv`とPythonのバイトコードキャッシュの編集は無視します。macOSとLinuxでのみ動作します。インストール済みの依存関係を変更した後は、Fireemuを再起動してください。それらのcallableのApp Checkトークンは、PythonのSDKがApp Checkエミュレータの鍵に対して検証します(限定使用の消費はなく、明示的なApp Checkの設定がある場合は起動を拒否します)。[Cloud Functions(Python)](../../products/functions-python/)を参照してください。

### Cloud Pub/Sub

- スキーマ、BigQueryとCloud Storageのサブスクリプション配信、exactly-once配信、メッセージ変換。
- `UpdateTopic`が対応する更新マスクは`labels`のみで、emulatorプロファイルでは`message_storage_policy`と`kms_key_name`も対応します。`DetachSubscription`は実装されていません。
- `messageStoragePolicy`は送信されたとおりに保存され、Google Cloudのリージョンとの照合は行われません。`strict`プロファイルはこれを拒否します。
- トピックの鍵名とタグは、emulatorプロファイルでは送信されたとおりに保存され、検証されません。strictプロファイルはこれらを拒否します。

### App Check

- Play Integrity、App Attest、DeviceCheck、reCAPTCHAによるアテステーション、および限定使用トークンによるリプレイ保護。デバッグトークンを使ったローカルテストには対応しています。

## ローカル制御の制限

- セッションは、クロック、ルール、Functions、受付バリアを共有します。
- スナップショットはデーモンの存続期間中メモリに保持されます。未完了のFunctionsの処理は取得されません。
- `awaitIdle`は、Text Indexの処理を待たず、セッションをまたぐ因果的なフェンスも提供しません。

## どのローカルエミュレータでも解消できない違い

ローカルでの操作が成功しても、本番で同じ結果になる保証はありません。Fireemuは、実際のクォータ集計、課金、IAM、組織ポリシー、リージョンやネットワークによる差異、サービスのロールアウトを再現しません。ローカルでの性能は、本番のレイテンシやスループットを予測するものではありません。

Security RulesとAPIの動作は、ドキュメントと、Firebaseの実際の動作の観測から実装しています。Firebaseの変更や、テストされていない条件によって、まだ記録されていない違いが生じる可能性があります。

## ローカルでの上限

メモリ使用量を抑えるために、Fireemuにだけ存在する上限があります。[Firestoreの履歴の上限](../../products/firestore/#トランザクションと履歴)と、任意の[Storageの保存バイト数の上限](../../products/storage/#保存バイト数を制限する)です。

## バージョン間の変更

設定と動作は、リリースの間で変更されることがあります。[CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md)を参照してください。

## 関連項目

- [互換性の表](../)
- [プロファイルとproductionExact](../../guides/profiles/)
- [パフォーマンス](../performance/)
