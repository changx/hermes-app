# P0：现有持久 Room 能力验证

## 结论

Hermes 已有 `groups.*` / `hosted_rooms` 的持久房间身份、事件日志、游标读取和幂等能力。不能仅因普通 `session.events.since` 是内存回放，就断言整个 Hermes 缺少持久同步基础。

这为独立 Thread 的连续历史和异步接收提供复用候选，但还不能把现有多人 Discussion 服务原样当作客户端后端。应复用必要的日志/执行所有权原语，避免引入无需的多 Agent 调度、跨 Gateway 复制和 authority 迁移。

## 实际执行

源码基线：`2f16a1aa5a35feec496949abdef7ad51aea0e7ef`。

自有探针：`probes/p0/rooms/probe.py`，直接调用基线的 `gateway.hosted_rooms`，用真实临时 SQLite、双线程和新的 Python 子进程；全部消息为合成数据，不构造 Agent、不调用模型。

```bash
uv run --no-project --python "$HERMES_ROOT/.venv/bin/python" \
  probes/p0/rooms/probe.py --hermes-root "$HERMES_ROOT" \
  --output probes/p0/rooms/results.json
```

`HERMES_ROOT` 应指向上述提交的隔离 checkout；`TMPDIR` 必须指向任务允许的 scratch。探针自行清空凭据环境并创建隔离 HOME/HERMES_HOME。

实测 10 项通过：

- 创建同一房间幂等。
- 同一发送 ID、同一内容返回原事件。
- 同一发送 ID、不同内容拒绝。
- 相同文字使用新发送 ID 仍创建新事件。
- 并发重试只写一个事件。
- 改名与改名事件原子一致。
- 游标分页完整、有序、不重复。
- 新 Python 进程可读取原日志，并仍能去重旧发送。
- 超出当前日志的未来游标被拒绝。
- 改名及重开后房间身份保持不变。

原始结果：[results.json](../../probes/p0/rooms/results.json)。临时数据库退出后已删除。

另经官方 `scripts/run_tests.sh`（隔离 HOME，清空凭据、2 workers、无失败重试）运行：

- `tests/gateway/test_hosted_rooms.py`：50 passed。
- `tests/gateway/test_hosted_rooms_read_path.py`：1 passed。
- `tests/tui_gateway/test_hosted_room_service.py`：40 passed。

合计 91 passed、0 failed。后者使用合成 RPC/peer 替身验证真实协调服务，不是实际模型/公网联调。原始日志：[upstream-tests.log](../../probes/p0/rooms/upstream-tests.log)，运行元数据：[upstream-tests.json](../../probes/p0/rooms/upstream-tests.json)。

## 限制与需要补齐的部分

- 本探针只证明持久存储，不证明桌面/手机都已连接或系统推送可用。
- 存储去重不等于任意外部工具副作用的 exactly-once 保证；还要验证接收、排队、执行和终态的衔接。
- Room 对象不是完整的 Channel/Thread；没有证明 Description 注入、阅读游标和附件协议满足需求。
- 数据库源码有容量与保留限制；长期原文保留必须另行设计，不能因为日志 append-only 就宣称无限保存。
- 生产默认路径可能使用 install 级 shared-state.db；新客户端的 profile/用户权限隔离不能从存储函数本身推导。探针始终显式传入隔离 DB，不触碰真实 shared-state。
- 当前测试解释器链接 SQLite 3.50.4，Hermes 发出已知 WAL-reset 风险警告并实际选择 DELETE journal 规避；本轮未更新系统或运行时。正式实现沿用安全 guard，并验证实际部署解释器版本。

## 对下一阶段的影响

P1 数据方案应先比较：扩展现有持久 Room 日志原语，与继续使用原 session 展示投影的映射。不要未经比较就新增第二套同类日志，也不要为了复用把用户体验绑定为多人群聊。后台执行所有权需要结合 transport 工作报告验证，不能用这些存储测试代替。
