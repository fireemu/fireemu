---
title: 导出和导入数据
description: 保存模拟器数据，在启动时加载，并在多次运行之间保留。
---

将正在运行的模拟器的数据导出到目录，在启动时导入，并在运行结束时写回。

## 从正在运行的模拟器导出

在 `fireemu up` 运行期间，在另一个终端中运行：

```sh
npx fireemu emulators:export ./emulator-data
```

`--force` 会覆盖非空的目标目录。

## 启动时导入并在退出时导出

`--import <dir>` 在启动时加载导出数据。不带目录的 `--export-on-exit` 会在运行结束时将状态写回同一目录：

```sh
npx fireemu exec --import ./emulator-data --export-on-exit -- npm test
```

`--import` 接受的内容：

- 空的 `--import` 目录会以无数据状态启动，因此首次运行不需要单独的命令。
- 不存在的目录会被拒绝，这样拼错的路径不会启动一个空的测试套件，除非它同时也是 `--export-on-exit` 写入的位置。
- 包含文件但没有 `firebase-export-metadata.json` 的目录会被拒绝。
- Realtime Database 导入会在任何产品载入数据之前进行验证。在 `strict` 下，导入的 JSON 字符串值中的孤立代理项会被拒绝；`emulator` profile 会像官方模拟器一样将其替换为 `?`。无效的键在两种 profile 下都会被拒绝。参见 [Realtime Database 导入](../../products/realtime-database/#export-import-and-snapshots)。

`--export-on-exit` 的行为：

- 失败的 `--export-on-exit` 会以 `error:` 行打印，并且当命令成功时运行以 1 退出。官方 CLI 只发出警告并以 0 退出；Fireemu 的不同之处在于，依赖已保存数据的 CI 作业不会在没有这些数据的情况下通过。
- 导出目录可以是卷挂载点，例如挂载在 `/data` 的容器卷。挂载点无法通过原子重命名替换，因此导出会先在其内部暂存再移动到位，旧的 `firebase-export-metadata.json` 最先移走，新的最后放入。这种替换不是原子的：中断的导出会留下一个没有清单的目录，`--import` 会拒绝它，而不是只加载其中一部分。
- 其他任何目录仍以原子方式替换。

## 导出到哪里

在开始持久运行之前，检查目标位置，而不创建目录或更改权限：

```sh
npx fireemu doctor --export-dir "$HOME/.local/share/fireemu/emulator-data"
```

在类 Unix 系统上，会检查目标目录及其每个已存在的上级目录（包括主目录）的所有权和权限。每个目录都必须归您或 root 所有，并且其他用户不可写入。例外是设置了粘滞位的 root 所有目录，例如 `/tmp`（在 macOS 上，`/tmp` 是指向 `/private/tmp` 的 root 所有链接，会被跟随）。

- **共享目录。** 在粘滞目录中，其他用户可以创建条目，但不能重命名或删除您的条目，因此 `--export-on-exit /tmp/emulator-data` 可以使用。另一个用户仍可能抢先占用该名称，从而导致导出被拒绝，因此在共享机器上，使用您自己的专用目录更可靠。在 `/tmp` 下，已存在的导出目录必须归您所有且其他用户不可写入（`chmod 700`）。
- **拒绝。** 没有粘滞位且其他用户可写入的目录，或其他用户的目录。
- **符号链接。** 导出路径上的每个符号链接都会被检查。只有当它归 root 所有，或者归您所有且位于只有您（或 root）可写入的目录中时，才会被跟随，因此其他用户在 `/tmp` 中创建的链接永远不会被跟随。紧跟在符号链接之后的 `..` 会被拒绝。包含链接的目录必须通过与上级目录相同的检查（强制所有权的卷，且没有针对其他用户的 ACL 条目）。
- **何时执行检查。** `--export-on-exit` 在守护进程或子命令启动前进行检查，并在导出时再次验证，因为权限可能会改变。它从预检到运行结束一直保持导出目录的父目录处于打开状态，因此期间路径上被重命名或链接的内容都不会被跟随。
- **卷挂载。** 卷挂载的目标位置需要可写入，即使其父目录不需要。
- **组可写文件。** 配置发现允许组可写文件以支持私有组设置，但导出发布保留其更严格的清理安全规则。

### macOS

- **ACL。** 如果上级目录的 ACL 中有针对所有者、root 或运行导出的用户以外任何人的 `allow` 条目，无论该条目显示什么权限，该目录都会被拒绝（内核会授予 `ls -le` 未列出的权限）。`deny` 条目会被接受，因此标准的主目录（带有 `group:everyone deny delete`）及其下的文件夹可以使用。
- **修复 ACL 拒绝。** 当导出因 ACL 被拒绝时，消息会指出该条目；请删除它（`chmod -a`）或导出到其他目录，例如 `$TMPDIR` 下的目录。使用 `/bin/ls -led <directory>` 检查上级目录。
- **忽略所有权的卷。** 位于忽略所有权的卷（exFAT 和 FAT 的 U 盘和存储卡，或开启了“忽略此宗卷上的所有权”的外置 APFS 卷）上的目标位置会被拒绝，因为其目录的所有者和模式无法表明谁可以更改它们；请导出到强制所有权的卷。
- **不支持原子重命名的卷。** 不支持原子目录重命名的卷（exFAT、FAT、某些网络文件系统）也无法发布导出：请使用 APFS 卷上的目录。

### Windows

`emulators:export` 和 `--export-on-exit` 目前不可用。导入和模拟器的其余部分可以使用。

## 导出相互独立的测试世界

在 [测试世界](../test-worlds/) 中，`hub: true` 会为该世界现有的 CLI 导出命令启用一个私有 Hub。请使用位于 `world.directory` 之外、由调用方拥有的绝对导出路径：

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

- 显式传入 `--project`。
- 辅助工具拥有 Hub 由操作系统分配的端口和私有定位器；同一项目的多个世界保持相互独立。
- 对于开发版二进制文件，请在 `binaryPath` 和导出命令中都使用其绝对路径。
- 导入在创建时生成快照，因此之后对原始导出的编辑不会影响重置。
- 位于世界目录之外的导出在释放后仍归调用方所有。

参见 [完整的导出和导入指南](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#export-and-import-test-data)。

## 导出会保留什么

| 保留 | 不保留 |
| --- | --- |
| Auth 用户和密码凭据 | App Check 状态 |
| Firestore 文档 | 虚拟时钟 |
| Storage 字节和元数据 | Functions 进程内存 |
| Realtime Database 数据 | 先前签发的令牌的有效性 |

## 相关内容

- [测试世界](../test-worlds/)
- [CLI 参考](../../reference/cli/)
- [Realtime Database](../../products/realtime-database/#export-import-and-snapshots)
- [故障排除](../troubleshooting/)
