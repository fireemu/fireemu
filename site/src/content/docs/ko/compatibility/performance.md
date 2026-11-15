---
title: 성능
description: 공식 Firestore 에뮬레이터와 비교해 측정한 시작 시간, 메모리, 처리량을 확인하고 자신의 테스트 스위트에 적용합니다.
---

Fireemu는 같은 SDK 워크로드로 공식 Firestore 에뮬레이터와 비교됩니다. 둘은 같은 GitHub Actions Linux 러너에서 차례로 실행되며, Fireemu는 `emulator` 프로필을 사용합니다. 벤치마크는 각 작업의 결과도 검사합니다.

## 결과

이 결과는 커밋 `f3b942c`의 `standard` 실행 1회에서 나온 것으로, `firebase-tools` 15.28.2가 실행하는 Firestore 에뮬레이터와 JDK 21.0.8에서 비교했습니다. 비율은 측정한 다섯 쌍에서 계산했으며, 절댓값은 환경에 따라 달라집니다.

| 지표 | 공식 에뮬레이터 | Fireemu | 비교 |
|---|---:|---:|---:|
| SDK가 Firestore를 사용할 수 있을 때까지의 시작 시간 | 3,043 ms | 140 ms | 21.6배 빠름 |
| 빈 데이터베이스의 유휴 메모리(PSS) | 390 MiB | 11 MiB | 메모리 약 1/34 |
| 시행 중 최대 메모리(cgroup) | 849 MiB | 79 MiB | 메모리 약 1/10.7 |
| 22개 워크로드에 걸친 Firestore 처리량 | — | — | 1.1배에서 5.2배 높음 |

시작 시간 비율의 95% 신뢰 구간은 [21.4, 21.8]입니다. 최대 메모리 비율(공식 에뮬레이터를 Fireemu로 나눈 값)은 [10.2, 11.1]입니다.

워크플로는 [benchmark.yml](https://github.com/fireemu/fireemu/blob/main/.github/workflows/benchmark.yml)을, 벤치마크는 [`tools/bench/`](https://github.com/fireemu/fireemu/tree/main/tools/bench)를 참고하십시오.

## 테스트 스위트에 결과 적용하기

측정한 시작 시간과 로드된 메모리 값은 워크플로 중 이 엔진을 시작하는 부분만 추정하는 데 사용하십시오. 검증된 실행 한 번과 자신의 프로세스 수로 다음 템플릿을 채웁니다.

| 수량 | 기준 | 후보 |
|---|---:|---:|
| SDK 사용 가능 시작 시간(초) | 측정한 밀리초 / 1000 | 측정한 밀리초 / 1000 |
| 로드된 유휴 PSS(엔진당 MiB) | 측정한 바이트 / 1048576 | 측정한 바이트 / 1048576 |
| 작업에서 새로 시작하는 엔진 수 | 관찰한 횟수 | 관찰한 횟수 |
| 관찰된 안정 구간의 동시 엔진 수 | 관찰한 수 | 관찰한 수 |

- **순차 시작.** 시작 시간의 기여분은 시작 한 번당 측정한 초에 관찰한 시작 횟수를 곱한 값입니다.
- **안정적인 동시 실행 구간.** 엔진 메모리의 기여분은 측정한 MiB에 관찰한 동시 엔진 수를 곱한 값입니다.

이 기여분은 의존성 설치, 빌드, SDK 설정, 테스트 실행과 따로 보고하십시오. 이것으로 작업 전체의 CI 절감을 입증할 수는 없으며, 그렇게 주장하려면 작업 전체를 측정하십시오.

## 기여자용: 변경 비교하기

이 절은 Fireemu 자체를 변경하는 사람을 위한 것입니다. Linux 러너는 호출자가 제공하는 기준 Fireemu 바이너리도 받습니다. 두 바이너리는 같은 호환성 프로필, 픽스처 형태, 서비스 선택, SDK 설치를 사용합니다. 쌍을 이룬 각 시행은 새 프로세스를 시작합니다. 매니페스트에는 바이너리의 절대 경로, SHA-256 다이제스트, 버전, 하네스 해시가 기록됩니다. 실행 중 바이너리가 바뀌거나, 결과가 유효하지 않거나, 정리에 실패하면 비교는 무효가 됩니다.

```sh
python3 tools/bench/bench.py --fireemu /path/to/candidate/fireemu --baseline-fireemu /path/to/baseline/fireemu --sdk-root conformance --tier standard --profile emulator --out .bench-candidate
python3 tools/bench/report.py .bench-candidate
```

기본값은 계속 리포트 스키마 버전 2의 공식 에뮬레이터 대 Fireemu 비교입니다. 바이너리 비교는 스키마 버전 3, 명시적인 `baseline-fireemu`/`candidate-fireemu` 레이블, `baseline_*`/`candidate_*` 측정 필드를 사용합니다. 성능을 주장하려면 새 프로세스로 측정한 쌍을 최소 다섯 개 사용하십시오. 동일한 바이너리끼리의 비교는 유용한 대조군이며, 1을 포함하는 구간이 개선을 입증하지는 않습니다.

### 픽스처 형태

`--fixture-shape tiny`는 스칼라 문서를, `--fixture-shape wide-map`은 중첩된 맵 필드 32개를 선택합니다. 기본 픽스처는 기존 페이로드를 유지합니다. 쿼리 오라클 필드와 SDK 전체 읽기 검증은 모든 형태에 적용됩니다. 형태마다 따로 비교하십시오.

### 혼합 서비스

`--mixed-services`는 격리된 단계와 겹치는 단계 모두에서 Auth, Storage, Firestore를 로드합니다. 클래스마다 검증된 작업 8개를 동시성 2, 고정된 시드로 수행하며, 64 KiB Storage 업로드/읽기/삭제 작업과 실제 Auth 구성, Hub 레지스트리, Firestore 읽기 프로브를 포함합니다. 리포트에는 클래스별 지연 시간과 처리량 분포가 따로 유지됩니다.

- 혼합 시행에는 Storage와 다른 서비스 사이에 겹침이 관찰되어야 합니다. 이는 클라이언트 경계에서의 겹침을 입증할 뿐, 서버 내부에서의 동시 실행을 입증하지는 않습니다.
- Storage 작업 지연 시간에는 업로드, 읽기, 삭제가 포함되며, 대기열 시간, 실행 시간, 잠금 대기를 분리할 수 없습니다.
- 기존의 핸들러 16개/Glob 슬롯 2개 한도가 측정 기준선으로 유지됩니다.
- 취소 시 허가(permit) 복구는 런타임 테스트가 필요하며, RSS/PSS는 로드된 엔진 전체에 해당합니다.
- 공식 비교에서는 `pnpm -C conformance exec firebase setup:emulators:storage`로 고정된 Storage 에뮬레이터를 미리 다운로드하십시오.
- 시작 준비 상태 확인은 로드된 각 서비스도 검증합니다.
- Functions 러너는 참여하지 않습니다.
