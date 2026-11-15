---
title: 구성 스키마
description: fireemu.toml의 JSON Schema와 최상위 구성 섹션별 가이드를 찾아봅니다.
---

`fireemu.toml`은 JSON Schema로 기술됩니다. 같은 설정을 TOML(`fireemu.toml`) 또는 JSON(`fireemu.json`)으로 작성할 수 있습니다. 어떤 파일이 로드되는지는 [구성 파일](../../guides/configuration/)을 참조하십시오.

Fireemu는 시작할 때 스키마로 표현할 수 없는 규칙을 포함해 파일을 검증하며, 수락하지 않는 값이 있으면 오류와 함께 중지합니다. `npx fireemu config show`는 모든 키를 유효 값과 출처와 함께 출력합니다.

## 스키마 가져오기

- [이 사이트의 fireemu.schema.json](../../../spec/config/fireemu.schema.json).
- [GitHub의 spec/config/fireemu.schema.json](https://github.com/fireemu/fireemu/blob/main/spec/config/fireemu.schema.json). 같은 파일이 각 릴리스 태그의 `https://raw.githubusercontent.com/fireemu/fireemu/v<version>/spec/config/fireemu.schema.json`에도 있으며, 릴리스된 바이너리의 `fireemu init`이 새 파일에 기록하는 위치가 이것입니다(소스에서 빌드한 경우 `main` 위치를 기록합니다).
- `npx fireemu config schema --out fireemu.schema.json`은 실행하는 바이너리에 포함된 스키마를 기록합니다. 바이너리가 수락하는 키가 곧 검증에 사용하는 키입니다.

## 최상위 섹션

| 섹션 | 구성하는 대상 | 가이드 |
|---|---|---|
| `schemaVersion` | 항상 `1` | |
| `profile`, `productionExact` | 프로덕션 또는 공식 에뮬레이터 동작 | [프로필과 productionExact](../../guides/profiles/) |
| `firebaseJson` | 포트, 규칙, 인덱스, Functions를 읽어 올 `firebase.json` | [구성 파일](../../guides/configuration/) |
| `firestore` | 에디션, API 모드, 인덱스, 제한, 이력 | [Cloud Firestore](../../products/firestore/) |
| `rules` | Firestore Security Rules 소스, 그리고 Firestore와 Storage의 거부 로그 | [Security Rules](../../guides/security-rules/) |
| `auth` | `requireClientApiKey`(기본값 `false`)는 emulator 프로필이 API 키나 Authorization 헤더가 없는 클라이언트 요청을 공식 에뮬레이터의 403으로 거부하게 하며, strict는 변하지 않습니다. 로그인 방법, 비밀번호 정책, MFA, 테넌트, 공급자, 토큰, 그리고 Firestore, Storage, Realtime Database Security Rules 표면이 서명되지 않은 모의 ID 토큰을 수락할지 여부(`allowUnsignedIdTokens`)도 구성합니다 | [Authentication](../../products/auth/) |
| `storage` | Storage Security Rules, 객체 크기, 버퍼링된 본문 및 저장 바이트 제한, 버킷 선언(`undeclaredBuckets`), 버킷 CORS(`cors`), 서명된 URL 키(`signedUrlKeys`) | [Cloud Storage](../../products/storage/) |
| `database` | 규칙 파일이 없는 Realtime Database 인스턴스가 허용하는 것(`defaultAccess`). `auth.allowUnsignedIdTokens`는 두 프로필 모두에서 해당 규칙이 `@firebase/rules-unit-testing` 모의 토큰을 수락할지 결정합니다 | [Realtime Database](../../products/realtime-database/) |
| `hosting` | strict 프로필의 두 가지 개발 기본값: `cacheControl`(기본값 `"none"`, `productionExact`와 함께 `"production"`이면 파일에 `Cache-Control: max-age=3600`을 추가)과 `clientCountry`(기본값 `"honoured"`, `productionExact`와 함께면 `"ignored"`) | [Firebase Hosting](../../products/hosting/#프로필) |
| `functions` | 코드베이스, 러너, 애플리케이션 시계, 제공하지 않는 트리거, 제공할 함수의 고정 목록(`manifest`), `isolation`(기본값 `"codebase"`, `productionExact`와 함께면 `"function"`: 함수당 러너 프로세스 하나를 첫 트리거 시 시작), `taskNameReuse`, `taskDispatchDeadlineSeconds`, `taskRetryDefaults`, `taskRetryBackoff`(Cloud Tasks 큐의 개발 기본값이며 `productionExact`가 프로덕션 값으로 설정합니다. [프로필](../../guides/profiles/) 참조), 그리고 `authBlockingToken`(기본값 `"emulated"`, `strict`에서 `productionExact`와 함께면 `"production"`: 서명된 토큰을 전달하며 Python 러너가 SDK 규칙으로 검증합니다. Node 함수는 같은 프로덕션 형태의 토큰을 받지만 검증하지 않으므로 이전과 동일하게 동작합니다) | [Cloud Functions](../../products/functions/) |
| `scheduler` | 예약 함수의 시간대, 따라잡기, 중첩 | [시간과 예약 함수](../../guides/time/) |
| `pubsub`, `eventarc` | 인증 및 전달 설정. `pubsub.restNegativeCache`(기본값 `"off"`. `"production"`은 strict에서 명시적으로 선택하는 옵션으로, 프로덕션이 연결에서 보인, 실제 `404` 이후 약 10초간 캐시된 `404`를 재현합니다. `productionExact`는 이를 선택하지 않습니다) | [Pub/Sub와 Eventarc](../../products/pubsub-eventarc/) |
| `appCheck` | 앱, 디버그 토큰, 강제 적용 | [App Check](../../products/app-check/) |
| `daemon` | 포트, 프로젝트, 시작 시각, 시계가 이동하는 방식(`clock`) | [시간과 예약 함수](../../guides/time/) |
| `network` | 루프백 외의 수신 대기(`allowNonLoopbackHosts`)와, 에뮬레이터가 응답하는 추가 `Host` 이름(`allowedHosts`, DNS 리바인딩 방어) | [CI와 컨테이너](../../guides/ci-and-containers/#에뮬레이터가-응답하는-호스트-이름) |
| `bind` | 수락되지만 현재 효과 없음: 데몬은 루프백 주소에 바인딩하며, `firebase.json`의 `emulators.<name>.host`가 서비스별 호스트를 설정합니다 | [CI와 컨테이너](../../guides/ci-and-containers/) |
| `projects` | `demo-` 프로젝트 ID만 수락할지 여부(`requireDemoPrefix`), 그리고 다른 프로젝트를 지정한 요청을 처리할지 거부할지 여부(`unknownProjects`) | [프로필과 productionExact](../../guides/profiles/) |
| `limits` | 제한 카탈로그, 경고, 할당량 계산, 계획 재정의를 위해 예약되어 있습니다. 아직 동작을 바꾸는 멤버는 없습니다. 각 멤버는 효과 없이 수락되거나, 비어 있거나 기본인 값만 수락하고 그 외의 값은 거부합니다. Firestore의 제한은 `firestore.enforceLimits`로 전환합니다 | |
| `events` | 함수 트리거 이벤트의 전달: `retry`로 선언된 함수의 `maxAttempts`(기본값 4). `delivery`는 `exactly-once-test`만 수락합니다 | [프로필과 productionExact](../../guides/profiles/) |
| `trace` | 수락되지만 현재 효과 없음 | |

효과 없이 수락되는 키는 실행이 로드할 때 `note:` 줄을 출력합니다. 이러한 설정이 있을 때 CI 작업을 실패시키려면 `fireemu config lint --deny-ineffective`를 실행하십시오. 해당 설정을 나열하며, 각 설정을 `--allow` 항목이 포함하지 않는 한 종료 코드 1로 끝납니다([`config lint`](../cli/#config-lint) 참조).

## Storage 크기 제한

| 키 | 설정 대상 | 기본값 | 최댓값 |
|---|---|---|---|
| `storage.maxObjectBytes` | 객체 하나의 최대 크기. 요청 본문 상한은 이 값에 4194304바이트를 더한 값입니다 | 268435456바이트 | 2143289343 |
| `storage.bufferedBodyBudgetBytes` | 버퍼링된 Storage 요청 본문에 대한 프로세스 전체 예산 | 1073741824바이트 | 2147483647 |

두 값 모두 양의 정수여야 합니다. 별도의 저장 바이트 및 재개 가능한 업로드 제한은 [Cloud Storage](../../products/storage/)를 참조하십시오.
