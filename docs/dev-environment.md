# 开发环境

## 当前状态补充

2026-09-26 工具过程版 `6a2eff6` 已发布：公开说明与工具记录按原始顺序展示，安全命令显示为等宽块。仅更新隔离 hermes-app-dev 插件/Gateway 和 Expo；Jamie 主实例 PID/启动时间与固定核心保持不变。主控复验 P1 60 项、手机 125 项、客户端检查、TypeScript、双平台导出通过；公网 capability `tool_call_timeline=true` 与两个平台实际 bundle 已核验。真实开发模型调用终端的验收中，工具记录在收据完成前可读，随后最终回复可读，引用不重复；验收话题已归档。记录及限制见 [工具调用与中间说明](m1-tool-timeline.md)，私有发布、联调证据和回滚在 `workspace/hermes-app/m1-tool-timeline/`。iPhone 实际呈现待确认，下方旧“最新”条目均为历史记录。

最新手机开发版 `dc5a20e`：消息下 Agent 状态 reaction、发送正文浅灰到实色、移除常驻发送汇总和技术性界面信息；只更新 Expo，Gateway/插件未变化。87 项手机测试、TypeScript、双平台导出及公网两平台资源检查通过，iPhone 视觉待验收。见 [Agent reaction 与发布证据](m1-agent-reactions.md)。下方旧发布记录按历史保留。

最新手机修正 `ff41a76`：前后台键盘布局、滑动收键盘与消息滚动联动，已仅更新Expo；两个Gateway和插件未变化。双平台公网包及账号检查通过，真机待验收见 [键盘修正](m1-keyboard-layout.md)。下述可靠性插件部署保持不变。

2026-09-26 可靠性版已根据 Jamie“再写 AGENTS.md，更新手机 app”授权发布，运行代码 `bd0ca43`（含候选 `1389b8c`）。插件归档 SHA-256：`dad18bde21f273413926f151ab45ee858a07fa3bcc1a5e20815a65d9a396f17e`。只重启隔离开发 Gateway 与 Expo；公网 HTTP/WS、配对管理路由、历史及 iOS/Android 新 bundle 均通过，Expo 账号 `jamsben`。Jamie 主实例 PID/启动时间不变。入口仍为 `exps://agent.tuly.space`，手机重开项目加载新版。回滚与本轮证据在私有 `workspace/hermes-app/m1-reliability-verification/`；详见 [可靠性验证](m1-reliability-verification.md)。iPhone 故障矩阵仍未验收，不能据发布成功关闭首版总卡。

### 上一版 M1 发布（历史）

M1 已获授权部署，当前开发插件归档 SHA-256 为 `1c726ac8177ee7eadb1ff33e56e91026ef0cbfbcfeeed787be20bc5280b36a40`。Expo 开发入口已更新，账号 `jamsben`、SDK 57；开发 Gateway 与 Expo 服务已重启并通过公网接口及 iOS bundle 检查，Jamie 主实例未重启。发布验收与真机待验收项见 [M1 验证](m1-verification.md)，回滚和证据保留于私有 `workspace/hermes-app/m1-verification/`。AGENTS.md 已成功更新；下方初次搭建中的旧状态仅作历史记录。

后续已正确持久化独立开发 Codex OAuth，并通过真实 openai-codex / gpt-6-luna 消息联调；Jamie 已在 iPhone 确认基本通讯正常。下面早期的 No Codex credentials stored 是历史阻塞，现已解除。开发部署重启持久化及 SQLite 运行时风险仍待验收，原卡 t_42490468 依赖 t_c0dc25f5，见 [P2/P3 Kanban](p2-p3-kanban.md)。

## 初次开发状态（历史记录）

已创建 `hermes-app-dev` profile，配置内置 `openai-codex / gpt-6-luna`，安装 P1 验收插件，并建立 `https://agent.tuly.space` 的 DNS / HTTPS / Traefik 路由。

**插件已经运行，模型联调尚未通过**：开发实例已于 2026-09-26 01:01:30 PDT 重启，PID 3674837。本机与公网认证 capabilities 均 200；未认证 HTTP/WS 为 401，两个认证 WS 接收到同一持久事件，相同 client_message_id 返回同一收据。真实消息尝试返回 unknown；日志明确报 No Codex credentials stored，检查开发 auth.json 的 providers 和 credential_pool 为空。先前 CLI 登录成功通知并不足以证明当前凭据可用，正在重新登录并核对实际存储；不能声明真实模型接通。合成测试频道/话题保留供移动端查看，证据在私有 workspace/dev/mobile-api-smoke.*。Expo 移动开发本轮见 [P2 首版](p2-mobile-dev.md)。

跟踪卡：`default / t_42490468`，验收未完成，不关闭。

