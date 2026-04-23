# cliproxy-feishu-monitor-worker

A **Cloudflare Workers + Queues + D1** project for monitoring CLIProxyAPI quota usage and pushing aggregated status updates to a Feishu bot.

> 中文说明请看 [README.md](./README.md)

---

## Highlights

- **No dedicated server required**
- **Queue-based sharding** for monitoring large account sets
- **D1 persistence** for runs, chunks, quota reports, and runtime state
- **Feishu notifications** for summaries, heartbeats, and failures
- **Manual control endpoint** for on-demand polling
- **Expandable** toward Tunnel, Access, and custom domains later

---

## Architecture

### `scheduled`
Responsible for:
- startup notifications and heartbeats
- creating new monitoring runs
- checking whether active runs are complete
- finalizing summaries and pushing Feishu messages

### `queue consumer`
Responsible for:
- processing one quota chunk at a time
- calling the CLIProxyAPI management endpoints
- collecting `code-5h` / `code-7d` status per account
- writing results into D1

### `D1`
Stores:
- `monitor_runs`
- `monitor_chunks`
- `quota_reports`
- `runtime_state`

---

## Required Secrets

- `CPA_BASE_URL`
- `CPA_MANAGEMENT_KEY`
- `FEISHU_WEBHOOK`
- `FEISHU_SECRET` (optional)
- `MANUAL_TRIGGER_TOKEN`

### Upstream URL note

Prefer a hostname instead of a raw IP.  
If you only have `http://IP:port`, a hostname wrapper such as the following may help:

```text
http://YOUR_IP.sslip.io:8317/management.html#/login
```

Long-term, a custom domain or Cloudflare Tunnel + HTTPS hostname is the cleaner option.

---

## Required Variables

- `CHUNK_SIZE`
- `REQUEST_TIMEOUT_MS`
- `FAILURE_ALERT_THRESHOLD`
- `HEARTBEAT_INTERVAL_HOURS`
- `SUMMARY_INTERVAL_HOURS`
- `STARTUP_NOTIFICATION_ENABLED`
- `RUN_SUMMARY_ON_STARTUP`

---

## D1 / Queue setup

```bash
npx wrangler d1 create cliproxy-feishu-monitor
npx wrangler queues create cliproxy-feishu-monitor-queue
npx wrangler d1 migrations apply cliproxy-feishu-monitor --local
npx wrangler d1 migrations apply cliproxy-feishu-monitor --remote
```

Then update `wrangler.jsonc` with the generated `database_id`.

---

## Local development

```bash
npm install
npm run check
npx wrangler dev
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

---

## Admin endpoint

### Trigger one monitoring cycle manually

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_MANUAL_TRIGGER_TOKEN" \
  "https://cliproxy-feishu-monitor-worker.wanggejiancai822.workers.dev/admin/tick"
```

Possible results:
- `started`
- `waiting_for_chunks`
- `finalized`
- `run_failed`

For large account sets, multiple calls may be needed to complete a full run lifecycle.

---

## Feishu notification content

Current messages include:
- status overview
- account status distribution
- token usage across 7h / 24h / 7d / all-time windows
- heartbeat / failure alerts

---

## Best fit

Best for:
- existing CLIProxyAPI deployments
- quota monitoring in a serverless setup
- larger account sets needing chunked execution
- Feishu-centric operational notifications

Less ideal for:
- offline-only environments
- strict real-time requirements
- setups that cannot expose the management API as an upstream origin

---

## Risks and limitations

- Raw-IP upstreams are less compatible than hostname-based ones
- Parser logic must track upstream management payload changes
- Very large account sets will still need stronger retry/observability improvements
- Auto-deploy should be treated as work-in-progress until fully stabilized

---

## Roadmap

- stronger retry strategy
- run/chunk status query endpoints
- custom-domain setup
- final deployment automation cleanup
- fuller public-repo documentation
