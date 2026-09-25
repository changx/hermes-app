# 早期 P0 主控复核记录

本目录保留第一轮 history / transport / hosted-room / shared SDK / Linux 诊断包的主控证据，早于后续 plugin-only 和真实 GatewayRunner 探针。不是本轮重新执行的结果。

- `summary.json`、`package-parent.json`：原始结果与当时估算，保留不覆盖。`effort_estimate_not_commitment` 是早期粗估，**不作为当前 P1 工期承诺**。
- `core-before-plugin.json`：开始插件探针之前的只读核心基线。
- `*.log`：对应原始命令输出；Android 失败及 Electron sandbox 限制仍保留。

当前结论以 `docs/p0/plugin-summary.md`、P0 收尾报告与 `docs/p1-plan.md` 为准。此目录数值不能与后续重叠回归直接相加，得到所谓不重复测试总数。
