# macOS 桌面 App Kanban

本板管理 `docs/desktop-macos-v1.md` 的实现。任务按“里程碑 → 功能组 → 可独立验收的小任务”拆分；状态只依据实际证据更新。

## 1. 工作流与完成定义

- **Backlog**：已定义，但前置条件未满足或尚未排期。
- **Ready**：范围、依赖、接口和验收方法明确，可以开工。
- **In progress**：正在修改；同一卡不并行重复实现。
- **Review**：实现及自动检查通过，仍需代码审查或真实设备验收。
- **Done**：该卡全部验收项有证据；真实 Mac/iPhone 项不能用 Linux 检查替代。
- **Deferred**：明确不进入当前 D0–D2 范围，恢复前需重新确认。

每张卡必须满足以下通用完成条件：

1. 只改卡片范围内的代码和文档，不顺带修改 Hermes 核心或手机发布来源。
2. 新行为有自动测试；失败路径与成功路径同等验收。
3. 用户界面使用自然英文，不显示 token、内部 ID、游标、原始异常或诊断路由。
4. 安全相关能力采用窄接口；renderer 不获得 Node、任意 IPC、任意文件或 shell 权限。
5. 自动测试、Mac 真机、Mac/iPhone 双端证据分开记录；未要求的证据标记 `N/A`，不能留空。
6. 卡片状态和本文件“当前看板”同步更新。
7. 证据默认写入 `docs/desktop/evidence/<card-id>/`；截图不得包含真实聊天、token 或私人诊断。

## 2. 执行约束与关键路径

### 2.1 仓库边界

- App 仓库：`changx/hermes-app`，包含 `apps/desktop`、`apps/mobile` 和 `packages/client`。
- Plugin 仓库：`changx/hermes-app-plugin`。桌面端若发现服务端契约缺口，单独在 plugin 仓库落卡；不能把 plugin 源码复制回 App 仓库。
- Hermes 是权威服务端；桌面缓存、outbox 和窗口偏好不是第二套权威聊天数据库。

### 2.2 关键路径

```text
D0-01 → D0-02 → D0-04 → D0-05 → D0-06
   └──→ D0-03 ────────────────┐
D0-01 → D0-07 → D0-08 → D0-09 → D0-10 → D0-11
                               └──────────┘

D0-11 → D1-01/D1-02 → D1-03 → D1-04
D0-11 → D1-05 → D1-06 → D1-07 → D1-08/D1-09
D1-03 → D1-10/D1-11
D1-05 → D1-12 → D1-13
D1-02/D1-03 → D1-14 → D1-15
全部 D1 子卡 → D1-16

D1-16 → D2-01/D2-02/D2-03/D2-04/D2-05/D2-06/D2-07/D2-08 → D2-09
```

### 2.3 并行规则

- D0-02（Electron 安全壳）和 D0-03（renderer 骨架）可在 D0-01 后并行。
- D1 的 Channel/Thread 管理、内容渲染和附件 UI 可并行，但必须共用已冻结的选择器、消息身份与错误模型。
- D2 的性能、通知、窗口恢复和辅助功能可并行；网络恢复与双端竞态应串行使用同一验收环境，避免相互污染。
- 总验收卡等待子卡，不作为子卡的父级前置条件。

## 3. 当前看板

| 状态 | 卡片 |
| --- | --- |
| Done | `DESK-D0-01` 桌面 workspace 与可重复构建基线；`DESK-D0-02` Electron main/preload 安全壳 |
| Review | `DESK-D0-03` React 三栏与响应式骨架（待 Mac 三种宽度截图） |
| Ready | `DESK-D0-04` 安全自动回归 |
| Backlog | `DESK-D0-05` Mac 开发启动；`DESK-D0-06` 未签名 `.app` 打包 |
| Backlog | `DESK-D0-07` HermesClient transport 与 React adapter；`DESK-D0-08` 设备配对；`DESK-D0-09` Keychain；`DESK-D0-10` 只读真实三栏；`DESK-D0-11` D0 总验收 |
| Backlog | `DESK-D1-01` 至 `DESK-D1-16` 完整聊天闭环 |
| Backlog | `DESK-D2-01` 至 `DESK-D2-09` 可靠性与桌面体验 |
| Deferred | `DESK-D3-01` 签名/notarization；`DESK-D3-02` DMG/更新/公开发布 |

