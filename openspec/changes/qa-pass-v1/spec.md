# change: qa-pass-v1 — 真机 QA 走查修复

> **状态：进行中（2026-09-17）**。

## Why

`docs/QA_CHECKLIST.md` 是每轮 UX/调度/通知变更后的真机验收清单，需在交付前逐项勾选。
本 change 记录「代码侧可提前修的问题」与「真机需人工勾选的项」，避免把明显代码缺陷留到真机才发现。

## What Changes（代码侧）

- `nlScan.matchNlScan` 运算符优先级 bug 修复（见 `screen-quality-v1`）。
- 其余清单项（Onboarding / 自选宽限 / 决策卡 / 模拟盘 PAPER 角标 / 自动化立即运行 /
  通知冷却恢复 / 涨跌色三态）依赖真机/模拟器交互，**无法在本环境自动执行**，
  仅在此登记，待真机走查时按表勾选。

## Acceptance

- 代码侧缺陷（nlScan 优先级）已修复并有单测覆盖。
- `docs/QA_CHECKLIST.md` 各项在真机走查时逐条确认（本环境仅记录，不自动执行）。
- `npm run typecheck:app && npm run test` 通过。
