# cliproxy-feishu-monitor-worker

Cloudflare Worker + Queues + D1 版本的 CLIProxyAPI 飞书监控器。

## 目标

- 无需额外常驻服务器
- 定时读取 CLIProxyAPI 管理接口
- 分片查询 Codex 账号 `code-5h` / `code-7d` 配额
- 汇总 Token 用量并推送到飞书
- 用 D1 持久化运行状态、批次、分片和汇总结果

## 架构

- `scheduled`：创建巡检批次、触发心跳、补做汇总
- `queue consumer`：消费账号分片并写入 D1
- `D1`：保存 `monitor_runs` / `monitor_chunks` / `quota_reports` / `runtime_state`
- `Feishu webhook`：接收汇总、心跳、异常告警

## 本地准备

```bash
npm install
npx wrangler d1 create cliproxy-feishu-monitor
npx wrangler queues create cliproxy-feishu-monitor-queue
```

把生成的 `database_id` 填回 `wrangler.jsonc`。

## 开发

```bash
npm run check
npm run dev
```

## 部署所需变量

建议用 `wrangler secret put` 或 Cloudflare Dashboard 配置：

- `CPA_BASE_URL`：例如 `http://YOUR_IP:8317`
- `CPA_MANAGEMENT_KEY`
- `FEISHU_WEBHOOK`
- `FEISHU_SECRET`（可选）

## 数据库初始化

```bash
npx wrangler d1 migrations apply cliproxy-feishu-monitor --local
npx wrangler d1 migrations apply cliproxy-feishu-monitor --remote
```

## 当前首版能力

- 定时创建巡检批次
- Queue 分片消费账号配额查询
- D1 聚合汇总
- 飞书汇总 / 心跳 / 告警
- `GET /health` 健康检查

## 后续计划

- Access / Tunnel 安全收口
- 管理接口手动触发 / 手动重试
- 更细粒度的失败重试和运行面板
