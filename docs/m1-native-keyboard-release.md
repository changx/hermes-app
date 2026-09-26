# 原生键盘开发版发布记录

Jamie 在本轮明确要求“改完直接上”。已发布已完成并经过主控检查的候选 `ef42eb5` 到既有 `exps://agent.tuly.space`，不等待整套真机手感验收。

## 实际结果

- 主控独立执行57项手机测试、TypeScript、iOS/Android导出通过；发布目录安装锁定依赖后再次TypeScript通过。
- Expo57匹配依赖：keyboard-controller 1.21.9、Reanimated 4.5.1、Worklets 0.10.1。
- 仅Expo重启；开发Gateway与Jamie主实例的PID/启动时间、插件文件哈希均保持不变。
- 双平台公网manifest与实际bundle下载通过，Expo账号验证通过，确认包内包含原生键盘与精确底部滚动实现。
- 发布证据及旧版本/服务指纹：私有 `workspace/hermes-app/m1-native-keyboard-verification/` 下 `release-verification.json`、`before.json`、`release.py`。

## 未解决项

- 本次只发布原生键盘/滚动候选，不代表iPhone手感已通过；输入栏高度与列表底部几何的后续复核仍在隔离分支进行。
- 等待网络/补齐中循环正在独立诊断，未将本次键盘发布当作网络问题修复。
- reaction半成品仍独立保留，未混入本次上线。
- 尝试将新的开发发布约定写入根AGENTS.md，受保护文件审批超时，实际未写入，未重试或绕过。
- 活动开发目录及两项仍在执行的修复工作树保留，不清理未完成工作。
