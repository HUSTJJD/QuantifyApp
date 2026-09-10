# change: signal-to-trade-loop — 扫描→信号→模拟→跟单闭环（第三优先）

## Why

功能已分散存在，但没有一条「发现机会 → 产生信号 → 模拟验证 → 手动实盘」的完整路径。闭环后 App 才真正有量化工作流价值。

## What Changes

### 1. 每日扫描任务

- 收盘后自动跑本地全市场扫描（可开关）
- 结果写入 `scan_snapshot` 表，可回看历史扫描

### 2. 候选池 → 信号

- 扫描命中标的进入「候选池」
- 候选池自动订阅信号引擎
- 信号出现时高亮 + 可选告警

### 3. 信号 → 模拟盘

- 一键跟单已有；补充「候选池批量跟单」（按仓位上限）
- 跟单结果回写信号状态（已跟 / 跳过 / 失败）

### 4. 模拟 → 同花顺

- 跟单成功自动跳 `10jqka://stock/detail`
- 详情页保留手动「同花顺」入口

### 5. 工作流页

新 Tab「工作流」：
```
今日扫描 → 候选 N 只 → 信号 M 条 → 已跟单 K 笔 → 模拟盘盈亏
```

## Impact

- Affected: `quant/scanner.ts` `quant/remoteScreen.ts` `simulation/follow.ts` `features/scanner` 新增工作流页
- Storage: 新增 `scan_snapshot` 表

## Acceptance

1. 一键「今日扫描」出候选列表
2. 候选池信号可见
3. 一键跟单进模拟盘并跳同花顺
4. 工作流页数字与各模块一致
