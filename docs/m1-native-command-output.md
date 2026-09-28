# Hermes 原生命令与直接回复

## 已确认范围

Jamie 要求支持 Hermes Gateway 的全部原生斜杠命令。命令仍由固定 Hermes 核心解析、检查权限和执行；App 不维护 `/usage`、`/compress` 等命令的手工白名单，不另写命令执行器。原生限制（运行中拒绝、平台不支持、缺少配置或需要授权）应原文显示，不能静默丢弃或伪报成功。

Hermes 直接回复显示给用户、持久进入 App 可见历史与同步，但不写入模型 session、不参与上下文或压缩。普通 AI 回复仍从原始 SessionDB 投影，不能因接通直接发送而重复保存。用户/模型原文不翻译，App 自有新增文案使用英文。

## 最小实现边界

- 插件 metadata 增加展示专用回复，通过既有 message_refs、事件与历史接口读取，保留消息身份、时间和顺序；不以伪造 core row ID 混入模型数据库。
- 直接发送按确切输入/话题归属接入；原生忙碌反馈继续挂在对应输入下，不重复成助手气泡。
- 普通模型输出使用确切 core 输入身份判定既有历史来源，不用正文匹配或仅凭 `/` 前缀猜测。
- 检查原生命令的中间发送、编辑、附件、权限交互及 session 切换，不把单一最终文字测试冒充全部支持。
- 命令完成由实际调用和处理结果确认，不因缺少模型 turn 标为 unknown，也不因一条提前 ACK 就宣告模型执行完成。

## 验收

原生命令注册/分派清单覆盖，实际 GatewayRunner 的代表命令、运行中回复、同ID重试、冷读、分页、搜索、编辑、模型session不污染及普通AI不重复。危险/账户/部署命令只测试分派与回执机制，不在真实环境执行。自动化与真机验证分开记录。

主卡 `t_ba8d7eda`，命令路径审计 `t_0e379fcc`，存储 `t_3aaea74f`。隔离分支 `jamie/native-command-output`。

## 收尾交付范围

Jamie 已在 Discord 线程 `1553991302557863988` 明确要求“收尾交付”：完成候选、回归验证并发布到既有 App 开发入口。只更新必要客户端及 `hermes-app-dev` 插件；保留最新模型设置、字体、路由和键盘改动，不改 Jamie 主实例或固定 Hermes 核心。发布前确认开发执行空闲、保存插件与 metadata 回滚数据，发布后经公网实际发送原生命令并冷读核对，不以离线测试替代交付验证。

客户端初步验证：移动端 266 项通过，SDK 标准检查通过，双方 TypeScript 与 iOS/Android Metro export 通过。隔离 worktree 原有 node_modules 符号链接不在 Metro 观察路径内，首次 export 未解析 expo-router；改为工作树独立 `npm ci` 后两平台通过，未修改运行目录依赖。完整后端验收与发布结果以本页后续记录为准。

私有测试日志、发布脚本与回滚：`/home/hermes/.hermes/profiles/jamie/workspace/hermes-app/native-command-delivery/`。真机视觉单独记录，不用 bundle 校验冒充 iPhone 实测。
