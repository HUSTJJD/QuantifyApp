---
feature: composite-only-strategy
status: designed
updated: 2026-09-11
branch: main
commits: # filled at delivery
---

# 唯一内置组合策略

## Report

## [S1] Problem

注册表里有 6 个单指标策略（MA金叉、MACD、RSI、突破、布林、量价背离）+ 4 个组合预置，互相独立投票后加权求和。单指标策略噪音大、假信号多；多个策略同时开启时互相干扰，用户难以理解「为什么买」。需要收敛为**一个精心设计的组合策略**作为唯一内置策略。

## [S2] Design

### 唯一内置策略：`trend_confirm`（趋势确认）

**买入**（AND，全部满足）：
1. MA5 上穿 MA20（金叉）
2. RSI14 < 60（未超买）
3. 量比 ≥ 1.2（volume / 5日均量）
4. 收盘价 > MA60（长期趋势向上）

**卖出**（OR，任一满足）：
1. MA5 下穿 MA20（死叉）
2. RSI14 > 70（超买）

**强度**：买 2 / 卖 -2；理由自动生成（如「MA金叉+RSI<60+放量+趋势向上」）。

### 注册表变更

- `STRATEGIES` 仅含 1 项：`trend_confirm`
- 移除：`ma_cross`、`macd_cross`、`rsi`、`breakout`、`bollinger_breakout`、`volume_price_divergence`
- 移除 `COMPOSITE_PRESETS` 中除趋势确认外的 3 个预置（MACD趋势/超卖反弹/突破回踩）
- 保留 `composite.ts` 引擎（IndicatorSnapshot / Condition / evaluateComposite），供用户自定义

### 兼容

- 旧 profile 的 `templateId` 若指向已删除策略，`templateById` 返回 undefined → 信号引擎跳过（已有 try/catch）
- `StrategyConfig.enabled` 对未知 id 忽略
- 测试期望 `STRATEGIES.length === 1`

### 依赖文件

- `src/quant/composite.ts`：实现 trend_confirm 定义 + evaluateComposite
- `src/quant/strategies.ts`：注册表只导出 trend_confirm
- `src/quant/profile.ts`：createProfileFromTemplate 自动跟随新模板
- `__tests__/composite.test.ts` / `__tests__/quant.test.ts`：更新断言

## [S3] Out of Scope

- 策略编辑 UI / 可视化规则编排
- 回测参数扫描
- 移动止损等风控（已有独立规则）

## Tasks

- [ ] T1: composite.ts 定义 TREND_CONFIRM（AND 买 / OR 卖）并只导出该预置 — acceptance: COMPOSITE_PRESETS 仅 1 项，evaluateComposite 在金叉+放量+趋势向上时出 buy (covers: S2)
- [ ] T2: strategies.ts 注册表收敛为 1 项 trend_confirm — acceptance: STRATEGIES.length===1，id==='trend_confirm'，label 可读 (covers: S2; depends: T1)
- [ ] T3: 更新单测 — acceptance: composite/quant 测试全过，策略数断言为 1 (covers: S2; depends: T2)
- [ ] T4: 全量回归 tsc + yarn test — acceptance: 无新增失败 (covers: S2; depends: T3)
