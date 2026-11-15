---
title: 데이터 내보내기와 가져오기
description: 에뮬레이터 데이터를 저장하고, 시작할 때 불러오고, 실행 간에 유지합니다.
---

실행 중인 에뮬레이터의 데이터를 디렉터리로 내보내고, 시작할 때 가져오며, 실행이 끝나면 다시 기록합니다.

## 실행 중인 에뮬레이터에서 내보내기

`fireemu up`이 실행 중인 상태에서 다른 터미널에서 다음을 실행합니다.

```sh
npx fireemu emulators:export ./emulator-data
```

`--force`는 비어 있지 않은 대상을 덮어씁니다.

## 시작 시 가져오기와 종료 시 내보내기

`--import <dir>`은 시작할 때 내보내기 결과를 불러옵니다. 디렉터리 없이 지정한 `--export-on-exit`은 실행이 끝날 때 같은 디렉터리에 상태를 다시 기록합니다.

```sh
npx fireemu exec --import ./emulator-data --export-on-exit -- npm test
```

`--import`가 받아들이는 대상은 다음과 같습니다.

- 비어 있는 `--import` 디렉터리는 데이터 없이 시작하므로, 첫 실행에 별도의 명령이 필요하지 않습니다.
- 존재하지 않는 디렉터리는 거부됩니다. 경로를 잘못 입력해 빈 스위트가 시작되는 일을 막기 위함이며, `--export-on-exit`이 기록하는 위치와 같은 경우는 예외입니다.
- 파일은 있지만 `firebase-export-metadata.json`이 없는 디렉터리는 거부됩니다.
- Realtime Database 가져오기는 어떤 제품이 데이터를 설치하기 전에 검증됩니다. `strict`에서는 가져온 JSON 문자열 값에 단독 서로게이트(lone surrogate)가 있으면 거부되고, `emulator` 프로필은 공식 에뮬레이터와 마찬가지로 이를 `?`로 대체합니다. 잘못된 키는 두 프로필 모두에서 거부됩니다. [Realtime Database 가져오기](../../products/realtime-database/#내보내기-가져오기-스냅샷)를 참조하십시오.

`--export-on-exit`의 동작은 다음과 같습니다.

- `--export-on-exit`이 실패하면 `error:` 줄로 출력되고, 명령이 성공했더라도 실행은 종료 코드 1로 끝납니다. 공식 CLI는 경고만 하고 0으로 종료하지만, 저장된 데이터에 의존하는 CI 작업이 데이터 없이 통과할 수 없도록 Fireemu는 다르게 동작합니다.
- 내보내기 디렉터리는 `/data`에 마운트된 컨테이너 볼륨처럼 볼륨 마운트 지점일 수 있습니다. 마운트 지점은 원자적 이름 변경(rename)으로 교체할 수 없으므로, 내보내기는 그 안에서 준비된 뒤 제자리로 옮겨지며, 이전 `firebase-export-metadata.json`이 먼저 빠지고 새 파일이 마지막에 들어옵니다. 이 교체는 원자적이지 않습니다. 내보내기가 중단되면 매니페스트가 없는 디렉터리가 남으며, `--import`는 그 일부만 불러오는 대신 이를 거부합니다.
- 그 외의 디렉터리는 여전히 원자적으로 교체됩니다.

## 내보내기 위치

영속 실행을 시작하기 전에, 디렉터리를 만들거나 권한을 바꾸지 않고 대상을 점검합니다.

```sh
npx fireemu doctor --export-dir "$HOME/.local/share/fireemu/emulator-data"
```

Unix 계열 시스템에서는 홈 디렉터리를 포함해 대상과 존재하는 모든 상위 디렉터리의 소유권과 권한을 확인합니다. 각각 본인 또는 root가 소유해야 하며 다른 사용자가 쓸 수 없어야 합니다. 예외는 `/tmp`처럼 스티키 비트가 설정된 root 소유 디렉터리입니다(macOS의 `/tmp`는 `/private/tmp`로의 root 소유 링크이며 이 링크를 따라갑니다).

- **공유 디렉터리.** 스티키 디렉터리에서는 다른 사용자가 항목을 만들 수 있지만 본인의 항목을 이름 변경하거나 삭제할 수는 없으므로 `--export-on-exit /tmp/emulator-data`가 동작합니다. 그래도 다른 사용자가 먼저 그 이름을 차지하면 내보내기가 거부되므로, 공유 머신에서는 본인 전용 디렉터리를 사용하는 편이 더 안정적입니다. `/tmp` 아래에서는 이미 존재하는 내보내기 디렉터리가 본인 소유여야 하고 다른 사용자가 쓸 수 없어야 합니다(`chmod 700`).
- **거부되는 경우.** 스티키 비트 없이 다른 사용자가 쓸 수 있는 디렉터리, 또는 다른 사용자의 디렉터리.
- **심볼릭 링크.** 내보내기 경로의 모든 심볼릭 링크를 검사합니다. root가 소유한 경우, 또는 본인(또는 root)만 쓸 수 있는 디렉터리 안에서 본인이 소유한 경우에만 따라가므로, 다른 사용자가 `/tmp`에 만든 링크는 절대 따라가지 않습니다. 심볼릭 링크 바로 뒤의 `..`는 거부됩니다. 링크를 담고 있는 디렉터리는 상위 디렉터리와 같은 검사를 통과해야 합니다(소유권을 강제하는 볼륨이어야 하고, 다른 사용자에 대한 ACL 항목이 없어야 합니다).
- **검사 시점.** `--export-on-exit`은 데몬이나 자식 명령이 시작되기 전에 검사하고, 권한이 바뀔 수 있으므로 내보낼 때 다시 검증합니다. 사전 점검(preflight)부터 실행이 끝날 때까지 내보내기 디렉터리의 상위 디렉터리를 열어 두므로, 그동안 이름이 바뀌거나 링크된 항목은 따라가지 않습니다.
- **볼륨 마운트.** 볼륨 마운트 대상은 상위 디렉터리가 쓰기 가능하지 않더라도 자체는 쓰기 가능해야 합니다.
- **그룹 쓰기 가능 파일.** 구성 탐색은 비공개 그룹 환경을 위해 그룹이 쓸 수 있는 파일을 허용하지만, 내보내기 게시는 더 엄격한 정리 안전 규칙을 유지합니다.

### macOS

- **ACL.** 소유자, root, 내보내기를 실행하는 사용자가 아닌 누군가에 대한 `allow` 항목이 ACL에 있으면, 그 항목이 표시하는 권한과 무관하게 해당 ACL이 있는 상위 디렉터리는 거부됩니다(커널은 `ls -le`가 나열하지 않는 권한을 부여합니다). `deny` 항목은 허용되므로, `group:everyone deny delete`를 가진 표준 홈 디렉터리와 그 아래 폴더는 동작합니다.
- **ACL 거부 해결.** ACL 때문에 내보내기가 거부되면 메시지에 해당 항목이 표시됩니다. 그 항목을 제거(`chmod -a`)하거나 `$TMPDIR` 아래 디렉터리 같은 다른 디렉터리로 내보내십시오. 상위 디렉터리는 `/bin/ls -led <directory>`로 확인합니다.
- **소유권을 무시하는 볼륨.** 소유권을 무시하는 볼륨(exFAT와 FAT 스틱 및 카드, 또는 "Ignore ownership on this volume"이 켜진 외장 APFS 볼륨)에 있는 대상은 거부됩니다. 디렉터리의 소유자와 모드로는 누가 변경할 수 있는지 알 수 없기 때문이며, 소유권을 강제하는 볼륨으로 내보내십시오.
- **원자적 이름 변경이 없는 볼륨.** 원자적 디렉터리 이름 변경이 없는 볼륨(exFAT, FAT, 일부 네트워크 파일 시스템)에서는 내보내기를 게시할 수도 없습니다. APFS 볼륨의 디렉터리를 사용하십시오.

### Windows

`emulators:export`와 `--export-on-exit`은 현재 사용할 수 없습니다. 가져오기와 나머지 에뮬레이터는 동작합니다.

## 독립 테스트 월드 내보내기

[테스트 월드](../test-worlds/)에서 `hub: true`는 월드의 기존 CLI 내보내기 명령을 위한 비공개 Hub를 활성화합니다. `world.directory` 밖에 있는, 호출자가 소유한 절대 내보내기 경로를 사용하십시오.

```js
import { resolve } from 'node:path';
import { createTestWorld } from 'fireemu/testing';

const exportPath = resolve('./emulator-data');
const services = ['auth', 'firestore', 'storage'];
const world = await createTestWorld({ services, hub: true });
try {
  await world.run('fireemu', [
    'emulators:export', exportPath, '--project', world.projectId,
  ]);
} finally {
  await world.dispose();
}
const restored = await createTestWorld({ services, import: exportPath });
try {
  // Connect fresh SDK clients through restored.endpoints or restored.run(...).
} finally {
  await restored.dispose();
}
```

- `--project`를 명시적으로 전달하십시오.
- 헬퍼가 Hub의 OS 할당 포트와 비공개 로케이터를 소유하며, 같은 프로젝트의 월드끼리도 독립적으로 유지됩니다.
- 개발용 바이너리를 사용하는 경우, `binaryPath`와 내보내기 명령 모두에 그 절대 경로를 사용하십시오.
- 가져오기는 생성 시점에 스냅샷으로 저장되므로, 이후 원본 내보내기를 수정해도 리셋에 영향을 주지 않습니다.
- 월드 디렉터리 밖의 내보내기는 폐기(dispose) 이후에도 호출자의 소유로 남습니다.

[내보내기와 가져오기 전체 가이드](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#export-and-import-test-data)를 참조하십시오.

## 내보내기에 보존되는 항목

| 보존됨 | 보존되지 않음 |
| --- | --- |
| Auth 사용자와 비밀번호 자격 증명 | App Check 상태 |
| Firestore 문서 | 가상 시계 |
| Storage 바이트와 메타데이터 | Functions 프로세스 메모리 |
| Realtime Database 데이터 | 이전에 발급된 토큰의 유효성 |

## 관련 문서

- [테스트 월드](../test-worlds/)
- [CLI 레퍼런스](../../reference/cli/)
- [Realtime Database](../../products/realtime-database/#내보내기-가져오기-스냅샷)
- [문제 해결](../troubleshooting/)
