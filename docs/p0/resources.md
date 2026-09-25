# P0 产物与资源保留

P0 收尾后，已完成的 Hermes App 工作树（包括早期客户端打包 staging）均已通过 `git worktree remove` 清理并 prune；原始提交/分支仍保留。主仓库 `/opt/projects/jamie/hermes-app` 为当前文档与探针源码入口。固定 Hermes 只读基线保留以复现测试，其 `.venv` 指向既有开发依赖，未安装或修改该环境。

## 保留产物

- Expo Android 诊断 JS：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/artifacts/final-expo-android-js/`。从主控实际导出复制，文件内容哈希逐项一致；不是 APK 或设备运行证据。
- Linux 合成诊断 `.deb`：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/clients/hermes-p0-synthetic-probe_0.0.1_amd64.deb`。主控核对 88,075,022 字节，SHA-256 `02e8ae6e1f82e39a6a937bec84f218827cdb8db1e33511cc3b8a78710ccb91e4`，与早期主控证据一致。不是正式 App。
- Expo scoped 依赖：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/p0/close-mobile/`，收尾检查约 296 MB；旧桌面/Capacitor 依赖与产物目录 `.../p0/clients/` 约 421 MB。为复现保留，不提交 node_modules、dist 或真实凭据。
- 核心基线：`/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline`，提交 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。

## 验证与限制

主控 `probes/p0/close-verification/results.json` 记录隔离临时 HOME 清理；每个本机 summarizer server 在 finally 中 shutdown/join，受限子进程终止。没有持久运行的本项目测试服务，没有活动 profile 安装、生产重启、远端推送或公开发布。

原始日志作为证据保留，可能含行尾空白；代码/文档的 `git diff --check` 单独校验，不为了 lint 擦写原始诊断输出。旧负例和失败从 Git 历史可追溯；不能将主控诊断脚本退出 0 解读为压缩产品验收通过。
