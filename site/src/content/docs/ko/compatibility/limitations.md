---
title: 제한 사항
description: 로컬 결과를 신뢰하기 전에 Fireemu가 지원하지 않는 것과 어떤 로컬 에뮬레이터도 재현할 수 없는 것을 확인합니다.
---

Fireemu는 아직 프로덕션 Firebase의 모든 기능과 동작을 재현하지 않습니다. 아래는 주요 제한 사항이며 전부를 나열한 것은 아닙니다. 개별 API는 [기능 매니페스트](../#기능-매니페스트)에서 확인하거나 다음을 실행하십시오.

```sh
npx fireemu capabilities
```

## 지원하지 않는 제품

App Hosting과 Data Connect는 현재 지원하지 않습니다. Firebase Extensions 지원은 계획에 없습니다.

## 부분적으로 지원하는 제품

- **Realtime Database.** 녹화된 사례에 대해서만 제공하고 프로덕션과 대조해 검증했습니다([프로덕션 검증](../#프로덕션-검증) 참고). 그 밖의 프로덕션 호환성은 검증되지 않았으며, 공식 에뮬레이터에 대한 동등성 주장도 없습니다. 자세한 내용은 [Realtime Database](../../products/realtime-database/#공식-에뮬레이터와의-차이)와 아래 목록을 참고하십시오.

## 지원하지 않는 기능

### Cloud Firestore

- Enterprise Pipeline API는 읽기 작업의 제한된 부분 집합만 지원합니다([Enterprise 파이프라인](../../products/firestore/#enterprise-파이프라인) 참고).
- Enterprise 텍스트 검색은 유한한 로컬 어휘 검색과 명시적인 빌드 제어를 제공합니다. 분석과 순위 계산은 근사치이며, `productionExact`는 관찰되지 않은 검색 의미 체계를 거부합니다.

### Authentication

- 외부 ID 제공자와 통신하는 로그인 흐름, 호스팅되는 인증 코드 교환, 실시간 키 탐색과 교체는 지원하지 않습니다.
- 로컬에 구성된 서명된 OIDC/SAML 검증은 `auth.idpSigners` 공개 키 또는 SAML 제공자에 구성된 인증서를 사용하는 strict 서명 단언(signed-assertion) 경로에서 지원합니다.
- 제한된 SAML 검사는 상태, 대상(destination), 발급자, 수신 대상(audience), 유효 기간 필드의 존재 여부와 데몬이 발급한 것으로 알려진 요청에 대한 응답을 다룹니다. 필드가 없는 경우, 해석할 수 없는 시각, 그 밖의 녹화되지 않은 조합은 관찰되지 않은 상태로 남습니다.

### Cloud Storage

- 서명된 URL 또는 POST 정책의 서명 검증(만료와 조건은 검사합니다).
- `allUsers` 읽기 외의 객체 ACL, IAM, 버킷 수준 공개 액세스.
- 객체 합성(`compose`)과 알림 구성.
- **`strict`에서 녹화된 Storage CORS.** `conformance/storage-strictness-obs/recordings/run-2.json`은 버킷 CORS가 없는 경우, 비어 있는 경우, 구성된 경우에 대해 JSON API 메타데이터, 미디어, 버킷, 목록, UBLA ACL 오류 응답, 업로드 사전 요청(preflight), 재개 가능한 업로드 시작, 취소, 취소된 세션 읽기를 기록합니다. strict는 `productionExact` 없이도 녹화된 CORS 값을 사용하며, emulator 프로필은 기존 동작을 유지합니다. 요청 헤더의 대소문자 혼합 보존, UBLA PATCH/토글 동작, expose 목록을 다른 응답에 적용하는 것은 녹화되지 않은 가정입니다. 생성 시에는 녹화된 리전과 비활성화된 soft-delete 힌트를 받아들이지만, 해당 서비스를 모델링하지는 않습니다. 로컬 테스트는 UBLA 내보내기/가져오기와 비어 있는 생성 버킷을 다룹니다. [버킷 CORS](../../products/storage/#버킷-cors)를 참고하십시오.

### Realtime Database

- 녹화된 사례에 대해서만 프로덕션과 대조해 검증했습니다([프로덕션 검증](../#프로덕션-검증) 참고). 그 밖의 프로덕션 호환성은 검증되지 않았으며 공식 에뮬레이터에 대한 동등성 주장도 없습니다. 비교는 녹화된 공식 에뮬레이터 사례로 한정됩니다.
- 나열된 지원되지 않는 구문과 평가 사례(정규 표현식 구성 요소, 대소문자 매핑, 그 문서에 나열된 그 밖의 차이)는 규칙을 로드할 때 거부되거나 규칙 오류를 일으킵니다. `query.endBefore`, `query.isOrderByChild()`, `OrderByKey`, `OrderByValue`, `OrderByPriority` 이름, `http.encodeURL()`, 호출 없는 메서드 읽기, 삼항 호출 대상(callee)은 프로덕션에서 녹화된 동작대로 로드되고 평가됩니다.
- 공식 에뮬레이터의 결정화(determinization) 리소스 한도 때문에 거부된 녹화 패턴 8개는 평가되지 않는 식 분기 안에 있더라도 Fireemu가 규칙을 로드할 때 마찬가지로 거부됩니다. 이것이 정규 표현식의 완전한 동등성이나 프로덕션과의 동등성을 입증하지는 않습니다.
- Functions 트리거 전달은 제한된 집합의 녹화된 핸들러와 쓰기에서 관찰되었으며, 그 밖의 사례는 검증되지 않았습니다.
- 프로덕션에서 관찰되지 않아 공식 에뮬레이터의 동작을 따른 부분은 바뀔 수 있습니다.

[Realtime Database](../../products/realtime-database/#공식-에뮬레이터와의-차이)를 참고하십시오.

### Cloud Functions

- Fireemu가 이벤트를 전달하지 않는 제품의 트리거(예: 보류 중인 Data Connect). Remote Config 핸들러는 로컬 주입 동작을 통해서만 실행되며, 프로덕션 이벤트 형태는 관찰되지 않았습니다.
- Dart 코드베이스와 Firestore 이벤트 이외의 protobuf CloudEvents 수신. Firestore 이벤트는 Python SDK에는 protobuf로, Node 2세대 함수에는 `strict`에서 protobuf로 전달됩니다.
- Storage 아카이브 이벤트의 정확한 형태는 아직 녹화되지 않았습니다.
- Python 코드베이스는 HTTP, 호출 가능(callable), Firestore, Pub/Sub, Storage, Eventarc, Realtime Database, 예약, 작업 큐, Auth 차단 함수를 제공합니다. 실제 시간만 볼 수 있고(가상 시계 없음), `venv`와 Python 바이트코드 캐시에 대한 편집은 무시한 채 애플리케이션 소스 변경을 다시 로드하며, macOS와 Linux에서만 실행됩니다. 설치된 의존성을 바꾼 뒤에는 Fireemu를 다시 시작하십시오. 호출 가능 함수의 App Check 토큰은 Python SDK가 App Check 에뮬레이터의 키로 검증합니다(제한 사용 소비 없음, 명시적인 App Check 구성이 있으면 시작을 거부). [Cloud Functions (Python)](../../products/functions-python/)을 참고하십시오.

### Cloud Pub/Sub

- 스키마, BigQuery와 Cloud Storage 구독 전달, 정확히 한 번(exactly-once) 전달, 메시지 변환.
- `UpdateTopic`은 `labels` 업데이트 마스크와, emulator 프로필에서는 `message_storage_policy`, `kms_key_name` 업데이트 마스크만 지원합니다. `DetachSubscription`은 구현되어 있지 않습니다.
- `messageStoragePolicy`는 전송된 그대로 저장되며 Google Cloud 리전과 대조하지 않습니다. `strict` 프로필은 이를 거부합니다.
- 토픽 키 이름과 태그는 emulator 프로필에서 전송된 그대로 저장되며 검증하지 않습니다. strict 프로필은 이를 거부합니다.

### App Check

- Play Integrity, App Attest, DeviceCheck, reCAPTCHA를 통한 증명(attestation)과 제한 사용 토큰을 통한 재생 방지. 디버그 토큰을 사용한 로컬 테스트는 지원합니다.

## 로컬 제어의 제한 사항

- 세션은 시계, 규칙, Functions, 허용 장벽(admission barrier)을 공유합니다.
- 스냅샷은 데몬이 실행되는 동안 메모리에 보관되며, 진행 중인 Functions 작업은 포함하지 않습니다.
- `awaitIdle`은 Text Index 작업을 기다리지 않으며 세션 간 인과적 장벽(causal fence)도 제공하지 않습니다.

## 어떤 로컬 에뮬레이터로도 없앨 수 없는 차이

로컬에서 작업이 성공했다고 해서 프로덕션에서도 같은 결과가 나온다는 보장은 없습니다. Fireemu는 실제 할당량 계산, 결제, IAM, 조직 정책, 리전과 네트워크 차이, 서비스 롤아웃을 재현하지 않습니다. 로컬 성능은 프로덕션의 지연 시간이나 처리량을 예측하지 않습니다.

Security Rules와 API 동작은 문서와 Firebase의 실제 동작 관찰에 기반해 구현되었습니다. Firebase의 변경이나 아직 테스트하지 않은 조건으로 인해 아직 기록되지 않은 차이가 생길 수 있습니다.

## 로컬 한도

일부 한도는 메모리 사용을 제한하기 위해 Fireemu에만 존재합니다. [Firestore 이력 한도](../../products/firestore/#트랜잭션과-이력)와 선택 사항인 [Storage 저장 바이트 한도](../../products/storage/#저장-바이트-제한)입니다.

## 버전 간 변경

구성과 동작은 릴리스 사이에 바뀔 수 있습니다. [CHANGELOG](https://github.com/fireemu/fireemu/blob/main/CHANGELOG.md)를 참고하십시오.

## 관련 문서

- [호환성 표](../)
- [프로필과 productionExact](../../guides/profiles/)
- [성능](../performance/)