## 实际配置

- Profile：`/home/hermes/.hermes/profiles/hermes-app-dev`。
- 核心：`/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline`，提交 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。此工作树为活动服务依赖，不能作为临时工作树清理。
- Provider / model：`openai-codex / gpt-6-luna`，未配置其他 provider fallback。
- OAuth：独立登录，不复制 Jamie 或 Codex CLI 的旋转 refresh token。未授权前不能声称模型可用。
- 插件目录：`/home/hermes/.hermes/profiles/hermes-app-dev/plugins/hermes-app`。
- 安装归档 SHA-256：`62c51298537eeb47647e9963a04309b4eccbaebcffe13c008b93b660313377e1`，安装前已验证，与 P1 验收包一致。
- 归档、DNS 回读证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/dev/`，长期保留供恢复。
- API 实际监听：`127.0.0.1:9790`。
- 私有 socket bridge：`172.31.0.1:9790` → `127.0.0.1:9790`。
- 域名：Cloudflare A → `147.135.37.153`，`proxied=true`，TTL auto。DNS record ID：`728fe6b2b695e0b02c3dec3a9e0a0f84`，写入后已 API 回读验证。
- Traefik 热加载文件：`/opt/projects/jamie/ovh01-ingress/dynamic/hermes-app-dev.yaml`。复用既有 TLS 入口，不重启 Traefik。
- HTTP：`https://agent.tuly.space/v1/...`；WS：`wss://agent.tuly.space/v1/events`。
- 所有 HTTP/WS 均要求 `Authorization: Bearer <HERMES_APP_TOKEN>`；凭据位于开发 profile `.env`，权限 0600，profile 根目录 0700。不得提交或放进 URL、聊天及日志。
- `/v1` 为 API 后端；根路径现供 Expo Go 获取开发包，手机界面见 `apps/mobile`。普通浏览器原生 WebSocket 不支持该认证请求头，不能替代 React Native transport。

## 服务管理

systemd 用户服务位于 `/home/hermes/.config/systemd/user/`：

- `hermes-gateway-hermes-app-dev.service`：开发 Gateway，已 enable / active；当前进程已加载插件。
- `hermes-gateway-hermes-app-dev.service.d/development.conf`：固定工作目录、profile 环境、私有 `.env`、TMPDIR 和 umask。Hermes CLI 会自动刷新主 unit，故自定义项保存在 drop-in。
- `hermes-app-dev-bridge.socket`：私有网桥 listener，已 enable / active。
- `hermes-app-dev-bridge.service`：systemd-socket-proxyd 按需启动。

在服务器独立终端执行，**仅操作新开发 profile**：

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-gateway-hermes-app-dev.service
systemctl --user status hermes-gateway-hermes-app-dev.service --no-pager
journalctl --user -u hermes-gateway-hermes-app-dev.service -n 60 --no-pager
```

Codex 登录若本次等待过期，重新发起：

```bash
hermes -p hermes-app-dev auth add openai-codex --type oauth --no-browser --label hermes-app-dev --timeout 600
```

当前版本已移除 `hermes login`，不能再使用旧命令。按终端提示到 OpenAI 官方页面确认，不在聊天发送密码或验证码。成功后再重启该开发实例以清除未登录时的缓存状态。

## 初次搭建记录（历史；当前状态以上方为准）

已验证：

- 新 profile 已创建，插件归档哈希正确，凭据生成在私有文件中。
- systemd unit / socket 定义检查通过；服务及 socket 已 enable。
- Cloudflare 精确 DNS record 回读一致，公网 TLS 校验通过。
- Jamie gateway 保持 PID `3214859`、启动时间 `2026-09-25 07:42:21 PDT`，未重启。
- 固定核心工作树无源码修改。项目文档 `git diff --check` 通过。

待验证：

1. 重启开发 Gateway 后 loopback listener 和插件加载成功。
2. 本机及公网 capabilities / snapshot 正常；未认证、错误认证 HTTP 和 WS 拒绝。
3. 两个认证 WS 客户端接到同一持久事件，断线后 HTTP 增量可追齐。
4. 实际 Codex 消息完成，收据及原始历史一致；无替身、无其他 provider 冒充。
5. 重启后频道、话题、消息和 cursor 恢复；重复 client_message_id 不重复执行。

开发运行数据属于新 profile，自有日志和附件不复制到其他 profile。profile 隔离不等于 OS 沙箱：该服务仍以 hermes 用户运行，只给受信任 owner 使用，不开放注册或多租户。

本次没有修改 Jamie 配置、真实聊天数据、其他 profile，未发布正式 App。根目录 AGENTS.md 的授权说明更新被受保护文件审批拦截，保留原文件；本页和 README 记录本次新授权与实际状态。
