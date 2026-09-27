# 接收时分配展示序号

基线 `99c0ae6`。仅将用户消息的展示 ref_seq 分配前移到 accept 持久事务，普通输入和追加输入一致；同 ID 重试复用，核心历史关联原位更新。沿用现有 receipt-backed 引用，不新增协议字段或修改客户端排序。

先分配后，历史关联必须复用已分配引用，不能再次插入同一输入。尚无核心原文时仍保留已接收的原文，避免已分配的位置在中断/取消后变成空记录。以上是此次分配时机变化所需的关联与可读性保障，不改变执行调度。

模型 context、压缩历史位置、Hermes 核心、原生追加路径和 reaction 均不改。不会按展示 seq 重排模型输入。既有已发布序号不重排。本轮只实现与本地测试，不发布、不重启服务。

验收：未开始执行即按接收顺序可读；首条尚无核心行时追加不抢位；精确关联后序号/身份不变；重试不重复；取消/重启原文可读；真实 GatewayRunner 与压缩回归检查。

实际结果：P1 共 143 个用例已分批全部通过（逐项匹配 collected test IDs，非凭总数推断），包括真实 GatewayRunner 原生追加、原地/空闲/旋转/轮内压缩、崩溃恢复与分页。新 5 项先在基线失败，修正后通过。真实阻塞工具场景显式断言模型请求内 ALPHA 在 BETA 前、界面 owner 在两条 followup 前。Store 实际生成历史传给现有 projectTimeline，验证关联前后、冷读顺序和已处理 reaction 不变。未修改 adapter、客户端生产代码、固定核心或模型 context 路径。

运行代码仅 storage.py 与 history_hooks.py；其余为测试契约随“全部输入先取得 receipt-backed 展示身份”调整和本文档。私有证据：workspace/hermes-app/arrival-id-fix/verification.json、p1-final.log、p1-remaining.log、client-projection.log。未发布，线上仍为 99c0ae6；既有错序不在此轮重排。
