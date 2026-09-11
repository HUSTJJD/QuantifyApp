# change: screen-quality-v1 — 选股扫描提质（下一轮）

> **状态：已完成（2026-09-17）**。

## Why

`nl-scan-entry` 已交付，但 NL 关键词覆盖仍薄（仅 5 条意图），且 `matchNlScan` 存在运算符优先级 bug：
`kw.includes(k) || k.includes(kw) && kw.length >= 2` 中 `&&` 优先，导致短词匹配逻辑与注释不符。
候选池 `candidatePool` 只按信号强度排序，缺一个可复用的「综合打分」函数，UI 多处重复排序逻辑。

## What Changes

### 1. `src/quant/nlScan.ts` 关键词扩展 + 修复

- 修复 `matchNlScan` 的运算符优先级 bug（显式括号）。
- 新增意图：缩量、死叉、空头、突破、新低、站上/跌破均线、低估值、高股息、北向、涨停、跌停、业绩预增、小盘、次新、止跌企稳、量价齐升。
- 复合意图（如「放量突破」「均线多头排列」）命中更具体套餐。
- 更新 `NL_SCAN_HINTS` 与单元测试（覆盖匹配与否定例）。

### 2. `src/quant/candidatePool.ts` 综合打分

- 新增 `scoreCandidate(item, opts)`：按 `changePct`、理由覆盖度、强度（如有）合成 0~100 分。
- 新增 `rankCandidatePool(items, opts)`：去重后按分数降序，UI 可复用。
- 单测覆盖打分与排序。

## Acceptance

- 输入「缩量」「业绩预增」「低估值」等出现对应扫描卡片。
- `matchNlScan` 单字/短词不再误匹配（否定例通过）。
- `rankCandidatePool` 按分数降序，分数口径稳定。
- `WorkflowScreen`「候选池」步骤按综合评分降序，且每行展示「评分」徽标（≥70 绿 / ≥40 黄 / 其余灰）。
- `npm run typecheck:app && npm run test` 通过。
