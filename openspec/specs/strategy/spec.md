# strategy — 策略引擎

## Purpose

多因子框架：因子可注册、可调参，策略=因子规则组合（DSL）。代码独立于 `src/strategies/`。

## Requirements

### R1 策略档案（Profile）

**用户**：想保存多套策略，并开关、调参。

**规则**
- `StrategyProfile` = 模板 id + 选股 + 信号参数 + 止盈止损 + 交易规则
- 同模板只允许一个档案（保证信号配置可映射）
- 持久化到 SQLite `strategy_profile` 表

**验收**
- 新建/编辑/删除档案后重启 App 仍在
- `enabled=false` 的策略不产出信号

### R2 信号内核可组合（多因子框架）

**规则**
- **因子注册表**（`src/strategies/factors/`）：ma_cross / macd / rsi / volume_ratio / breakout / bollinger / ma_trend
  - 每个因子输出 `score[-1,1]` + reason + 可选 triggered
  - 每个因子带 `FactorParamDef[]`，可调参
- **规则 DSL**：score 比较 / triggered 事件 / cross 交叉，AND/OR 组合
- **引擎**：`evaluateStrategy(template, candles)`
- **内置模板**（3 个精选，默认 trend_confirm）：
  - 趋势确认：MA金叉 + MACD偏多 + RSI<60 + 放量
  - 超卖反弹：RSI超卖 + 放量 + 均线不空头
  - 突破动量：N日新高 + 强放量 + 均线多头
- 多模板加权合并为最终 `TradeSignal`

**验收**
- 默认只启用 trend_confirm
- 「MA金叉 AND 放量」在金叉+放量时触发，仅金叉不触发
- 新增因子只需在注册表加一个 FactorDef

### R3 选股规则

**规则**
- 范围：自选股池（v0）；后续扩展全市场扫描池
- 过滤：价格上限、最小成交额、涨幅、RSI 区间等
- 选股结果喂给信号内核

**验收**
- `priceMax=100` 时，100 元以上标的不进入候选

### R4 风控规则

**规则**
- 止盈 / 止损百分比
- 移动止损距离
- 最大同时持仓数、单笔仓位比例
- 允许交易时段（早盘 / 盘中 / 尾盘 / 全天）

**验收**
- 触发止损后模拟盘自动平仓
- 非允许时段不自动下单

## 未来需求

- [ ] 策略模板市场（导入/导出 JSON）
- [ ] 多标的组合策略
- [ ] 条件单（价格触发后挂限价）
- [ ] AI 辅助生成策略规则