当前 `apps/desktop` 只有未验证的 main/preload/build 脚手架；缺少 renderer 文件、依赖安装、测试和真实 Mac 运行证据，因此任何 D0 卡均未完成。

---

## 4. D0：安全桌面壳与真实只读连接

### DESK-D0-01 — 桌面 workspace 与可重复构建基线

- **状态**：Done（Linux 自动检查；本卡不包含 Mac 启动）。
- **目标**：让桌面包能从 App 仓库根目录以锁定依赖独立安装、检查和构建。
- **范围**：根 workspace 策略、`apps/desktop/package.json`、TypeScript 配置、lockfile、根级 `desktop:*` 命令、`packages/client` 本地依赖方式、构建产物忽略规则。
- **决策要求**：固定 Node/npm、Electron、React、TypeScript、esbuild 版本；禁止依赖浮动范围。
- **验收**：
  1. 干净 checkout 后单一安装命令可恢复依赖。
  2. 根目录可运行 desktop build/test/check，不依赖全局 Electron。
  3. `packages/client` 从仓库源码或明确 build artifact 解析，不复制源码。
  4. lockfile 无无关移动端升级，`dist/` 和打包产物不入库。
- **不包含**：窗口、renderer UI、打包 `.app`。
- **依赖**：无。
- **证据**：[`docs/desktop/evidence/DESK-D0-01/verification.md`](desktop/evidence/DESK-D0-01/verification.md)。

### DESK-D0-02 — Electron main/preload 安全壳

