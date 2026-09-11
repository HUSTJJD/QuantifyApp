# change: alert-notify-harden — 告警生命周期与通知扇出硬化（下一阶段第四优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。对标 streetmerchant（通知扇出 / 指数退避 / 命中冷却）与 OpenStock（告警 active/triggered/expiresAt）。当前仅有应用内 Snackbar + 固定间隔轮询。

## Why

盯盘与盘后摘要已能「响」，但：

1. **同一规则反复刷屏** — 无命中冷却；价格在阈值附近抖动会连环 notify
2. **告警无生命周期** — 触发后仍可能再触发；无过期；无「已触发」状态可回看
3. **单通道** — 只有应用内；无法 Telegram/Bark/Webhook 外推（streetmerchant 式扇出）
4. **轮询无退避** — 源 429/超时仍固定 5s 拉，浪费配额且易被限

本变更不改业务规则语义，只把「响得准、不吵、可外送」做硬。

## What Changes

### 1. 告警生命周期状态机（OpenStock）

`userAlertRules` / 规则实体扩展：

```ts
status: 'active' | 'triggered' | 'expired' | 'disabled'
triggeredAt?: number
expiresAt?: number   // 默认创建 +90 天
lastNotifiedAt?: number
cooldownSec?: number // 默认 300
```

- 触发后：`status=triggered` + `triggeredAt`；是否自动 disable 可配（默认保留但冷却）
- 到 `expiresAt` → `expired`，轮询跳过
- AlertRules 页分组展示：生效中 / 已触发 / 已过期

### 2. 命中冷却（streetmerchant IN_STOCK_WAIT_TIME）

- 同一 `ruleId + symbolKey` 冷却窗口内不再 notify（默认 300s，可 per-rule）
- 冷却记在内存 + `alertHistory`（`lastNotifiedAt`）
- 盘后摘要不受冷却影响（汇总类）

### 3. 通知扇出插件化（streetmerchant messaging）

```
src/features/notify/
  channels/
    inApp.ts          // 现 AlertCenter / Snackbar
    localPush.ts      // 系统本地通知（dev build；无模块则 no-op）
    webhook.ts        // 用户可选：Telegram bot / Bark / 通用 JSON
  fanout.ts           // sendNotify(payload) → 按 prefs 逐通道；失败互不影响
```

- 设置页「通知通道」：应用内（默认开）、系统通知、Webhook URL（可测发）
- `DigestBridge` / 价格告警统一走 `fanout`
- 通道未配置 → 静默跳过（对齐 streetmerchant）

### 4. 轮询指数退避

`watchlist/poller.ts` / QuoteFeed per-source 状态：

- 连续失败或 429：间隔 ×2（上限如 60s）
- 成功：减半回默认
- 设置页改 interval 后 **可重启 poller** 且无重复 timer（runtime-control 思路）

### 5. 创建告警预填现价（OpenStock）

- AlertRules「新建」若带 symbol：先拉 quote，阈值默认现价 ±N%
- 减少误填

## Impact

- Affected: `src/features/watchlist/{alerts,userAlertRules,poller,AlertRulesScreen}.tsx/ts` `src/features/notify/*` `src/data/QuoteFeed.ts` `src/settings/appPrefs.ts`（通道 prefs）
- Storage: 规则 schema 字段扩展（向后兼容默认值）；webhook URL 仅本地存
- Native: 系统通知需 dev build；Webhook 为纯 HTTPS fetch
- Risks: 冷却导致漏报 — 设置页明确展示静默剩余；不实现任何自动交易/代下单

## Acceptance

1. 同一规则触发后冷却期内不再弹；冷却结束可再响
2. 规则可在「已触发」列表回看；90 天后过期不再计入
3. 开启 Webhook 试发可收到 JSON；失败不影响应用内通知
4. 人为制造源失败时轮询间隔拉长，恢复后回落
5. 无任何自动下单/跳转券商下单动作

## 关联提案

- 承接 `onboarding-notify` 的触达层
- `eod-picker-cards` 的尾盘提示走同一 fanout
