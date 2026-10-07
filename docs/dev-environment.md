# 开发环境

## 当前运行状态（2026-10-06 只读核实）

本节以实际服务和文件为准，替代下方各条发布记录中的“待激活”“待重启”结论。下方条目均为历史记录。

- 开发 Gateway：`hermes-gateway-hermes-app-dev.service`，PID `3461455`，启动于 2026-10-05 20:43:35 PDT。
- App 插件：已安装文件与独立插件仓库 main `6abdaa4`（v0.2.5）逐文件哈希一致。安装时间 2026-10-04 17:31 PDT，早于本次 Gateway 启动，所以 v0.2.5 已在运行。
- 运行中的 capabilities 包括 `open_session_live`、`shared_result_read`、`session_labels`、`title_alphabet`、`channel_workspace`、`channel_files`、`channel_agents`、`outbound_media`、`permanent_media_links`、`history_full`。历史响应包含 `receipts`。因此下列记录中的“后端待激活”均已过时：[历史执行状态](history-execution-state-release.md)、[完成未读](completed-unread-release.md)、[Session labels](session-labels.md)、[外发媒体](outbound-media-deployment.md)、[仓库 AGENTS 绑定](channel-repository-agents.md)、[OPEN-SESSION-LIVE](open-session-live.md)。
- 旧接口 `/v1/events`、`/v1/sync`、`/v1/snapshot` 已删除，本机请求返回 404。当前实时连接只有 `/v1/live`。
- LCM 插件：运行 `hermes-lcm` 分支 `jamie/app-dev-threshold-only`，提交 `17ac4ea`（v1.0.0-rc.1 之后两个提交）。它替代了 [LCM 修复记录](dev-lcm-fix.md) 中的 `19845a7`。
- 主模型：`anthropic / claude-opus-5-5`。辅助任务（压缩、提取等）使用 `openai-codex / gpt-6.1-sol`，标题生成使用 `openai-codex / gpt-6-luna`。下方 `gpt-6-luna` 主模型的说法是历史配置。
- 插件源码不在本仓库。插件、打包脚本 `scripts/pack-plugin.sh` 和 `tests/p1` 在 `/opt/projects/jamie/hermes-app-plugin`（远端 `changx/hermes-app-plugin`）。
- Expo：`hermes-app-expo.service` 在 `/opt/projects/jamie/hermes-app/apps/mobile` 运行，只监听 `localhost:8081`。

插件部署顺序：在插件仓库打包 → 校验 artifact → 备份旧插件目录 → 停止开发 Gateway → 原子替换 `plugins/hermes-app` → 回读哈希 → 启动 Gateway → 验证认证 capabilities、`/v1/live`、历史冷读、同 ID 幂等和一条真实模型消息。开发 Gateway 是 App 会话的父进程，必须在独立终端停止和启动它。

## 当前状态补充（历史）

LCM 修复曾以提交 `19845a7` 安装并等待激活；当前运行版本见上节。相关隔离回归 1235 项通过，现有历史指纹不变；没有升级固定核心或重启 Jamie/Expo。配置、证据、恢复见 [开发实例 LCM 修复](dev-lcm-fix.md)。

2026-09-28 已为隔离 `hermes-app-dev` profile 接入现有 Mac mini MCP。配置只引用开发 profile 私有环境变量，不在仓库、聊天或验证结果中保存凭据。`hermes -p hermes-app-dev mcp test macmini` 实际连接成功并发现 21 个工具；随后经 `https://agent.tuly.space` 新建自动验收 Thread，真实模型完成一次只读 `mcp__macmini__calendar_list_calendars` 调用，收据为 `completed`、结果无错误，Thread 已归档。运行中的开发 Gateway 会为新会话动态发现该 MCP，因此无需重启；开发 Gateway 与 Jamie 主 Gateway 的 PID/启动时间均保持不变。回滚备份与脱敏证据保存在私有 `workspace/hermes-app/macmini-mcp-test/`。

系统通知开发版 `edc541e` 已发布：Hermes 记忆/Skill 自检与 context compression 状态通过独立 `system_notice` 持久显示在对应 Thread，不写 SessionDB、不冒充 Agent 回复。插件完整 artifact 与两平台 Expo bundle 均已更新；真实 Gateway 延迟回调、压缩原位更新、公网冷读/同步事件、精确 ref/搜索和模型历史隔离通过。只重启开发 Gateway 与 Expo，Jamie 主实例、固定 Core 和 dev 配置不变；iPhone 视觉待验收。详情见[系统通知开发版发布记录](system-notices-release.md)。下方均为历史发布记录。

