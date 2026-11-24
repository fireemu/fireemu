---
title: 制限事項
description: ローカルのテスト結果に依存する前に確認しておきたい、Fireemuの未対応範囲とローカルエミュレータ全般の制約です。
---

Fireemuは本番Firebaseの全機能・全挙動を再現しているわけではありません。ここでは主な境界と制約をまとめています。個別のAPIについては[機能マニフェスト](../#機能マニフェスト)を確認するか、次を実行してください。

```sh
npx fireemu capabilities
```

## 非対応のプロダクト

App HostingとData Connectは現在未対応です。Firebase Extensionsは対応予定がありません。

## 部分的に対応しているプロダクト

- **Realtime Database**：記録されたケースに限って提供し、本番と照合しています（[本番との照合](../#本番との照合)）。それ以外の本番挙動は未検証で、公式エミュレータとの互換性も主張していません。詳細は[Realtime Database](../../products/realtime-database/#公式エミュレータとの違い)と以下の項目を参照してください。

## 非対応の機能

### Cloud Firestore

- Enterprise Pipeline APIは読み取り操作の限られたサブセットのみ対応しています（[Enterpriseパイプライン](../../products/firestore/#enterpriseパイプライン)）。
- Enterpriseのテキスト検索は、明示的なビルド制御を持つローカルの語彙検索エンジンです。トークン化とスコア順位は近似であり、`productionExact`では未観測の検索セマンティクスを拒否します。

### Authentication

- 外部IDプロバイダーと実際に通信するサインインフロー、ホスト型の認可コード交換、ライブの鍵検出・ローテーションには対応していません。
- ローカルで設定した署名付きOIDC/SAMLアサーションの検証には、`strict`の署名付きアサーション経路（`auth.idpSigners`の公開鍵またはSAMLプロバイダー設定の証明書）で対応しています。
- SAMLの検証は、ステータス・宛先・発行者・オーディエンス・有効期間が存在する場合と、デーモン発行リクエストへの応答を対象とします。フィールド欠落、解析不能な時刻、その他未記録の組み合わせは未観測です。

### Cloud Storage

- 署名付きURLやPOSTポリシーの署名検証（有効期限と条件は検証されます。V4署名付きURLの鍵は`storage.signedUrlKeys`で別途登録可能）。
- `allUsers`の読み取り以外のオブジェクトACL、IAM、バケット単位の公開アクセス。
- オブジェクト合成（`compose`）およびバケット通知の設定。
- **`strict`でのStorage CORS**：`strict`では`productionExact`なしで、`conformance/storage-strictness-obs/recordings/run-2.json`に記録されたCORS挙動（CORS未設定・空設定・設定済みバケットに対するJSON APIのメタデータ/メディア/バケット/一覧/UBLAエラー、プリフライト、レジューマブルアップロード、キャンセル）を適用します（`emulator`プロファイルは従来どおり）。大文字小文字混在の要求ヘッダー保持、UBLAのPATCH/切り替え、他レスポンスへのexposeヘッダー適用は未記録です。バケット作成時は記録済みのリージョンと無効化ソフト削除ヒントを受け付けますが、それらサービス自体はモデル化しません。ローカルテストではUBLAのエクスポート/インポートと空バケット作成をカバーしています（[バケットCORS](../../products/storage/#バケットのcors)）。

### Realtime Database

- 記録されたケースに限って本番と照合済みです（[本番との照合](../#本番との照合)）。それ以外の本番互換性は未検証で、公式エミュレータとの互換性も主張していません（公式エミュレータとの比較も記録済みケースのみ）。
- 未対応のルール構文・評価エッジケース（一部の正規表現構文や大文字小文字変換など）は読み込み時に拒否されるかルールエラーになります。`query.endBefore`、`query.isOrderByChild()`、`OrderByKey`/`OrderByValue`/`OrderByPriority`、`http.encodeURL()`、呼び出しなしのメソッド参照、三項演算子の呼び出し先は記録された本番挙動に一致します。
- 公式エミュレータの決定化リソース上限で拒否される8つの正規表現パターンは、評価されない分岐内を含め読み込み時に拒否します。これは正規表現や本番挙動の完全一致を保証するものではありません。
- Functionsトリガー配信は、限られた記録済みハンドラーと書き込みでのみ検証しています。
- 本番挙動が未観測の箇所で公式エミュレータに合わせている動作は、今後の観測結果に応じて変わる可能性があります。

詳細は[Realtime Database](../../products/realtime-database/#公式エミュレータとの違い)を参照してください。

### Cloud Functions

- Fireemuがイベントを配信しないプロダクト（延期中のData Connectなど）のトリガー。ローカルのテンプレート管理でRemote Configのクライアントテンプレートを公開・ロールバックすると、2026-11-21に本番で記録した形のイベントをv1/v2ハンドラーへ配信します。サーバーテンプレートの公開では本番挙動が未記録のためイベントを配信せず、重複配信や順序保証も未記録です。
- Dartコードベース、およびFirestoreイベント以外の汎用protobuf CloudEvents受信（FirestoreイベントはPython SDKへprotobufで、Node第2世代関数へは`strict`下でprotobufで届きます）。
- Storageアーカイブイベントの正確なペイロード形式は未記録です。
- PythonコードベースはmacOS/Linux限定で、HTTP・callable・Firestore・Pub/Sub・Storage・Eventarc・Realtime Database・スケジュール・タスクキュー・Authブロッキング関数に対応します。実時間で動作し（仮想時計は非対応）、`venv`とバイトコードキャッシュを除きアプリソースの変更を自動再読み込みします。依存パッケージを変更した場合はFireemuを再起動してください。callableのApp CheckトークンはPython SDKがApp Checkエミュレータの鍵で検証します（限定使用トークンの消費は非対応、明示的なApp Check設定がある場合は起動を拒否）。詳しくは[Cloud Functions（Python）](../../products/functions-python/)を参照してください。

### Cloud Pub/Sub

- スキーマ、BigQuery/Cloud Storageへのサブスクリプション配信、exactly-once配信、メッセージ変換。
- `UpdateTopic`は`labels`のみ対応（`emulator`プロファイルでは`message_storage_policy`と`kms_key_name`も受け付けます）。`DetachSubscription`は未実装です。
- `emulator`プロファイルでは`messageStoragePolicy`・トピック鍵名・タグをGoogle Cloudリージョン検証なしでそのまま保存します。`strict`ではこれらを拒否します。

### App Check

- 実機アテステーション（Play Integrity、App Attest、DeviceCheck、reCAPTCHA）および限定使用トークンのリプレイ保護。ローカルのデバッグトークンには対応しています。

## ローカル制御の制限

- 1つのデーモン内のセッション同士は、仮想時計・Security Rules・Functions・受付バリアを共有します。
- メモリ上のスナップショットはデーモン稼働中のみ保持され、実行中のFunctions処理は含まれません。
- `awaitIdle`はEnterpriseテキストインデックスの構築完了を待たず、セッション間の因果的なフェンスも設けません。

## どのローカルエミュレータでも解消できない違い

ローカルで成功した操作が本番でも同じ結果になるとは限りません。Fireemuは実クォータ集計、課金、IAM、組織ポリシー、リージョン・ネットワーク差、サービスの段階的ロールアウトを再現せず、ローカルの処理性能から本番のレイテンシやスループットを予測することもできません。

Security RulesとAPIの実装はドキュメントと実環境の記録に基づいていますが、Firebase側の仕様変更や未検証の条件によって未記録の差異が生じる場合があります。

## ローカルでの上限

メモリ使用量を一定範囲に収めるため、Fireemu固有の上限を設けています。[Firestoreの履歴上限](../../products/firestore/#トランザクションと履歴)と、任意の[Storage保存バイト数上限](../../products/storage/#保存バイト数を制限する)です。

## バージョン間の変更

設定キーや動作はリリース間で変更されることがあります。[CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md)を確認してください。

## 関連項目

- [互換性の表](../)
- [プロファイルとproductionExact](../../guides/profiles/)
- [パフォーマンス](../performance/)
