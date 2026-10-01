# 消息信息层级（Discord 截图反馈）

## 已确认设计方向

- 桌面：最终回复的首条正文使用轻微暖色底，与过程区分；强调回复正文，而不是把每次工具调用包装成同权重卡片。
- 公开中间说明保持 Markdown 和原始顺序；工具使用单行“动作图标 + 动作 + 必要对象”。仅安全终端命令另用浅底等宽块。调用不是成功，不画推测的结果标记。
- 连续 Agent 过程记录共用一次发送者/时间；用户、系统通知和直接回复打断分组。不合并消息身份，不改变历史顺序。
- Jamie 补充：移动端整体尚可，不做全面重设计，重点消除文件操作中长路径参数的阅读噪声。

## 本轮候选实现

- 桌面 bridge 保留已有工具 name 和 display_kind（此前丢弃），按工具名选择明确动作图标；默认显示已有安全摘要，不再用折叠 details 卡片藏掉关键对象。未知工具安全降级为齿轮。
- 桌面连续 assistant 行去掉重复 byline，工具记录缩小间距，命令预览限制高度但可滚动读取安全全文。
- Jamie 进一步要求照搬 Discord adapter，取消自定义“末级目录 + 读取数量”方案。两端文件读取照搬共用 `agent.display._preview_read_file/_read_file_line_label`：`Reading tenancy.py L150-259`；写入/编辑沿用 Discord 默认 40 字符预览预算，明确 `...` 截断，不铺开长路径。核心预览函数实跑得到 `tenancy.py L150-259` 与 `/very/long/workspace/project/folder/w...`，候选代码测试对齐。
- 只缩短已知文件操作的安全 detail；不解析原始参数，不改命令、搜索词或网页 URL。全文阅读保留原始安全 detail；缩略文件行的小型详情入口复用现有文章阅读页，纯工具行也能查看完整路径。原生文字选择不改为自制复制弹层。
- 手机、桌面与手机全文阅读复用动作图标映射；没有新增依赖。

## 尚未完成：最终回复强调

现有 Message 契约只有 `direct` 与 `system_notice` 展示类型，普通 assistant 同时承载工具、公开说明与最终正文。`direct` 是直接/命令回复，不等于模型最终答案。客户端不得根据“最新一条 assistant”“没有工具”或收据完成猜测 final。

只读检查 Discord 源码确认：`adapter.py:send` 用 `metadata.notify` 标记 final delivery，`reply_to_mode=first` 仅首个 chunk 携带引用；该回复引用由 Discord 客户端绘制，不是 adapter 设置了消息背景色。`gateway/stream_consumer.py:_metadata_for_send(final=True)` 提供明确 notify 语义。App adapter 当前模型回复返回 `core:<receipt_id>`，权威正文来自 SessionDB，未将这条交付分类映射到可见历史；不能复制 Discord 发送记录作为第二套权威聊天数据，也不能按正文匹配同文消息。

需要在独立插件仓库通过正式投影/生命周期扩展点传递可证明的公开说明/最终答案类型，并由共享 SDK 保留；不能读取 analysis/reasoning。未知或旧消息保持普通正文。跨实时、历史冷读、分页、压缩和重连类型必须一致，再启用最终正文淡底。本轮未改插件、核心、运行配置或 Gateway，最终回复底色需求未声称完成。

## 验收与发布边界

候选分支 `jamie/message-hierarchy`，不修改运行 main/Expo 来源。桌面生产 renderer 与手机生产组件自动化分别验证；Mac/iPhone 视觉、点按、键盘和长路径真机体验待验收。双平台 Expo export 不是独立安装包。发布、最终回复类型的插件实施与开发服务重启单独确认。

本地最终检查：桌面 TypeScript/build 与 42 项测试通过；手机 TypeScript 与 378 项测试通过。早期失败记录保留：新测试未选择 Thread、未正确访问文章 viewer；共享 client 未先 build 导致若干手机测试缺 dist；新增生产组件 import 后测试依赖注入需同步。修复后全套通过，不隐藏失败历史。iOS/Android 导出以最后候选代码为准，证据保存在当前 profile 私有 workspace。
