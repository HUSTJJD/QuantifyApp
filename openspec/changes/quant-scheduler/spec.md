# change: quant-scheduler — 统一本地任务调度与运行历史（下一阶段第五优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。对标 Opptrix `packages/schedule`（once/interval/cron + run 历史 + per-job notify）。当前盘后摘要、尾盘扫描（提案）、后台同步、策略自动交易各自散落定时逻辑。

## Why

产品里「会自己跑」的任务越来越多：

| 任务 | 现状 |
|------|------|
| 盘后摘要 | `localDigest` 自写 setInterval |
| 尾盘扫描 | `eod-picker-cards` 拟再写一套定时 |
| 全市场/日 K 同步 | `scheduleBackgroundSync` |
| 策略自动交易 | QuoteFeed 时段触发 |
| 告警轮询 | `watchlist/poller` |

各自为政导致：设置入口分散、失败不可见、通知策略不一致、无法「计划—进度—结果」回看（Opptrix scheduled-jobs 体验）。

本变更抽一层**本地任务调度内核**，业务只注册 job kind。

## What Changes

### 1. 任务模型（对齐 Opptrix ScheduledJob）

```ts
type JobKind = 'eod_scan' | 'digest' | 'market_sync' | 'alert_poll' | 'strategy_tick' | string;
type ScheduleKind = 'once' | 'interval' | 'cron';

interface ScheduledJob {
  id: string;
  kind: JobKind;
  title: string;
  enabled: boolean;
  scheduleKind: ScheduleKind;
  schedule: { run_at?: string; every_sec?: number; anchor?: string; expression?: string };
  notifyOverride?: 'default' | 'silent' | 'on_ok' | 'on_error' | 'all';
  payload?: Record<string, unknown>;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastStatus?: 'ok' | 'error' | 'running' | null;
}

interface JobRun {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'ok' | 'error';
  trigger: 'manual' | 'schedule';
  summary?: string;
  error?: string;
}
```

- 轻量 cron：5 段 `分 时 日 月 周`（可移植 Opptrix `next-run.ts` 逻辑，或自写极简版）
- interval 下限 30s；防重入（同 job 运行中跳过）

### 2. Runner 服务

- 注册表：kind → `executor(job, run) => Promise<{ summary }>`
- 前台可跑；应用恢复前台时补算到期 job（对齐 digest 现状）
- 运行写 `job_runs`（SQLite 或 KV 列表，保留最近 N=50/job）

### 3. 内置迁移

| kind | 迁自 |
|------|------|
| `digest` | `localDigest` |
| `eod_scan` | eod-picker（交付后） |
| `market_sync` | `scheduleBackgroundSync` |
| `alert_poll` | 可选纳入（仍可独立） |

业务代码改为 `registerJobKind` + `runJobNow`，不再自建 timer。

### 4. 设置页「自动化」

- 列表：标题 / 节奏 / 下次运行 / 上次状态（绿点/红点）
- 详情：开关、通知策略、立即运行、最近 10 条 run（summary + 错误）
- 与 `alert-notify-harden` fanout 共用：run ok/error 按 `notifyOverride` 推送

### 5. 策略 Tab 脉冲联动

- 「今日脉冲」旁显示最近 job 摘要（如「尾盘扫描 14:30 ok · 命中 6」）
- 点击进入自动化列表

## Impact

- Affected: 新 `src/quant/scheduler/{types,nextRun,service,runner}.ts` `src/features/settings/AutomationScreen.tsx` 改造 `notify/localDigest.ts` `data/sync/scheduler.ts` `AppNavigator`
- Storage: `scheduled_jobs` + `job_runs` 表（或 QuantStore 扩展）
- Risks: 双写旧 timer — 迁移时删除旧 interval；Android 后台仍受限，以「前台补算」为主，不承诺精确闹钟

## Acceptance

1. 设置页可看到 digest/sync 的下次运行与最近 run
2. 「立即运行」产生 run 记录与 summary
3. 停用 job 后不再触发
4. 同 kind 不重入（运行中 skip）
5. eod_scan 接入后无需第二套定时代码

## 关联

- 依赖/衔接：`eod-picker-cards`、`alert-notify-harden`、`onboarding-notify`
- Opptrix 源：`packages/schedule/src/{service,runner,notify,next-run}.ts`
