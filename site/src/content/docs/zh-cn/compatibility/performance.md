---
title: 性能
description: 查看与官方 Firestore 模拟器对比实测的启动时间、内存和吞吐量，并将其应用到您自己的测试套件。
---

Fireemu 使用相同的 SDK 工作负载与官方 Firestore 模拟器进行比较。两者在同一台 GitHub Actions Linux 运行器上依次运行，Fireemu 使用 `emulator` profile。基准测试还会检查每个操作的结果。

## 结果

这些结果来自提交 `f3b942c` 上的一次 `standard` 运行，对照的是 `firebase-tools` 15.28.2 运行的 Firestore 模拟器，使用 JDK 21.0.8。比率根据五组实测配对计算；绝对值取决于环境。

| 指标 | 官方模拟器 | Fireemu | 比较 |
|---|---:|---:|---:|
| 启动至 SDK 可以使用 Firestore | 3,043 ms | 140 ms | 快 21.6 倍 |
| 空数据库时的空闲内存（PSS） | 390 MiB | 11 MiB | 内存约为 1/34 |
| 试验期间的峰值内存（cgroup） | 849 MiB | 79 MiB | 内存约为 1/10.7 |
| 22 个工作负载的 Firestore 吞吐量 | — | — | 高 1.1 倍至 5.2 倍 |

启动时间比率的 95% 置信区间为 [21.4, 21.8]。峰值内存比率（官方模拟器除以 Fireemu）的置信区间为 [10.2, 11.1]。

工作流参见 [benchmark.yml](https://github.com/fireemu/fireemu/blob/main/.github/workflows/benchmark.yml)，基准测试参见 [`tools/bench/`](https://github.com/fireemu/fireemu/tree/main/tools/bench)。

## 将结果应用到测试套件

使用实测的启动时间和加载后内存值，只估算您自己工作流中启动这些引擎的那部分。根据一次经过验证的运行和您自己的进程数填写此模板：

| 数量 | 基线 | 候选 |
|---|---:|---:|
| SDK 可用的启动时间，秒 | 实测毫秒 / 1000 | 实测毫秒 / 1000 |
| 加载后的空闲 PSS，每个引擎 MiB | 实测字节 / 1048576 | 实测字节 / 1048576 |
| 作业中全新引擎的启动次数 | 观测次数 | 观测次数 |
| 观测平台期的并发引擎数 | 观测数量 | 观测数量 |

- **顺序启动。** 启动时间的贡献为每次启动的实测秒数乘以观测到的启动次数。
- **稳定的并发平台期。** 引擎内存的贡献为实测 MiB 乘以观测到的并发引擎数。

请将这些贡献与依赖安装、构建、SDK 设置和测试执行分开报告。它们并不能证明整个 CI 作业的节省；要做出这一声明，请测量完整的作业。

## 面向贡献者：比较一项更改

本节面向修改 Fireemu 本身的人员。Linux 运行器还接受调用方提供的基线 Fireemu 二进制文件。两个二进制文件使用相同的兼容性 profile、夹具形态、服务选择和 SDK 安装。每次配对试验都会启动一个全新的进程。清单记录二进制文件的绝对路径、SHA-256 摘要、版本和测试工具哈希。运行期间二进制文件发生变化、结果无效或清理未成功都会使比较失效。

```sh
python3 tools/bench/bench.py --fireemu /path/to/candidate/fireemu --baseline-fireemu /path/to/baseline/fireemu --sdk-root conformance --tier standard --profile emulator --out .bench-candidate
python3 tools/bench/report.py .bench-candidate
```

默认仍是官方模拟器对 Fireemu，报告架构版本为 2。二进制文件比较使用架构版本 3、显式的 `baseline-fireemu`/`candidate-fireemu` 标签以及 `baseline_*`/`candidate_*` 测量字段。要做出性能声明，请至少使用五组实测的全新进程配对。相同二进制文件的比较是有用的对照；包含 1 的区间并不能证明有所改进。

### 夹具形态

`--fixture-shape tiny` 选择标量文档；`--fixture-shape wide-map` 选择 32 个嵌套的 map 字段。默认夹具保留其现有负载。查询 oracle 字段和完整的 SDK 回读验证适用于每种形态。请分别比较每种形态。

### 混合服务

`--mixed-services` 在隔离阶段和重叠阶段都加载 Auth、Storage 和 Firestore。它以并发数 2、固定种子执行每类 8 个经过验证的操作，包括一个 64 KiB 的 Storage 上传/回读/删除操作，以及实际的 Auth 配置、Hub 注册表和 Firestore 读取探测。报告保留各类别独立的延迟和吞吐量分布。

- 混合试验要求观测到 Storage 与另一个服务之间的重叠。这证明的是客户端边界上的重叠，而不是服务器内部的同时执行。
- Storage 操作延迟包括上传、回读和删除；无法区分排队时间、执行时间或锁等待。
- 现有的 16 个处理程序/2 个 Glob 槽位限制仍是测量基线。
- 取消许可的恢复需要运行时测试，RSS/PSS 属于完整的已加载引擎。
- 进行官方比较时，请使用 `pnpm -C conformance exec firebase setup:emulators:storage` 预先下载固定版本的 Storage 模拟器。
- 启动就绪检查还会验证每个已加载的服务。
- 没有 Functions 运行器参与。
