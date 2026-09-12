# change: quality-gates — 真机验收清单与自动化门禁（下一阶段收尾）

> **状态：已交付（2026-09-12）**。。多轮 UX/调度/通知变更后需要统一验收与防回归。

## Why

`npm run typecheck` 被 stock-sdk 测试噪音污染；真机路径（Swipeable、通知、调度）无清单。交付「看起来完成」但未验证的风险高。

## What Changes

### 1. typecheck 脚本分层

```json
"typecheck:app": "tsc -p tsconfig.app.json --noEmit",
"typecheck:all": "npm run typecheck"
```

`tsconfig.app.json` 仅 `src/**` + `App.tsx` + `__tests__`，exclude `stock-sdk`。

### 2. 验收清单 `docs/QA_CHECKLIST.md`

| 域 | 用例 |
|----|------|
| 启动 | Onboarding 可跳过/完成；二次启动不再出现 |
| 自选 | 滑动删除、Sparkline、雷达行、分组摘要 |
| 详情 | 决策卡档位/论点；K 线周期 |
| 扫描 | 套餐扫描出卡片；加自选；快照进工作流 |
| 模拟 | PAPER 角标；净值曲线；重置 |
| 自动化 | 立即运行 digest/eod；run 历史 |
| 通知 | 应用内 snackbar；Webhook 试发 |
| 主题 | 暗/亮 + 涨跌色切换（若 trade-colors 已交付） |

### 3. CI/本地 `npm run validate`

固定：`typecheck:app` + lint + jest（现有）。

### 4. 快照基线（可选）

对 Main/Watchlist/Asset 关键屏做截图基线（后续）。

## Impact

- Affected: `package.json` scripts `tsconfig.app.json` 新 `docs/QA_CHECKLIST.md`
- Risks: 无

## Acceptance

1. `npm run typecheck:app` 在无 stock-sdk 噪音下干净通过
2. 清单覆盖已交付 change 的关键路径
3. `validate` 一键可跑
