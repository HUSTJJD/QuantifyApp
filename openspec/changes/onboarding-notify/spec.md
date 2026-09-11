# change: onboarding-notify — 首启引导与盘后摘要（下一阶段第三优先）

> **状态：已交付（2026-09-12）**。首启 3 屏（市场/风格/通知）+ 盘后摘要调度（应用内 AlertCenter 触达，接口预留系统通知）+ 设置页开关/试发/重跑引导。厂商推送仍后置。

## Why

新用户打开 App 只有空自选 + 行情，不知道「量化工作流从哪开始」；老用户收盘后也无主动触达，扫描/信号依赖手动回来看。

OpenStock 用 onboarding 问卷 + cron 邮件摘要解决同类问题；RN 侧用本地通知即可覆盖 80% 价值，无需先上推送证书/厂商通道。

## What Changes

### 1. 首启 Onboarding（3 屏，可跳过）

仅首次启动（`appPrefs.hasOnboarded=false`）展示：

| 屏 | 采集 | 落地 |
|---|---|---|
| 1 市场 | 主战场：A / 港 / 美（可多选） | 默认指数、搜索优先级 |
| 2 风格 | 稳健 / 平衡 / 进取 | 推荐策略模板 + 默认仓位上限 |
| 3 提醒 | 开启盘后摘要？价格告警？ | 本地通知权限请求 |

完成后：

- 预置 1 个推荐策略（按风格从现有模板选）
- 写入 `hasOnboarded=true`
- 「我的 → 设置」可重开引导

**非目标**：不做账号体系、不做云端画像。

### 2. 盘后本地摘要通知

交易日 15:10（可配）本地通知，内容聚合：

- 今日扫描命中数 + Top3 代码
- 持仓异动（涨跌超阈值 / 触及止盈止损）
- 新信号条数

实现：

- `expo-notifications`（或现有等价物）调度本地通知
- 权限未开 → 设置页红点引导
- 深链：点通知进 `Workflow` 或 `Alert` 相关页

### 3. 设置项对齐

「我的 → 设置」增加：

- 盘后摘要开关 / 时间
- 通知权限状态与一键去系统设置
- 重跑 Onboarding
- （对齐 OpenStock）货币展示、基准指数（若尚未有）

### 4. 价格告警触达升级（依赖 2）

现有 `alertCenter` 轮询命中时，从站内红点升级为本地通知（可关）：

- 标题：标的 + 条件
- 正文：现价 / 触发值

## Impact

- Affected: 新 `src/features/onboarding/` `src/settings/appPrefs.ts` `src/features/mine/MineScreen.tsx` `src/features/watchlist/alertCenter.tsx` `src/features/scanner/WorkflowScreen.tsx`（深链）`App.tsx`（首启门）
- Storage: `appPrefs` 新增 `hasOnboarded / marketPrefs / riskStyle / notifyDigest / notifyDigestTime / notifyPriceAlert`
- Native: 本地通知需 dev build；Expo Go 受限 — 实现阶段用 mock 开关保 UI 可测
- Risks: Android 通知渠道与后台限制；摘要计算需在前台/被唤醒时补算，不依赖精确后台任务

## Acceptance

1. 首启完整走完 3 屏或跳过，二次启动不再出现
2. 风格选择影响预置策略模板
3. 开启摘要后，交易日可收到含扫描/信号数字的本地通知（真机）
4. 通知点击能落到对应业务页
5. 权限拒绝时设置页有明确恢复路径
