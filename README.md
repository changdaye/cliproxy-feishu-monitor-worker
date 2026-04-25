# cliproxy-feishu-monitor-worker

一个基于 **Cloudflare Workers + Queues + D1** 的 CLIProxyAPI 配额监控项目。  
它会定时读取 CLIProxyAPI 管理接口中的 Codex 账号状态与 Token 用量，把汇总结果推送到飞书，并把运行状态持久化到 D1。

> English version: see [README.en.md](./README.en.md)

---

## 项目特点

- **无需额外常驻服务器**：运行在 Cloudflare Workers
- **队列分片查询**：适合 100+ 账号规模的配额巡检
- **D1 持久化**：保存运行批次、分片结果、账号状态与汇总快照
- **飞书通知**：支持汇总、心跳、异常提醒
- **手动控制**：支持手动触发一轮巡检
- **可扩展**：后续可接 Tunnel / Access / 自定义域名

---

## 当前状态

当前版本已经完成：

- 定时调度（Cron）
- Queue 分片执行
- D1 批次 / 分片 / 报表存储
- CLIProxyAPI 配额抓取
- Token 用量汇总
- 飞书汇总、心跳、异常告警
- 手动触发接口
- Admin Bearer Token 鉴权

当前版本还没有加入：

- 自定义域名
- 更强的失败重试策略
- 图形化管理面板
- 自动部署工作流的最终稳定收尾

---

## 架构说明

### 1. `scheduled`
负责：
- 触发启动通知 / 心跳
- 创建新巡检批次
- 检查已有批次是否完成
- 在批次完成后汇总并推送飞书

### 2. `queue consumer`
负责：
- 逐个处理账号分片
- 请求 CLIProxyAPI 管理接口
- 查询每个账号的 `code-5h` / `code-7d`
- 把结果写入 D1

### 3. `D1`
保存以下数据：
- `monitor_runs`
- `monitor_chunks`
- `quota_reports`
- `runtime_state`

---

## 运行所需 Secrets

需要在 Cloudflare Worker 中配置以下 secrets：

- `CPA_BASE_URL`
- `CPA_MANAGEMENT_KEY`
- `FEISHU_WEBHOOK`
- `FEISHU_SECRET`（可选）
- `MANUAL_TRIGGER_TOKEN`

### 源站地址说明

建议优先使用 **hostname**。  
如果你目前只有 `http://IP:端口`，可先用类似下面的形式包装成可解析主机名：

```text
http://YOUR_IP.sslip.io:8317/management.html#/login
```

这样能避免 Worker 直接访问裸 IP 时出现兼容问题。  
长期更稳妥的方案仍然是：
- 绑定自己的域名
- 或使用 Cloudflare Tunnel + HTTPS hostname

---

## 运行所需 Variables

可在 `wrangler.jsonc` 或 Dashboard 中配置：

- `CHUNK_SIZE`
- `REQUEST_TIMEOUT_MS`
- `FAILURE_ALERT_THRESHOLD`
- `HEARTBEAT_INTERVAL_HOURS`
- `SUMMARY_INTERVAL_HOURS`
- `STARTUP_NOTIFICATION_ENABLED`
- `RUN_SUMMARY_ON_STARTUP`

---

## D1 / Queue 初始化

```bash
npx wrangler d1 create cliproxy-feishu-monitor
npx wrangler queues create cliproxy-feishu-monitor-queue
npx wrangler d1 migrations apply cliproxy-feishu-monitor --local
npx wrangler d1 migrations apply cliproxy-feishu-monitor --remote
```

然后把生成的 `database_id` 回填到 `wrangler.jsonc`。

---

## 本地开发

```bash
npm install
npm run check
npx wrangler dev
```

本地健康检查：

```bash
curl http://127.0.0.1:8787/health
```

---

## Admin 接口

### 手动触发一轮巡检

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_MANUAL_TRIGGER_TOKEN" \
  "https://cliproxy-feishu-monitor-worker.qingjiaowochangdaye.workers.dev/admin/tick"
```

返回值可能包括：

- `started`：已创建 run 并把 chunk 入队
- `waiting_for_chunks`：已有 run 在跑，等待分片完成
- `finalized`：已完成汇总并推送飞书
- `run_failed`：某些 chunk 执行失败

对于大账号量场景，通常需要多次调用才能看到一次完整闭环：
- 第一次：启动 run
- 中间：等待 queue consumer 消费
- 最后：再次调用完成汇总和飞书推送

---

## 飞书通知内容

当前推送内容包括：
- 状态概况
- 账号状态分布
- 7 小时 / 24 小时 / 7 天 / 累计 Token 用量
- 异常提醒 / 心跳信息

---

## 适用场景

适合：
- 已经在使用 CLIProxyAPI
- 想把账号配额巡检迁到无服务器环境
- 账号数量较多，需要分片执行
- 希望统一收到飞书机器人通知

不太适合：
- 完全离线环境
- 极端实时性要求
- 不希望把管理接口暴露为可访问上游

---

## 当前风险与限制

- 如果上游只有裸 IP，Worker 访问兼容性会差一些
- 管理接口数据结构变化时，解析逻辑需要同步调整
- 极端大规模账号场景下，还需要进一步增强重试和观测
- 自动部署链路目前仍建议先人工确认稳定后再完全依赖

---

## Roadmap

后续建议继续补：

- 更强的失败重试策略
- 最近 run / chunk 状态查询接口
- 自定义域名与更稳定的入口配置
- 自动部署工作流最终收尾
- 更完整的公开仓库文档与英文说明
