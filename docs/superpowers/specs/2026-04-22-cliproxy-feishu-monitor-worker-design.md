# Cloudflare Worker 版 CLIProxyAPI 飞书监控设计

## 目标

在没有额外服务器的前提下，把 `cliproxy-feishu-monitor` 的定时巡检和飞书推送能力迁移到 Cloudflare 免费能力上，重点解决：定时执行、100+ 账号分片查询、运行状态持久化、失败告警、心跳推送。

## 方案概览

- 新建独立项目 `cliproxy-feishu-monitor-worker`
- 使用 TypeScript + Cloudflare Workers + Queues + D1 + Wrangler
- 使用 `scheduled` handler 统一做 cron 调度
- 使用 Queue consumer 分片查询账号配额，避免单次 Worker 超过 free plan 的 subrequest 限制
- 使用 D1 保存批次、分片结果、运行状态和汇总快照

## 数据模型

### monitor_runs
记录一次完整巡检批次：创建时间、状态、账号数、chunk 数、usage 快照、汇总结果和最终飞书文本。

### monitor_chunks
记录某次巡检的分片任务：chunk 序号、账号数、状态、错误信息、执行时间。

### quota_reports
保存每个账号在某次巡检中的结果：账号标识、状态、quota 窗口、错误信息。

### runtime_state
保存跨批次状态：最近成功时间、最近汇总时间、最近心跳时间、连续失败次数等。

## 执行流程

1. `scheduled` 每 15 分钟触发一次。
2. 检查是否到心跳时间，到则推送心跳。
3. 检查是否有未完成批次：
   - 若全部 chunk 已完成，则汇总并推送飞书。
   - 若仍有 chunk 处理中，则等待下个周期继续检查。
4. 若没有未完成批次且到了正式汇总时间，则读取 `auth-files` 和 `usage`，拆分 chunk 并入队。
5. queue consumer 逐个 chunk 查询 `/v0/management/api-call`，把结果写入 D1。
6. 汇总完成后更新 `runtime_state`，成功清零失败计数；失败则累计失败次数并在达到阈值时告警。

## 配置

必填：
- `CPA_BASE_URL`
- `CPA_MANAGEMENT_KEY`
- `FEISHU_WEBHOOK`

可选：
- `FEISHU_SECRET`
- `CHUNK_SIZE`
- `REQUEST_TIMEOUT_MS`
- `FAILURE_ALERT_THRESHOLD`
- `HEARTBEAT_INTERVAL_HOURS`
- `SUMMARY_INTERVAL_HOURS`
- `STARTUP_NOTIFICATION_ENABLED`
- `RUN_SUMMARY_ON_STARTUP`

## 安全与限制

第一版允许直接访问 `http://IP:8317`，优先解决“无服务器也能推送”的问题；后续建议升级到 Cloudflare Tunnel + HTTPS hostname + Access service token。

## 验证

- `npm run typecheck`
- `npm run test`
- `npm run check`