最新开发版 `e25d812` 已发布：命令消息位置与收据执行状态解耦，已有 `ref_seq` 透传/持久化及有证据的本地副本清理。仅更新开发插件/Gateway 和 Expo，未改写旧 unknown；公网 API/WS、iOS/Android 实际资源及新命令完成/同 ID 重试/历史冷读通过。Jamie 主实例、固定核心和开发配置不变。入口 `exps://agent.tuly.space`，iPhone 视觉待验收；详情见 [命令状态与顺序修复](command-state-order.md)。下方均为历史发布记录。

当前开发版代码 `09d08fc` 已联合发布：运行中保留发送并走 Discord 同型原生插入路径，逐条输入历史、全屏文章系统选区、多行输入框清空复位。主控 P1 135 项、移动 199 项、SDK 41 项及双平台导出通过；公网真实执行中两条补充均被下一模型轮次消费，历史无重复，验收话题已归档。仅更新开发 Gateway/Expo，Jamie 主实例及固定核心未变。iPhone 手势和系统菜单由 Jamie 继续测试，见 [本轮发布记录](m1-midrun-release.md)。下方均为历史记录。

最新联合开发版 `f7846e0` 已发布：多附件与预览、系统粘贴入口、全屏系统文字选择、typing 三点动画及发送队列恢复。开发插件与 Expo 同步更新；Jamie 主实例及固定核心不变。移动 164 项、SDK 41 项、P1 122 项、双平台导出和公网实际资源通过；真实纯附件消息 completed、幂等和历史附件顺序通过。输入框长按直接粘贴图片及 iPhone 手感仍未验收；见 [联合发布记录](m1-combined-release.md)。下面均为历史发布记录。

搜索过程修正 `bd9a6bb` 已发布：开发 profile 显式使用 Exa 匿名普通搜索/提取（保留内置免费后端回退），避免自动选择服务端内置搜索后无法生成普通调用记录。开发 SOUL.md 补充真实查证与简短公开进展要求；插件读取明确的公开 commentary，不暴露内部思考。真实公网验证说明→搜索/阅读→最终答案、执行中可见和重读一致；只更新开发插件并重启开发 Gateway，Expo 与 Jamie 主实例不动。详情及回滚见 [工具调用与中间说明](m1-tool-timeline.md)。

2026-09-26 工具过程版 `6a2eff6` 已发布：公开说明与工具记录按原始顺序展示，安全命令显示为等宽块。仅更新隔离 hermes-app-dev 插件/Gateway 和 Expo；Jamie 主实例 PID/启动时间与固定核心保持不变。主控复验 P1 60 项、手机 125 项、客户端检查、TypeScript、双平台导出通过；公网 capability `tool_call_timeline=true` 与两个平台实际 bundle 已核验。真实开发模型调用终端的验收中，工具记录在收据完成前可读，随后最终回复可读，引用不重复；验收话题已归档。记录及限制见 [工具调用与中间说明](m1-tool-timeline.md)，私有发布、联调证据和回滚在 `workspace/hermes-app/m1-tool-timeline/`。iPhone 实际呈现待确认，下方旧“最新”条目均为历史记录。

最新手机开发版 `dc5a20e`：消息下 Agent 状态 reaction、发送正文浅灰到实色、移除常驻发送汇总和技术性界面信息；只更新 Expo，Gateway/插件未变化。87 项手机测试、TypeScript、双平台导出及公网两平台资源检查通过，iPhone 视觉待验收。见 [Agent reaction 与发布证据](m1-agent-reactions.md)。下方旧发布记录按历史保留。

最新手机修正 `ff41a76`：前后台键盘布局、滑动收键盘与消息滚动联动，已仅更新Expo；两个Gateway和插件未变化。双平台公网包及账号检查通过，真机待验收见 [键盘修正](m1-keyboard-layout.md)。下述可靠性插件部署保持不变。

2026-09-26 可靠性版已根据 Jamie“再写 AGENTS.md，更新手机 app”授权发布，运行代码 `bd0ca43`（含候选 `1389b8c`）。插件归档 SHA-256：`dad18bde21f273413926f151ab45ee858a07fa3bcc1a5e20815a65d9a396f17e`。只重启隔离开发 Gateway 与 Expo；公网 HTTP/WS、配对管理路由、历史及 iOS/Android 新 bundle 均通过，Expo 账号 `jamsben`。Jamie 主实例 PID/启动时间不变。入口仍为 `exps://agent.tuly.space`，手机重开项目加载新版。回滚与本轮证据在私有 `workspace/hermes-app/m1-reliability-verification/`；详见 [可靠性验证](m1-reliability-verification.md)。iPhone 故障矩阵仍未验收，不能据发布成功称首版完成。

### 上一版 M1 发布（历史）

M1 已获授权部署，当前开发插件归档 SHA-256 为 `1c726ac8177ee7eadb1ff33e56e91026ef0cbfbcfeeed787be20bc5280b36a40`。Expo 开发入口已更新，账号 `jamsben`、SDK 57；开发 Gateway 与 Expo 服务已重启并通过公网接口及 iOS bundle 检查，Jamie 主实例未重启。发布验收与真机待验收项见 [M1 验证](m1-verification.md)，回滚和证据保留于私有 `workspace/hermes-app/m1-verification/`。AGENTS.md 已成功更新；下方初次搭建中的旧状态仅作历史记录。

