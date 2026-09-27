# Provider、Model 与界面字体设置

主卡 t_79fac7b1。Jamie 要求给 Agent 增加模型和 Provider 设置，并增加界面字体大小设置。应用文案保持英语。本次独立于 native-command-output；不自动发布。

## 范围

- 读取服务端实际 Provider/Model，复用 Hermes 原生配置与切换，不维护仅在手机生效的假选择。仅使用服务器已配置 Provider，不增加密钥或登录管理，不返回敏感配置。
- 字体大小是设备级偏好，立即生效并持久化，覆盖原生界面、聊天、代码和 HTML/WebView 阅读器，保留系统无障碍缩放。
- 字体控件 Small / Default / Large / Extra large。模型设置提供加载、保存、失败反馈。不改变网络、消息内容或排序。

## 验收

服务端认证、参数校验、保存读回与真实原生接口测试；客户端连接切换时隔离迟到响应；字体冷启动恢复、保存失败、无效值回退及原生/HTML覆盖；SDK/mobile类型与测试、Python定向集成验证。实际 Provider 切换、真机视觉和部署未验证时明确保留。

## 实现与验证结果

- Model 设置修改已连接 Hermes profile 的默认 Provider/Model。调用原生 inventory、switch_model、选择警告和 persist_model_selection；与原生 `/model` 共用锁，保存后重新读取。已有 session/channel override 保持原生优先级，运行中回复不变。仅支持单 profile Gateway；不提供密钥、登录或新 Provider 配置。
- 模型目录可能为空或不完整，允许输入模型名称并由原生切换验证；模型别名保存后展示实际规范名称。原生成本／数据策略警告必须确认后才保存。接口不返回地址、密钥或认证元数据。
- FontSizeProvider 保存设备级偏好，原生文字与输入框、聊天、文章、代码和图表阅读器应用缩放；保留系统文字缩放。保存失败恢复已确认值并显示错误。
- 主控最终复核：SDK **56/56**，手机 **230/230**，两端 TypeScript 通过；Android/iOS Metro export 均通过。模型 API **7/7** 使用隔离配置、真实 GatewayRunner 回调 wrapper/锁和原生持久化，网络目录/能力解析使用测试替身，未调用真实 Provider。
- P1 按测试身份去重 **197 项通过**。此前整批运行超时，后续逐文件与逐 runner 用例有界运行全部通过；这不等于已定位整批超时原因。race 在当前候选与 main 基线均单独通过。
- 私有验证日志：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/agent-settings/`；P1 XML 在 `p1-files/` 和 `runner-check/`。测试生成的临时 evidence 不作为无关仓库改动提交。
- 候选验收时未发布、未做真机排版/系统辅助缩放验收、未切换真实 Provider；后续授权发布结果见下节。本次不包含 native-command-output 候选。

## 授权发布

Jamie 随后明确要求“发布”。已将 `4552a8ea71d5202ebf65d365addd7d3e51466171` fast-forward 到运行目录，安装对应开发插件，仅重启隔离 `hermes-gateway-hermes-app-dev.service` 与 `hermes-app-expo.service`。

- 公网认证模型目录正常，当前 Provider/Model 与配置文件一致；未认证请求返回 401。公网历史快照和 capabilities 正常。
- iOS/Android manifest 对应的实际 launchAsset 均包含模型设置接口、字体设置控件与持久化键；已核验完整文件哈希，记录在私有 `workspace/hermes-app/agent-settings/release-verification.json`。
- Jamie Gateway PID/启动时间、固定核心提交及工作树状态、开发实例配置文件哈希均未变。没有切换真实模型或 Provider。
- 回滚保留于私有 `workspace/hermes-app/agent-settings/release-rollback/`，发布前身份记录为 `release-before.json`，基线提交 `c2be2a3`。代码回退应使用独立回滚提交，并恢复旧插件（删除本次新增 model_settings.py），不直接回退或改写用户数据。
- 真机排版、系统辅助缩放以及真实 Provider 切换仍未验证；公网加载包验证不代替真机验收。
