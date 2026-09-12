# change: alert-lifecycle-ui — 告警生命周期可视化与退避接入（下一阶段第二优先）

> **状态：已交付（2026-09-12）**。。`alertLifecycle` 模块已实现冷却/过期，但 AlertRules UI 未展示状态；poller 退避 API 未真正改 interval。

## Why

用户看不到「这条规则为什么最近不响了」（冷却/已触发/过期），也无一键恢复。同时 `recordBackoffFailure` 已有 API，轮询仍固定 15s，源失败时浪费配额。

## What Changes

### 1. AlertRules 分组

| 组 | 内容 | 操作 |
|----|------|------|
| 生效中 | status=active | 编辑/停用 |
| 已触发 | triggered + 触发时间 + 静默剩余秒 | 重新启用（清冷却） |
| 已过期 | expired | 删除或延期 |

行内副标题：`上次通知 14:32 · 冷却 120s` 或 `已过期`。

### 2. 一键恢复

`reenableLifecycle(ruleId, symbolKey)` 已有；UI 增加「恢复通知」。

### 3. Poller 真正接入退避

- `WatchlistPoller.start()`：interval 从 `getBackoff('watchlist')` 读取
- fetchQuotes 失败 → `recordBackoffFailure`，下一轮拉长
- 成功 → `recordBackoffSuccess`
- tick 末尾 `setInterval` 动态重排（清旧 timer 换新 delay）

### 4. 创建告警预填价（OpenStock）

AlertRules 新建：若有 symbol，先拉 quote，阈值默认 `last * 1.05` / `* 0.95`。

## Impact

- Affected: `AlertRulesScreen.tsx` `poller.ts` `alertLifecycle.ts` `userAlertRules.ts`
- Risks: 退避导致漏报 — 设置页展示当前轮询间隔

## Acceptance

1. 已触发规则在列表可见静默剩余，可恢复
2. 模拟源失败后轮询间隔变长，恢复后回落
3. 新建价格告警预填合理阈值