后续已正确持久化独立开发 Codex OAuth，并通过真实 openai-codex / gpt-6-luna 消息联调；Jamie 已在 iPhone 确认基本通讯正常。下面早期的 No Codex credentials stored 是历史阻塞，现已解除。开发部署重启持久化及 SQLite 运行时风险仍待验收。

## 初次开发状态（历史记录）

已创建 `hermes-app-dev` profile，配置内置 `openai-codex / gpt-6-luna`，安装 P1 验收插件，并建立 `https://agent.tuly.space` 的 DNS / HTTPS / Traefik 路由。

**插件已经运行，模型联调尚未通过**：开发实例已于 2026-09-26 01:01:30 PDT 重启，PID 3674837。本机与公网认证 capabilities 均 200；未认证 HTTP/WS 为 401，两个认证 WS 接收到同一持久事件，相同 client_message_id 返回同一收据。真实消息尝试返回 unknown；日志明确报 No Codex credentials stored，检查开发 auth.json 的 providers 和 credential_pool 为空。先前 CLI 登录成功通知并不足以证明当前凭据可用，正在重新登录并核对实际存储；不能声明真实模型接通。合成测试频道/话题保留供移动端查看，证据在私有 workspace/dev/mobile-api-smoke.*。Expo 移动开发本轮见 [P2 首版](p2-mobile-dev.md)。

验收未完成。

## 实际配置

- Profile：`/home/hermes/.hermes/profiles/hermes-app-dev`。
- 核心：`/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline`，提交 `2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。此工作树为活动服务依赖，不能作为临时工作树清理。
- Provider / model：初次搭建为 `openai-codex / gpt-6-luna`。当前主模型为 `anthropic / claude-opus-5-5`，见“当前运行状态”。
- OAuth：独立登录，不复制 Jamie 或 Codex CLI 的旋转 refresh token。未授权前不能声称模型可用。
- 插件目录：`/home/hermes/.hermes/profiles/hermes-app-dev/plugins/hermes-app`。
- 初次安装归档 SHA-256：`62c51298537eeb47647e9963a04309b4eccbaebcffe13c008b93b660313377e1`（P1 验收包，已被后续版本替换）。
- 归档、DNS 回读证据：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/dev/`，长期保留供恢复。
- API 实际监听：`127.0.0.1:9790`。插件代码只允许 loopback 地址（`HERMES_APP_HOST` 为 `127.0.0.1` 或 `::1`）。
- 私有 socket bridge：`172.31.0.1:9790`（Docker 网桥地址）→ `127.0.0.1:9790`，供 Traefik 容器访问。
- 域名：Cloudflare A → `147.135.37.153`，`proxied=true`，TTL auto。DNS record ID：`728fe6b2b695e0b02c3dec3a9e0a0f84`，写入后已 API 回读验证。
- Traefik 热加载文件：`/opt/projects/jamie/ovh01-ingress/dynamic/hermes-app-dev.yaml`。复用既有 TLS 入口，不重启 Traefik。
- HTTP：`https://agent.tuly.space/v1/...`；WS：`wss://agent.tuly.space/v1/live`（旧 `/v1/events` 已删除）。
- 所有 HTTP/WS 均要求 `Authorization: Bearer <HERMES_APP_TOKEN>`；凭据位于开发 profile `.env`，权限 0600，profile 根目录 0700。不得提交或放进 URL、聊天及日志。
- `/v1` 和 `/media/` 为插件 API 后端；Traefik 以更高优先级把 `/`、`/status`、`*.bundle` 和 `/assets/` 交给 Expo（`hermes-app-expo.yaml`），手机界面见 `apps/mobile`。普通浏览器原生 WebSocket 不支持该认证请求头，不能替代 React Native transport。

## 服务管理

systemd 用户服务位于 `/home/hermes/.config/systemd/user/`：

- `hermes-gateway-hermes-app-dev.service`：开发 Gateway，已 enable / active；当前进程已加载插件。
- `hermes-gateway-hermes-app-dev.service.d/development.conf`：固定工作目录、profile 环境、私有 `.env`、TMPDIR 和 umask。Hermes CLI 会自动刷新主 unit，故自定义项保存在 drop-in。
- `hermes-app-dev-bridge.socket`：私有网桥 listener，已 enable / active。
- `hermes-app-dev-bridge.service`：systemd-socket-proxyd 按需启动。

在服务器独立终端执行，**仅操作新开发 profile**。不要在 App 会话中执行，因为开发 Gateway 是 App 会话的父进程，会拒绝自我重启。只有 unit 或 drop-in 改变时才需要 `daemon-reload`：

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
