# change: quant-visibility — 量化工作流可达性与热力图增强（下一阶段第二优先）

> **状态：已交付（2026-09-12）**。策略 Tab 增加「今日脉冲 + 扫描/工作流快捷入口」；热力图支持行业/概念与涨跌/成交额/成交量切换（prefs 持久化）。尾盘选股卡片流仍为后续可选。

## Why

扫描 → 候选 → 信号 → 跟单闭环已存在（`WorkflowScreen` / `ScannerScreen`），但：

- 入口在「我的」二级菜单，策略 Tab 用户看不到
- 策略 Tab 只展示策略列表，与「今日发生了什么」脱节
- 首页热力图维度单一，对比 stock-dashboard 缺行业/概念/自选切换与颜色指标

提高发现率，比再堆新策略模板 ROI 更高。

## What Changes

### 1. 策略 Tab 重组为「量化工作台」

`StrategiesScreen` 顶部增加今日摘要卡（可点进 Workflow）：

```
今日扫描 N 命中 · 候选池 M · 新信号 K · 已跟单 J
```

分区：

| 区 | 内容 | 入口 |
|---|---|---|
| 今日脉冲 | 上表数字 + 最近 3 条信号 | → Workflow / 信号详情 |
| 我的策略 | 现有策略列表 | 保持 |
| 快捷动作 | 扫描 / 回测 / 参数扫描 | → Scanner / Backtest |

「我的」中保留原入口作别名，不再作为主路径。

### 2. 工作流页减负

- 顶部 sticky 进度条：扫描中 / 空闲
- 模块间用 Chevron 路径而非并列大卡
- 扫描完成自动滚动到「候选池」段

### 3. 首页热力图多维切换（stock-dashboard）

`SectorBoard` 升级：

- 维度：行业 | 概念 | 自选（有自选时）
- 颜色指标：涨跌幅（默认）| 换手 | 量比
- 点击块 → 个股详情；维度与指标写入 `appPrefs` 持久化
- 手机交互：当前块图保留，指标切换用底部 Chip 行，不做全屏 treemap（避免 ECharts RN 成本）

### 4. 尾盘选股卡片流（可选，依赖 1–3 完成）

从 stock-dashboard 迁移「尾盘选股」为 Scanner 的一种预设：

- 过滤：市值 / 量比 / 涨幅 / 换手区间
- 卡片内嵌迷你分时（`Sparkline` 变体）
- 一键批量加自选 / 进候选池

## Impact

- Affected: `src/features/quant/StrategiesScreen.tsx` `src/features/scanner/{Scanner,Workflow}Screen.tsx` `src/features/home/SectorBoard.tsx` `src/settings/appPrefs.ts` `src/navigation/AppNavigator.tsx`
- Storage: `appPrefs` 新增 heatmap 维度/指标字段；无 DB schema 变更
- Risks: 概念板块接口若 stock-sdk 覆盖不全，先做行业+自选，概念降级隐藏

## Acceptance

1. 冷启动从策略 Tab ≤2 步进入扫描/工作流
2. 今日摘要数字与 Workflow 页一致
3. 热力图可切换维度，刷新后记住上次选择
4. 尾盘选股（若做）结果可一键进候选池