- **状态**：Done（自动安全检查；Mac 启动归 `DESK-D0-05`）。
- **目标**：建立最小 BrowserWindow 和只读 preload，从第一天固定 Electron 安全边界。
- **范围**：窗口生命周期、`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、导航/新窗口拦截、HTTPS 外链校验、最小 runtime info bridge。
- **验收**：
  1. main 与 preload 可构建，未暴露 `ipcRenderer`、`require`、shell 或通用 invoke。
  2. 页面内导航被拒绝；非法、非 HTTPS 外链不会交给系统。
  3. renderer 无 Node global，preload 返回值冻结且无敏感环境信息。
  4. 关闭最后窗口遵循 macOS 生命周期，不实现托盘或隐藏后台驻留。
- **不包含**：Keychain、文件、通知、任意业务 IPC。
- **依赖**：`DESK-D0-01`。
- **证据**：`apps/desktop/tests/electron-security.test.mjs`；[`docs/desktop/evidence/DESK-D0-02/verification.md`](desktop/evidence/DESK-D0-02/verification.md)。

### DESK-D0-03 — React 三栏与响应式骨架

- **状态**：Review（自动检查完成；真实 Mac 三种宽度截图待 `DESK-D0-05` 启动后补齐）。
- **目标**：显示 Channels、Threads、Conversation 三栏语义骨架，并在窄窗口中确定折叠规则。
- **范围**：renderer HTML/入口/CSS、错误边界、三栏 landmarks、空状态、720px 最小窗口、中宽隐藏 Channel、窄宽单主区切换。
- **验收**：
  1. renderer 可独立构建，不引用 Node/Electron package。
  2. 正常宽度为三栏；折叠不复制手机导航栈，不销毁已选 Thread 的页面状态。
  3. CSP 禁止远程脚本、inline script 和任意网络图片；样式不依赖 CDN。
  4. 键盘焦点顺序合理，所有临时按钮有英文可访问名称。
- **不包含**：真实数据、美术定稿、复杂动画。
- **依赖**：`DESK-D0-01`。
- **证据**：`apps/desktop/tests/renderer-shell.test.mjs`；[`docs/desktop/evidence/DESK-D0-03/verification.md`](desktop/evidence/DESK-D0-03/verification.md)；Mac 三种窗口宽度截图待补。

### DESK-D0-04 — D0 安全自动回归

- **目标**：把 Electron 和 renderer 安全约束变成阻止回归的自动 gate。
- **范围**：静态/运行时测试、构建产物检查、CSP 检查、preload surface 快照、禁止危险 Electron 配置。
- **验收**：主动引入 `nodeIntegration: true`、宽泛 IPC 或远程脚本时测试必失败；正常构建全绿。
- **不包含**：OS 权限渗透测试或第三方审计。
- **依赖**：`DESK-D0-02`、`DESK-D0-03`。
- **证据**：`apps/desktop/tests/security-baseline.test.mjs` 及 CI/本地输出。

### DESK-D0-05 — Apple Silicon Mac 开发启动

- **目标**：在 Mac mini 上从 checkout 启动 Electron 开发 App，并能用现有 GUI 观察工具验收。
- **范围**：Mac Node/npm 安装方式、依赖恢复、build/start 命令、日志位置、启动/退出 smoke test。
- **验收**：
  1. Apple Silicon 原生进程启动，窗口可见且无白屏。
  2. 截图确认三栏和 CSP 页面；退出后无残留 Electron 子进程。
  3. 不修改 TCC、Accessibility 或 Input Monitoring；当前只读 Screen Recording 足够。
- **不包含**：可分发 artifact、签名、notarization。
- **依赖**：`DESK-D0-04`。
- **证据**：`docs/desktop/evidence/DESK-D0-05/` 中的脱敏命令记录、进程记录和截图。

### DESK-D0-06 — 未签名 `.app` 打包与回滚

- **目标**：产出可复制启动的 arm64 未签名开发 `.app`。
- **范围**：打包器选择与锁定、bundle ID、应用名称、图标占位、最低 macOS 版本、arm64 target、artifact 清理和回滚说明。
- **验收**：
  1. 构建产生结构完整的 `.app`，不包含源码凭据、`.env`、测试日志或真实聊天数据。
  2. 从新目录复制后可启动、退出、重开。
  3. 记录 SHA-256、大小、最低系统版本和回滚删除步骤。
- **不包含**：DMG、Developer ID、notarization、自动更新。
- **依赖**：`DESK-D0-05`。
- **证据**：artifact manifest、校验和和真机截图；artifact 本体不提交 Git。

### DESK-D0-07 — HermesClient transport 与 React adapter

- **目标**：用桌面浏览器 transport 实例化共享 `HermesClient`，以薄 adapter 接入 React。
- **范围**：HTTP/WebSocket/binary transport、`useSyncExternalStore`、稳定 snapshot、选择器、连接状态和用户可见错误分类、开发 base URL 配置。
- **验收**：
  1. renderer 不读取 Node 环境变量或磁盘；base URL 只允许 `https:`，测试 loopback 可显式注入。
  2. 选择器仅在相关状态变化时更新，不形成订阅泄漏。
  3. blocked/suspended/reconnecting/online 映射为自然英文状态，不显示原始异常。
  4. credential 改变时销毁旧 client，不跨身份复用缓存。
- **不包含**：持久凭据、配对 UI、outbox。
- **依赖**：`DESK-D0-01`、共享 client 现有契约。
- **证据**：transport 与 selector 单元测试。

### DESK-D0-08 — 设备配对状态机与界面

- **目标**：完成一次性设备配对，不要求用户查找或复制长期 token。
- **范围**：未配对、发起、等待管理员、成功、拒绝、过期、取消、重试状态；配对响应验证；用户文案。
- **验收**：
  1. 每个状态有自动测试，重复点击不产生并发配对风暴。
  2. 过期/拒绝不会写入凭据；成功只把凭据交给 main 的窄保存接口。
  3. UI、日志和测试快照不显示长期 token、配对 secret 或原始服务端异常。
- **不包含**：Keychain 实现、管理员 UI、自动重新授权撤销设备。
- **依赖**：`DESK-D0-07`；开工前核对 plugin 仓库中的现有配对契约。
- **证据**：状态机测试和脱敏 UI 截图。

### DESK-D0-09 — macOS Keychain 凭据与身份隔离

- **目标**：由 main 进程安全保存、读取和删除设备凭据，renderer 不持久持有明文。
- **范围**：Keychain 库/原生能力选择、service/account 命名、窄 IPC、启动恢复、忘记连接、身份切换、错误降级。
- **验收**：
  1. 真实 Mac 配对后重启 App 可恢复连接。
  2. 忘记连接后 Keychain 项删除、client 关闭、缓存按身份清理且无法继续访问。
  3. renderer storage、日志、crash 文本和截图中无 token。
  4. Keychain 拒绝/锁定时显示可行动的非技术提示，不回退到明文文件。
- **不包含**：多账号同时在线、iCloud Keychain 同步承诺。
- **依赖**：`DESK-D0-08`、`DESK-D0-02`。
- **证据**：IPC contract 测试、真机重启/删除记录；不得保存 Keychain 内容本身。

### DESK-D0-10 — 只读真实三栏

- **目标**：使用共享 client 显示真实 Channel、Thread 和最近消息，不提供尚未实现的写操作。
- **范围**：Channel 列表、Thread 列表、当前选择、最近消息、加载/空/离线状态、选择保持、身份切换清空。
- **验收**：
  1. 选择 Channel 只加载其 Threads；选择 Thread 显示对应最新窗口。
  2. 排序、未读数和运行状态来自服务端投影，不由桌面缓存重新定义。
  3. 切换 Thread 不无必要销毁右侧状态；断线保留已确认内容并标明连接状态。
  4. 未实现的创建、编辑和发送入口不出现或明确禁用，不能假装成功。
- **不包含**：历史上翻、发送、Markdown 完整渲染、管理操作。
- **依赖**：`DESK-D0-03`、`DESK-D0-07`、`DESK-D0-09`。
- **证据**：mock 投影测试、Mac 真实开发 Gateway 脱敏截图。

### DESK-D0-11 — D0 总验收

- **目标**：确认独立桌面 App 在真实 Mac 完成配对、Keychain 重启恢复和只读浏览。
- **验收矩阵**：干净启动、拒绝配对、过期配对、成功配对、重启恢复、忘记连接、断线只读、三种窗口宽度、退出无残留、未签名 `.app` 复制启动。
- **依赖**：`DESK-D0-04` 至 `DESK-D0-10` 全部完成。
- **通过条件**：自动测试与 Mac 证据均齐全；任何 token/私人数据泄漏为阻断项。
- **证据**：`docs/desktop/evidence/DESK-D0-11/acceptance.md`。

---

## 5. D1：完整聊天闭环

### DESK-D1-01 — Channel 管理

- **范围**：创建、编辑名称/Description、删除确认、权限/冲突/失败反馈。
- **依赖**：`DESK-D0-11`。
- **验收**：服务端确认后更新；失败不伪造成功；Description 不作为普通消息显示，既有 Thread 不热注入。
- **证据**：API mock 测试、Mac 与手机交叉可见验证。

### DESK-D1-02 — Thread 管理

- **范围**：新建 Topic、稳定 `client_thread_id`、改名、归档、当前选择回退、`Command+N` action hook。
- **依赖**：`DESK-D0-11`、`DESK-D1-01`。
- **验收**：重复创建请求不生成重复 Thread；归档后选择确定性回退；手机端同步可见。
- **证据**：身份/冲突测试和双端记录。

### DESK-D1-03 — 连续时间线投影

- **范围**：用户、Agent、system notice、public commentary、tool call、receipt/interaction 的显示投影和稳定 React key。
- **依赖**：`DESK-D0-10`。
- **验收**：实时、历史、冷启动顺序一致；相同正文不同身份不合并；同身份更新不重复；analysis/reasoning 不显示。
- **证据**：fixture 投影测试，覆盖编辑、乱序、压缩与工具穿插。

### DESK-D1-04 — 历史分页、锚点与底部跟随

- **范围**：最新窗口、向上分页、阅读锚点、新消息提示、回到最新、切 Thread 的请求取消和竞态。
- **依赖**：`DESK-D1-03`。
- **验收**：进入定位最新；上翻停止跟随；加载旧历史像素锚点稳定；新消息不抢位置；主动发送/点击恢复跟随。
- **证据**：DOM 滚动测试、Mac 长短列表录像或截图序列。

### DESK-D1-05 — Composer、草稿与发送键

- **范围**：每 Thread 草稿、Enter 发送、Shift+Enter 换行、输入法 composing 防误发、发送/停止并列布局、附件占位。
- **依赖**：`DESK-D0-11`。
- **验收**：空消息拒绝；切 Thread 保留本地草稿；IME composing 不发送；提交失败不清空未持久草稿。
- **证据**：键盘/IME 单元测试和 Mac 手工检查。

### DESK-D1-06 — 持久 outbox 与身份隔离

- **范围**：本地数据库选择、schema/version、先持久后发送、connection identity 分区、重启恢复、成功清理、配对删除清理。
- **依赖**：`DESK-D1-05`、`DESK-D0-09`。
- **验收**：进程在任意持久点退出均不丢已接受发送；身份切换不可见另一身份 outbox；迁移失败安全停止而非清库重发。
- **证据**：故障注入、迁移和重启测试。

### DESK-D1-07 — 发送确认、同 ID 重试与 unknown 核对

- **范围**：稳定 `client_message_id`、乐观消息归并、ACK 丢失、可重试/阻断错误、receipt 核对、用户可见发送状态。
- **依赖**：`DESK-D1-06`、`DESK-D1-03`。
- **验收**：同 ID 同原文重试只产生一条消息和一次执行；401/403 停止；unknown 自动核对但不自动重跑；不同 ID 同正文保持两条。
- **证据**：transport 故障矩阵和真实开发 Gateway 幂等验证。

### DESK-D1-08 — 运行状态、停止、排队取消与运行中补充

- **范围**：真实 receipt processing、Agent running、stop、cancel queued、busy input 的 Hermes 原生补充语义。
- **依赖**：`DESK-D1-07`。
- **验收**：发送状态和执行状态分离；停止不清草稿；过期操作安全失败；普通排队不伪装为已插入当前执行。
- **证据**：状态矩阵测试和真实长任务记录。

### DESK-D1-09 — 审批与澄清

- **范围**：pending interaction、选择/文本回答、generation/receipt 防陈旧提交、一端处理后另一端收起。
- **依赖**：`DESK-D1-03`、`DESK-D1-07`。
- **验收**：重复/过期回答不能生效；重连恢复 pending 状态；服务端 settled 后 UI 不残留操作按钮。
- **证据**：竞态测试和 Mac/iPhone 双端记录。

### DESK-D1-10 — Markdown、代码、表格、公式与 Mermaid

- **范围**：安全 Markdown pipeline、代码复制、宽表横滚、KaTeX/Mermaid 本地资源、失败原文降级、安全链接。
- **依赖**：`DESK-D1-03`、CSP 基线。
- **验收**：HTML/script/危险 URL 不执行；不发站外请求；Mermaid 超时/错误显示原文；宽内容不撑坏三栏。
- **证据**：恶意 fixture 测试和 Retina 截图。

### DESK-D1-11 — 工具记录与公开说明

- **范围**：工具安全名称、搜索 query 白名单、命令摘要、进行/成功/失败状态、折叠详情、与正文原始顺序。
- **依赖**：`DESK-D1-03`、`DESK-D1-10`。
- **验收**：不显示 reasoning、原始参数 JSON、原始返回或凭据；调用发出不等于成功；实时/历史一致。
- **证据**：合成安全 fixture 与一次真实联网查询。

### DESK-D1-12 — 附件选择、Finder 拖放与上传

- **范围**：受限文件选择、drag/drop、文件名/大小/type 校验、最多数量、上传进度/取消、未附着附件清理。
- **依赖**：`DESK-D1-05`、main/preload 窄文件接口。
- **验收**：renderer 只获得选中能力所需数据；拖入目录/超限/取消安全处理；本地路径不成为附件身份。
- **证据**：IPC/上传测试和 Finder 真机拖放。

### DESK-D1-13 — 附件下载、保存与系统打开

- **范围**：授权下载、保存位置、临时文件生命周期、默认应用打开、删除/过期状态。
- **依赖**：`DESK-D1-12`、`DESK-D1-03`。
- **验收**：文件名净化和边界检查；不能打开未由 App 下载/确认的任意路径；失败不遗留部分文件。
- **证据**：路径攻击测试、Mac 保存/打开验证。

### DESK-D1-14 — 未读、已读与可见性规则

- **范围**：未读徽标、窗口/Thread 可见性、最高可见 `ref_seq`、单调 mark-read、后台窗口规则。
- **依赖**：`DESK-D1-03`、`DESK-D1-04`。
- **验收**：乱序事件不使已读倒退；仅真正可见内容推进；手机已读后桌面同步，反向亦然。
- **证据**：单调性测试和双端验证。

### DESK-D1-15 — Command palette 与基础快捷键

- **范围**：`Command+K` 搜索/切换 Channel/Thread，`Command+N` 新建 Topic，标准复制/查找行为，冲突时焦点规则。
- **依赖**：`DESK-D1-02`、`DESK-D1-14`。
- **验收**：键盘可完成切换；快捷键不截获输入法和编辑器标准行为；结果不显示内部 ID。
- **证据**：键盘测试与 Mac 手工验收。

### DESK-D1-16 — D1 总验收

- **目标**：证明桌面端可完成日常聊天闭环，并与手机端保持基本一致。
- **矩阵**：Channel/Thread CRUD、发送/ACK 丢失、停止/补充/取消、审批/澄清、历史锚点、Markdown/Mermaid、工具、附件、未读、快捷键、双端互发。
- **依赖**：`DESK-D1-01` 至 `DESK-D1-15` 全部完成。
- **证据**：`docs/desktop/evidence/DESK-D1-16/acceptance.md`。

---

## 6. D2：可靠性与桌面体验

### DESK-D2-01 — 断网、切网、睡眠/唤醒恢复

- **范围**：offline/online、电源恢复、heartbeat、请求取消、自动 catch-up、轻量连接提示。
- **依赖**：`DESK-D1-16`。
- **验收**：无需用户重试即可补齐；旧连接回调不能污染新连接；鉴权失败除外且明确阻断。
- **证据**：自动网络故障矩阵和 Mac 睡眠/唤醒记录。

### DESK-D2-02 — Gateway 重启与全部客户端关闭后的结果恢复

- **范围**：Gateway 中断、持久 cursor、receipt/history 冷恢复、客户端全关期间任务完成。
- **依赖**：`DESK-D1-16`。
- **验收**：重开后恢复完整结果、工具顺序和最终状态，不重复执行或消息。
- **证据**：隔离开发 Gateway 重启方案与前后快照；重启需在既有授权范围内。

### DESK-D2-03 — Mac/iPhone 多端一致性与竞态

- **范围**：同时在线、乱序/重复事件、已读、审批、归档、同 ID 和跨端发送。
- **依赖**：`DESK-D2-01`、`DESK-D2-02`。
- **验收**：无重复、顺序一致、已读单调、一端 settled 后另一端失效、缓存不胜过服务端。
- **证据**：逐步骤双端矩阵，分别记录 Mac 与 iPhone 观察。

### DESK-D2-04 — 长历史性能与虚拟列表

- **范围**：虚拟化方案、消息高度变化、Mermaid/图片晚加载、锚点、内存上限和性能测量。
- **依赖**：`DESK-D1-04`、`DESK-D1-10`、`DESK-D1-11`。
- **验收**：在定义的数据集和硬件上记录首屏、分页、滚动和内存；无明显跳位或整页 DOM 常驻。
- **开工决策**：先定义消息数量、混合内容 fixture 和可接受阈值，不能事后选择有利数字。
- **证据**：benchmark 脚本、环境和原始汇总，不提交真实聊天。

### DESK-D2-05 — 系统通知与 Thread 深链

- **范围**：通知权限、前后台抑制、隐私文案、点击路由、冷启动/已启动定位、已归档/无权限降级。
- **依赖**：`DESK-D1-14`、`DESK-D1-02`。
- **验收**：点击定位准确 Thread；通知不替代服务端拉取；默认不泄露敏感正文；重复事件不重复通知。
- **证据**：Mac 真机权限、通知和点击定位记录。

### DESK-D2-06 — 窗口、栏宽与本地偏好恢复

- **范围**：窗口 bounds、显示器变化、三栏宽度、折叠状态、字体偏好、损坏偏好回退。
- **依赖**：`DESK-D0-03`。
- **验收**：重启恢复；外接显示器移除后窗口回到可见区域；偏好与连接身份/聊天状态分离。
- **证据**：纯函数测试和 Mac 多次重启记录。

### DESK-D2-07 — 键盘、VoiceOver 与减少动态效果

- **范围**：landmark/heading、列表语义、焦点恢复、对话框 trap、VoiceOver label、对比度、reduced motion。
- **依赖**：全部 D1 UI 卡。
- **验收**：仅键盘完成主闭环；VoiceOver 能辨识三栏、消息作者/状态和操作；状态更新不无故抢焦点。
- **证据**：自动 a11y 检查和 Mac VoiceOver 手工清单。

### DESK-D2-08 — 隐私、安全与缓存清理回归

- **范围**：提交/包内容扫描、日志脱敏、Keychain/outbox/cache 生命周期、外链/文件/通知边界、忘记连接后的清理。
- **依赖**：`DESK-D1-16`、`DESK-D2-05`。
- **验收**：artifact 无 token、`.env`、真实聊天或私有诊断；renderer 无通用特权；身份 A 的本地状态不泄漏到身份 B。
- **证据**：自动扫描规则、负例和清理前后 inventory（不读取或保存 secret 值）。

### DESK-D2-09 — D2 总验收

- **目标**：完成第一版可靠性、性能、通知、恢复、辅助功能和双端验收。
- **依赖**：`DESK-D2-01` 至 `DESK-D2-08` 全部完成。
- **通过条件**：`docs/desktop-macos-v1.md` 第一版验收清单逐项链接到证据；任何未测项保持未完成。
- **证据**：`docs/desktop/evidence/DESK-D2-09/acceptance.md`。

---

## 7. D3：分发准备（Deferred）

### DESK-D3-01 — Developer ID 签名与 notarization

恢复前必须单独确认账号、证书、权限、bundle identity、entitlements、隐私说明和回滚策略。

### DESK-D3-02 — DMG、自动更新与公开发布

恢复前必须单独确认发布渠道、更新签名、托管、版本策略、隐私政策和生产支持责任。

D3 不阻塞 D0–D2 的内部开发和真实设备验收。

## 8. 下一批执行顺序

1. 完成 `DESK-D0-01`：接入 workspace、锁依赖并使当前脚手架真正可构建。
2. 并行完成 `DESK-D0-02` 与 `DESK-D0-03`。
3. 用 `DESK-D0-04` 固化安全回归，再到 Mac mini 执行 `DESK-D0-05`。
4. 开始 `DESK-D0-07` 前冻结 desktop transport 和 selector 接口；不提前引入 outbox。
5. 只有 D0 真机 gate 通过后，才进入 D1 写操作和日常聊天闭环。
