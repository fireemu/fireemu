---
title: Local Emulator Suite에서 이전하기
description: 프로젝트를 firebase emulators:exec에서 Fireemu로 옮기고 strict 프로필에서 실패하는 테스트를 해결합니다.
---

Fireemu는 기존 `firebase.json`을 읽고, 같은 기본 포트를 제공하며, 공식 명령 이름을 받아들이므로 대부분의 프로젝트는 명령 하나를 바꾸는 것으로 이전할 수 있습니다.

## 시작하기 전에

사용하는 제품이 [지원 목록](../../#supported-products)에 있는지 확인하십시오. Local Emulator Suite는 App Hosting, Data Connect, Extensions도 제공하지만 Fireemu는 제공하지 않으며, Realtime Database는 부분적으로만 지원합니다.

## 명령 바꾸기

1. Fireemu를 설치하고 `firebase.json`을 참조하는 `fireemu.toml`을 만듭니다.

   ```sh
   npm install --save-dev fireemu
   npx fireemu init --firebase-json firebase.json
   ```

   기본값인 `profile = "strict"`를 유지하십시오.

2. 명령을 바꿉니다.

   | 이전 | 이후 |
   |---|---|
   | `firebase emulators:exec "npm test"` | `fireemu exec -- npm test` |
   | `firebase emulators:start` | `fireemu up` |

   `fireemu emulators:exec`와 `fireemu emulators:start`도 동작하며, `exec`는 공식 CLI의 따옴표로 묶은 스크립트 형식도 받아들입니다.

3. 테스트를 실행합니다.

## `strict`에서 테스트가 실패할 때

공식 에뮬레이터에서는 통과했지만 `strict`에서는 실패하는 테스트는 애플리케이션이 프로덕션에서도 마주칠 동작을 보여 주는 경우가 많습니다. 테스트나 애플리케이션을 고치거나, 아래의 특정 설정만 완화하십시오. 프로필 전체를 `emulator`로 바꾸는 것은 피하십시오.

### 서명되지 않은 에뮬레이터 ID 토큰

`@firebase/rules-unit-testing`의 `authenticatedContext()`와 클라이언트 SDK의 `mockUserToken`은 `strict`에서도 기본적으로 동작합니다.

- `auth.allowUnsignedIdTokens`를 `false`로 설정하면 Security Rules 표면에서 이 토큰의 대체 처리가 비활성화되어, 프로덕션이 이를 거부하는 동작을 테스트할 수 있습니다.
- 거부 테스트에는 SDK 도우미의 기본값인 `iat: 0` / `exp: 3600`을 만료 이후의 시계와 함께 사용하십시오. 정상적인 검증을 통과하는 Fireemu 발급 토큰은 계속 수락됩니다.
- 서명되지 않은 모든 ID 토큰을 거부하려면 `auth.idTokenSigning = "session-rsa"`를 사용하십시오.

[서명되지 않은 모의 ID 토큰](../../products/auth/#unsigned-mock-id-tokens)을 참고하십시오.

### 이름이 있는 데이터베이스

이름이 있는 데이터베이스는 `firebase.json`의 `firestore` 배열에 각각 `rules`와 `indexes` 파일과 함께 선언하거나, 프로덕션에서 필요한 방식대로 Admin API로 생성하십시오. 실행 중에 생성한 데이터베이스는 규칙을 로드하기 전까지 Security Rules가 없습니다([Firestore](../../products/firestore/#named-databases) 참고).

### 복합 인덱스

쿼리는 프로덕션과 같은 방식으로 선언된 인덱스와 대조해 검사됩니다. 쿼리에 필요한 인덱스를 `firestore.indexes.json`에 선언하고 `firebase.json`에서 참조하십시오.

- 인덱스가 없는 쿼리는 프로덕션과 마찬가지로 `FAILED_PRECONDITION`과 인덱스 링크와 함께 거부됩니다.
- 필드가 하나뿐인 복합 인덱스는 `firebase deploy`가 거부하는 것과 같이 파일을 로드할 때 거부됩니다. `fieldOverrides`를 사용하십시오.
- 인덱스를 추가하는 동안 이런 쿼리를 계속 실행하려면 `firestore.missingIndexes`를 `"report"`로 설정하십시오. 쿼리는 실행되고, 누락된 인덱스는 데이터베이스마다 한 번씩 프로덕션의 거부 문구와 `firestore.indexes.json` 항목과 함께 표준 오류로 보고됩니다. `productionExact`는 이 키를 바꾸지 않습니다.
- OR 쿼리에서는 보조 표준 오류 진단이 서로 다른 누락된 분기 인덱스를 모두 나열하므로 정의를 한꺼번에 추가할 수 있습니다. `strict`는 여전히 첫 번째 인덱스 생성 링크가 담긴 기존 SDK 오류를 반환하고, `emulator` 프로필은 여전히 쿼리를 실행합니다. 반복되는 제안은 중복 제거되며 진단 캐시에는 상한이 있습니다.

### 프로덕션 프로젝트를 반영하는 설정

프로필을 바꾸는 대신 다음 설정을 프로덕션 프로젝트에 맞추십시오.

| 설정 | `strict`에서의 동작 |
|---|---|
| `auth.improvedEmailPrivacy` | 이메일 열거 보호. 새 프로덕션 프로젝트에서는 켜져 있습니다. 프로덕션 프로젝트에서 껐을 때만 `false`로 설정하십시오. 그러면 로그인이 공식 Auth 에뮬레이터처럼 `EMAIL_NOT_FOUND`와 `INVALID_PASSWORD`로 응답합니다. |
| `auth.mfa` | 프로젝트의 다단계 인증 구성. `strict`는 SMS와 TOTP를 켠 상태로 시작하고, `productionExact`는 새 프로덕션 프로젝트처럼 다단계 인증을 끈 상태로 시작합니다. [Authentication](../../products/auth/#multi-factor-authentication)을 참고하십시오. |
| `firestore.enforceLimits` | 프로덕션은 항상 Standard 에디션의 쿼리 한도를 적용합니다. `false`로 하면 프로덕션이 거부하는 쿼리가 통과하므로, 특별한 이유가 없다면 켜 두십시오. `strict`에서는 쿼리 한도만 전환합니다. |

## 공식 CLI와의 차이

- `--export-on-exit`가 실패하면, 명령이 성공했더라도 실행은 종료 코드 1로 끝납니다. 공식 CLI는 경고만 하고 0으로 종료합니다. 저장된 데이터에 의존하는 CI 작업이 그 데이터 없이 통과하지 못하도록 Fireemu는 다르게 동작합니다.
- Unix에서는 발견된 `fireemu.toml` 또는 `firebase.json`을 소유자가 신뢰할 수 있을 때만 로드합니다. [구성 파일](../../guides/configuration/#file-ownership-checks)을 참고하십시오.
- `strict`에서 Security Rules가 없는 프로젝트는 규칙 릴리스가 없는 프로덕션 프로젝트처럼 동작하며, 클라이언트 요청이 거부됩니다. [Security Rules](../../guides/security-rules/)를 참고하십시오.

## 관련 문서

- [앱 연결하기](../connect/)
- [프로필과 productionExact](../../guides/profiles/)
- [호환성 표](../../compatibility/)
- [제한 사항](../../compatibility/limitations/)
