# 创建 Thread 时选择模型

## 已确认需求

Jamie 确认：

1. 创建 Thread 时可以选择模型。选择只对这个 Thread 生效。
2. 默认是该连接的 primary model（profile `config.yaml` 默认模型）。不选模型时，行为和以前一样。
3. 选择不影响 Thread 标题生成。
4. 可选模型来自所选 Channel 所属连接。换 Channel 后重新读取列表。

范围外：创建后修改模型、Channel 级默认模型、修改 profile 默认模型。

## 用户看到的界面

- 手机「新对话」页（Recents 的 New）：输入框上方一直显示一个模型按钮，例如 `Default (claude-opus-5-5)`。点击后打开模型列表（与 Channel 选择相同的 page sheet）。列表第一项是 `Default (<primary model>)`，其他模型按 Provider 显示，模型多于 12 个时显示搜索框。
- 手机 Channel 页底部的新对话输入框：输入时，或已选择非默认模型时，才显示模型按钮。不输入时不占位置。
- 桌面 New chat 页：Project 下面是 Model 下拉框。第一项是 `Default (<primary model>)`，其他模型按 Provider 分组。
- 换 Channel / Project 后，列表从新 Channel 所属的连接重新读取，选择回到 Default。
- 第一次发送开始后，模型和 Channel 一起锁定。服务端明确拒绝该模型（`400`）时，解锁并提示 `This model is not available. Choose another model and send again.`
- 原生选择检查报告成本或数据策略警告时，先显示警告。手机用系统 Alert（`Cancel` / `Use model`），桌面在页面内显示（`Cancel` / `Use this model`）。确认后用同一个 Thread ID 重新提交；取消后不创建任何内容，可以换模型。
- 服务端不支持（没有 `thread_model` capability）时，不显示模型选项，也不读取模型列表。

## 实现

- 服务端（`hermes-app-plugin`，`docs/thread-model.md`）：`POST /v1/channels/{id}/threads` 接受可选 `model: {provider, model, confirm_selection?}`。插件用原生 `switch_model` 解析，然后用原生 `SessionStore.set_model_override` 写入这个 Thread 自己的 session。第一轮由核心读回该设置。不产生消息、不发 `/model`、不加切换提示、不改 `config.yaml`。
- 共享客户端：`createThread(channelId, title, clientThreadId, model?, confirmModel?)`；警告时抛出 `ModelConfirmationRequired`（`ProtocolError`，不会被自动重试）。`supportsThreadModel` 来自 capability。列表和标签逻辑在 `packages/client/src/threadModel.ts`，两端共用。选择与 primary model 相同时不发送 `model`，让 Thread 跟随默认。
- 手机：`NewTopicComposer` + `ThreadModelPicker`。模型与 Thread ID 在第一次尝试时一起固定，重试发送相同请求。
- 桌面：`new-session-page.tsx` 用 Channel 的 `connectionKey` 读取 `getModelSettings`；IPC `createThread` 返回 Session ID、确认请求或 `model_rejected`。

## 验证

- 插件真实 GatewayRunner 测试（本地合成 Provider）：选定模型的 Thread 每轮请求都用所选模型；默认 Thread 用 primary model；标题请求只用固定的标题模型；第一条历史是用户原文；回复模型标签一致；创建和对话后 `config.yaml` 不变；无效选择、确认、解析失败、幂等重试和冲突都覆盖。
- 共享客户端、手机（真实组件 + 共享客户端 + 假服务端）、桌面 Chromium（列表来源、换 Project、确认、取消、拒绝、布局间距）测试。
- 未验证：iPhone 和 Mac 真机外观与操作、真实 Provider 的模型切换。
