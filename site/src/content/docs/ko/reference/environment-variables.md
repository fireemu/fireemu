---
title: 환경 변수
description: Fireemu가 명령과 Functions 코드를 위해 설정하는 환경 변수와, 읽는 환경 변수를 찾아봅니다.
---

이 목록은 `fireemu` 바이너리와 npm 패키지의 소스에서 가져온 것입니다. 여기에 나열되지 않은 것은 구현 세부 사항이며 변경될 수 있습니다.

## `fireemu exec`가 설정하는 변수

`exec`는 실행 중인 에뮬레이터의 변수를 명령에 전달하며, 그 외에 자체적으로 추가하는 것은 없습니다. 이름과 형식은 `firebase emulators:exec`가 기록하는 것을 따릅니다.

선택되지 않은 에뮬레이터의 변수는 환경에 있던 그대로 남으므로, 에뮬레이터가 없다고 해서 SDK가 실수로 프로덕션으로 향하는 일은 없습니다. `exec`는 각 변수에 대해 경고를 출력하며, `--deny-inherited-emulator-env`는 대신 실행을 거부합니다([상속된 에뮬레이터 변수](../cli/#상속된-에뮬레이터-변수) 참조).

| 변수 | 값 | 시점 |
|---|---|---|
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_FIRESTORE_EMULATOR_ADDRESS` | Firestore `host:port` | Firestore가 실행될 때 |
| `FIREBASE_AUTH_EMULATOR_HOST` | Authentication `host:port` | Authentication이 실행될 때 |
| `FIREBASE_STORAGE_EMULATOR_HOST` | Storage `host:port` | Storage가 실행될 때 |
| `STORAGE_EMULATOR_HOST` | Cloud Storage 클라이언트 라이브러리를 위한 Storage URL(`http://host:port`). Storage App Check가 `enforced`이고 `appCheck.storageServerRequests`가 `"capability"`로 설정되면 실행별 Admin capability도 함께 전달합니다([App Check](../../products/app-check/) 참조) | Storage가 실행될 때 |
| `FIREBASE_DATABASE_EMULATOR_HOST` | Realtime Database `host:port` | Realtime Database가 실행될 때 |
| `PUBSUB_EMULATOR_HOST` | Pub/Sub `host:port` | Pub/Sub가 실행될 때 |
| `CLOUD_EVENTARC_EMULATOR_HOST` | Eventarc URL(`http://host:port`) | Functions가 실행될 때 |
| `CLOUD_TASKS_EMULATOR_HOST` | Cloud Tasks `host:port` | Functions가 실행될 때 |
| `FIREEMU_FUNCTIONS_HOST` | Functions `host:port` | Functions가 실행될 때 |
| `FIREEMU_APP_CHECK_EMULATOR_HOST`, `FIREEMU_APP_CHECK_JWKS_URL` | App Check 교환 호스트와 JWKS URL | App Check를 사용할 수 있을 때([App Check](../../products/app-check/) 참조) |
| `FIREBASE_EMULATOR_HUB` | Emulator Hub `host:port` | Hub가 실행될 때 |
| `FIREBASE_LOGGING_EMULATOR_HOST` | Logging 에뮬레이터 `host:port` | Logging 에뮬레이터가 실행될 때 |
| `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` | 프로젝트 ID | 항상 |
| `FIREBASE_CONFIG` | 프로젝트 ID로부터 설정됨 | 환경에 이미 있는 경우를 제외하고 |
| `FIREEMU_CONTROL_URL` | `/v1/`로 끝나는 제어 API의 기본 URL | 항상 |
| `FIREEMU_CONTROL_TOKEN` | 제어 API의 bearer 토큰. `fireemu/testing`과 [Cloud Firestore](../../products/firestore/#누락된-인덱스에서-ci-작업-실패시키기)의 스크립트가 사용합니다 | 항상 |

`fireemu up`은 셸에 변수를 설정하지 않습니다. 시작 출력에 각 `host:port`가 출력되며(예: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`), Emulator UI의 Overview 페이지에서 "Environment for SDKs" 아래에 표시됩니다.

## Functions 코드에 설정되는 변수

Functions 코드베이스는 실행 중인 서비스에 대한 동일한 에뮬레이터 호스트 변수에 더해 `FUNCTIONS_EMULATOR=true`, 프로젝트 ID 변수, `FIREBASE_CONFIG`와 함께 실행됩니다.

데몬에서 상속되는 변수는 짧은 목록뿐입니다. 자격 증명은 의도적으로 전달하지 않습니다. `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN`, `CLOUDSDK_*`는 함수 코드에 도달하지 않습니다. `FIREEMU_RUNNER*` 변수는 내부용입니다.

## Fireemu가 읽는 변수

| 변수 | 효과 |
|---|---|
| `FIREEMU_BINARY_PATH` | `fireemu` 런처가 플랫폼 패키지의 바이너리 대신 이 바이너리를 실행합니다. 게시된 바이너리가 없는 플랫폼이거나 직접 빌드한 바이너리를 위한 것입니다. |
| `FIREEMU_NODE` | Functions 코드베이스를 실행하는 Node.js 실행 파일의 절대 경로. 실행 파일의 절대 경로가 아니면 거부됩니다. 지정하지 않으면 Fireemu는 `PATH` 디렉터리(와 Volta의 디렉터리, `VOLTA_HOME` 참조)에서 `node`를 찾습니다. |
| `FIREEMU_RUNNER_NODE`, `FIREEMU_RUNNER_PYTHON` | 번들된 것 대신 사용할 Functions 러너 스크립트(`index.mjs`, `runner.py`)의 경로. 파일이 없으면 오류입니다. |
| `FIREEMU_WORKER_THREADS` | 비동기 워커 스레드 수, 1에서 64. 기본값: 사용 가능한 코어 수, 최대 4. |
| `FIREEMU_MAX_BLOCKING_THREADS` | 블로킹 스레드의 상한, 1에서 512. 기본값: 64. |
| `FIREEMU_CONTROL_TOKEN` | `fireemu doctor --connect`가 이를 제어 API의 bearer 토큰으로 보냅니다. `fireemu exec` 안에서는 이미 설정되어 있습니다. |
| `FIREBASE_CONFIG` | `exec`는 이 변수가 설정되어 있으면 프로젝트 ID로 값을 기록하는 대신 사용자의 값을 유지합니다. |
| `PATH`, `VOLTA_HOME` | `FIREEMU_NODE`가 설정되지 않았을 때 Node.js를 찾는 위치. |
| `HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA` | Authentication 세션 서명 키의 캐시가 보관되는 위치(소유자 전용 디렉터리). 사용할 수 있는 캐시가 없으면 키는 시작할 때마다 메모리에서 생성됩니다. |
| `SUDO_UID` | Fireemu가 root로 실행될 때, 여기에 지정된 사용자도 검색된 구성 파일의 신뢰할 수 있는 소유자가 됩니다. [파일 소유권 검사](../../guides/configuration/#파일-소유권-검사)를 참조하십시오. |
| `ComSpec` | Windows에서 `fireemu exec "script"`의 스크립트 형태를 실행하는 셸. 기본값: `cmd.exe`. |
| `FIREEMU_TRACE_WEBCHANNEL`, `FIREEMU_TRACE_STORAGE` | 어떤 값이든 클라이언트 문제를 진단하기 위해 요청 추적(`[webchannel] ...`, `[storage] ...`)을 표준 오류에 출력합니다. 일반 실행용이 아닙니다. |
