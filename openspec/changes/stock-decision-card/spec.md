# change: stock-decision-card — 个股决策卡（评分分档 + 论点/风险）（下一阶段第六优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。对标 Opptrix `StockDecisionCard`：把综合分翻译成人话决策摘要，解决「只有数字看不懂为什么」。

## Why

信号引擎与策略综合分已有输出，但个股详情/信号列表只展示分数或买/卖 Tag。用户需要：

- 这只票 **整体偏多还是偏空**？强弱档位？
- **为什么**（最多 3 条论点）？
- **风险是什么**？
- 图例说明：评分基于哪些因子（免责）

Opptrix 用决策卡把 scoreGrade + thesis/risks + legend 一次给清；本变更在 RN 复刻该信息架构（不抄其 UI 代码）。

## What Changes

### 1. 评分分档纯函数

```ts
scoreGrade(score: number): 'A' | 'B+' | 'B' | 'C' | 'D'
// 映射示例：≥2.2 A / ≥1.2 B+ / ≥0.3 B / ≥-0.8 C / 其余 D
```

+ `summarizeStrategy(signals)`：偏多/中性/偏空 + 多空计数  
+ `pickThesis / pickRisks`：从因子贡献/信号解释抽最多 3 条短句（中文模板）

### 2. `DecisionCard` 组件

布局：

```
[ A ]  综合评分 2.4          策略偏多 (4多 / 1空)
行业 · 评分档 · 策略倾向
• 论点1
• 论点2
────────────────
风险：• 风险1
评分基于价值/质量/成长/动量…（legend，次要色）
```

- 档位色与涨跌色解耦（A 绿系 / D 红系可映射 primary/down，但不直接用 up/down 数字色）
- 数据不足时显示「信号不足」空态

### 3. 接入点

| 位置 | 行为 |
|------|------|
| `StockDetailScreen` | 报价区下方第一张卡 |
| 信号列表 / 候选池行 | 点开 BottomSheet 展示同一卡 |
| 工作流候选 | 简化一行：档位 + 一句 thesis |

### 4. 数据来源

- 复用 `quant` 现有 composite / signals / factor 贡献，**无新后端**
- 本地缓存：`toFullCode` → 最近一次决策摘要（TTL 15min）

## Impact

- Affected: 新 `src/features/stock/DecisionCard.tsx` `src/quant/decisionCard.ts` `StockDetailScreen` `WorkflowScreen` / 候选池
- Risks: 论点模板勿写成投资建议口吻；legend 必须常驻

## Acceptance

1. 详情页决策卡显示档位、倾向、≤3 论点、≤2 风险、legend
2. 分数变化时档位与摘要随之更新
3. 数据不足有明确空态，不崩
4. 无「必涨/必跌」类表述
