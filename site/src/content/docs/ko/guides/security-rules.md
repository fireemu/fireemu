---
title: Security Rules
description: Firestore, Storage, Realtime Database의 Security Rules를 로드하고, 요청이 거부된 이유를 확인합니다.
---

Firestore, Storage, Realtime Database의 Security Rules를 로드하고, 어떤 조건이 요청을 거부했는지 확인하며, 모의 토큰으로 테스트합니다.

## 규칙 로드

Firebase CLI와 마찬가지로 `firebase.json`에 규칙 파일을 지정합니다.

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" }
}
```

또는 `fireemu.toml`에 지정합니다(Firestore는 `rules.source`, Storage는 `storage.rules`). 시작 출력의 `firestore rules:`와 `storage rules:` 줄이 규칙이 로드되었는지 알려 줍니다.

Realtime Database 규칙은 `firebase.json`의 `database` 섹션에서 로드됩니다. 기본 인스턴스에는 파일 하나를, 인스턴스나 배포 대상별로는 각각 하나씩 지정합니다. 시작 출력의 `database rules:` 줄에 각 파일과 해당 인스턴스가 표시됩니다. 각 프로필이 허용하는 자격 증명, 규칙이 없는 인스턴스가 허용하는 것, 공식 에뮬레이터와의 차이는 [Realtime Database](../../products/realtime-database/#security-rules)를 참조하십시오.

`@firebase/rules-unit-testing`으로 실행 시점에 규칙을 로드할 수도 있습니다. `initializeTestEnvironment`는 전달한 `firestore.rules`와 `storage.rules`를 에뮬레이터로 보내며, `testEnv.clearFirestore()`도 지원됩니다.

로드 시 확인하는 사항은 다음과 같습니다.

- 공식 에뮬레이터와의 비교는 기록된 사례로 한정됩니다.
- 나열된 미지원 구문과 평가 사례는 규칙을 로드할 때 거부되거나 규칙 오류를 일으킵니다.
- 공식 에뮬레이터의 결정화(determinization) 리소스 한도 때문에 거부되는 것으로 기록된 여덟 가지 패턴도, 평가되지 않는 표현식 분기 안에 있는 경우를 포함해 Fireemu가 규칙을 로드할 때 거부됩니다. 이것이 정규 표현식의 완전한 동등성이나 프로덕션과의 동등성을 증명하는 것은 아닙니다.

## 규칙이 없는 프로젝트

`strict`에서 Security Rules가 없는 프로젝트는 규칙 릴리스가 없는 프로덕션 프로젝트처럼 동작합니다.

- Firestore에 대한 모든 클라이언트 요청이 `PERMISSION_DENIED`로 거부됩니다.
- Storage에 대한 모든 최종 사용자 요청이 프로덕션의 400 "bucket has not been set up" 응답으로 거부됩니다.

Admin SDK와 기타 소유자 자격 증명은 영향을 받지 않습니다.

이 응답들은 프로덕션의 문구를 그대로 유지합니다. 그래서 데이터베이스와 버킷마다 처음 거부된 요청은 규칙이 로드되지 않았다는 사실과 로드하는 방법을 알려 주는 경고도 표준 오류에 출력합니다.

`emulator` 프로필은 공식 에뮬레이터와 마찬가지로 모든 Firestore 요청과, `demo-*` 프로젝트의 모든 Storage 요청을 허용합니다.

## 요청이 거부된 이유

프로덕션은 거부를 짧은 메시지(Firestore의 `PERMISSION_DENIED` "Missing or insufficient permissions.", Storage의 403)로 응답하며, 어떤 규칙이 거부했는지는 알려 주지 않습니다. Fireemu는 최종 사용자 요청의 거부를 표준 오류에도 출력하며, 요청이 평가한 모든 `allow` 조건과 그 평가 결과를 함께 보여 줍니다.

```text
note: firestore: Security Rules denied get on "notes/n1" in "database (default)" (request.auth.uid "bob"): no allow statement evaluated to true; line 5:22 `request.auth.uid == resource.data.owner` was false
```

- 이 줄들을 끄려면 `fireemu.toml`에서 `rules.denialLog`를 `"off"`로 설정합니다. 예를 들어 거부를 많이 검증하는 스위트에서 유용합니다. 클라이언트에 대한 응답은 어느 쪽이든 같습니다.
- Rules 페이지와 `GET /v1/sessions/default/rules/requests`는 추적된 최신 Firestore 결정 100개를 보여 줍니다. 추적은 UI 또는 첫 제어 API 읽기와 함께 시작되며, 새 규칙 집합을 로드하면 이력이 지워집니다. 이것은 디버깅용 뷰이며 전체 요청 로그가 아닙니다.

### 진단 한계

이 한도는 진단에만 영향을 주며, 허용/거부 결정에는 영향을 주지 않습니다.

- Firestore와 Storage Rules 진단은 표현식마다 서로 다른 값을 최대 64개까지 유지합니다.
- 문자열 값과 오류 메시지는 1,024 UTF-8 바이트 이내의 문자 경계에서 잘립니다.
- Firestore 커버리지 JSON/HTML과 제어 요청 추적은 잘린 값을 `truncated: true`로 표시하며, 생략된 관측값에는 `valuesOmitted`와 `valuesCountMayBeLower: true`가 추가됩니다. 따라서 표시되는 개수가 값의 실제 개수보다 적을 수 있습니다.

## 모의 토큰을 사용한 단위 테스트

`@firebase/rules-unit-testing`의 `authenticatedContext()`와 클라이언트 SDK의 `mockUserToken` 옵션은 서명되지 않은 모의 ID 토큰을 보냅니다. Fireemu는 이를 기본적으로 `strict`에서도 수락하며, 공식 에뮬레이터와 마찬가지로 토큰의 클레임으로 `request.auth`를 구성합니다. `strict`에서는 정확히 그 토큰 형태만 수락되며, 그 외의 모든 토큰은 만료 시각을 포함해 검증됩니다.

서명되지 않은 토큰에 대한 프로덕션의 거부를 테스트하려면 `auth.allowUnsignedIdTokens`를 `false`로 설정하거나 [`productionExact`](../profiles/)를 설정하십시오.

## Rules 언어 세부 사항

Fireemu가 Rules를 평가하는 방식의 예외 사례입니다.

### 문서가 아닌 경로에 대한 `get()`과 `exists()`

`get()`과 `exists()`는 요청이 실행되는 데이터베이스의 문서 경로를 받습니다. 다음 경로들은 문서를 가리키지 않으므로 호출이 평가 오류가 됩니다.

- 컬렉션 경로(`/databases/$(database)/documents/users`, `documents` 뒤의 세그먼트 수가 홀수)
- 다른 데이터베이스의 경로(`/databases/other/documents/users/u1`)
- `documents`가 없는 경로(`/databases/$(database)/users/u1`)

다른 Rules 오류와 마찬가지로 조건이 실패하게 되어, `||`나 `&&`의 다른 쪽이 결과를 결정하지 않는 한 요청은 거부됩니다(`exists(<such a path>) || true`는 허용하며, 이러한 조합에 대한 프로덕션의 응답은 기록되지 않았습니다). `!exists(...)`와 `get(...) == null`은 해당 경로를 "없음"으로 읽지 않고 허용하며, 프로덕션은 이를 거부하고 공식 에뮬레이터도 마찬가지입니다.

존재하지 않는 문서의 경로는 계속 누락된 문서로 취급됩니다. `exists()`는 `false`이고 `get()`은 `null`입니다.

경로를 잘못 입력해 문서 id가 빠진 것이 흔한 원인이므로, 거부 로그의 `was an error` 줄이 해당 호출을 가리킵니다.

### 쿼리와 저장된 문서

Firestore 쿼리는 프로덕션과 마찬가지로, 반환될 문서가 아니라 쿼리의 필터를 기준으로 권한이 확인됩니다.

한 가지 예외가 있습니다. 단일 `documentId() ==` 필터를 가진 쿼리 분기는 다른 필터, limit, offset, 커서가 무엇이든 저장된 그 문서를 기준으로 결정되며, 이는 프로덕션과 공식 에뮬레이터가 결정하는 방식과 같습니다. 이 증명에서 `resource.data`는 쿼리가 필터링하거나 정렬하는 필드만 정확히 담으므로, `keys()`, `size()`, `in`, `get(key, default)`는 그 필드만으로 응답합니다.

문서 하나를 지정하는 분기와 아무 문서도 지정하지 않는 분기가 섞인 `OR` 쿼리는 프로필에 따라 다릅니다.

- `emulator` 프로필은 공식 에뮬레이터와 마찬가지로 분기별로 권한을 확인합니다.
- `strict` 프로필은 모든 분기를 해당 필터로부터 증명합니다. 프로덕션이 그 쿼리에 누락 인덱스 오류로 응답했고 Rules 응답은 기록되지 않았기 때문입니다.

### 규칙의 문자열

Firestore와 Storage Rules는 프로덕션과 마찬가지로 문자열을 UTF-16 코드 유닛 기준으로 인덱싱하고 길이를 측정합니다. `"é🔥x".size()`는 4이고 `"é🔥x"[3] == "x"`입니다. `lower()`와 `upper()`는 ASCII 문자만 변환하며, 문자열은 절대 정규화되지 않습니다. 정규 표현식은 여전히 보충 문자(supplementary character)를 한 문자로 취급합니다.

서로게이트 쌍의 절반은 프로필에 따라 다릅니다.

- `strict`에서는 자기 자신하고만 같은 조각(fragment)이며, 단독 서로게이트를 담은 `split()`, `replace()`, `matches()` 패턴은 프로덕션의 응답과 같이 규칙을 실패시킵니다.
- `emulator` 프로필은 공식 에뮬레이터와 마찬가지로 단독 유닛을 그대로 유지합니다.

## 관련 문서

- [Cloud Firestore](../../products/firestore/)
- [Cloud Storage](../../products/storage/)
- [Realtime Database](../../products/realtime-database/#security-rules)
- [프로필과 productionExact](../profiles/)
