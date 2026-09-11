# OpenSpec 索引

```
openspec/
├── project.md                          项目背景 / 能力地图
├── specs/
│   ├── market-data/spec.md             行情数据层
│   ├── watchlist/spec.md               自选
│   ├── strategy/spec.md                策略引擎
│   ├── signals/spec.md                 信号
│   ├── backtest/spec.md                回测
│   ├── simulation/spec.md              模拟盘
│   ├── screening/spec.md               选股扫描
│   ├── follow-trade/spec.md            一键跟单
│   └── alerts/spec.md                  告警
└── changes/                            变更提案
    ├── strategy-maturity/spec.md       ① 策略引擎成熟化
    ├── backtest-trust/spec.md          ② 回测可信化
    ├── signal-to-trade-loop/spec.md    ③ 扫描→信号→模拟→跟单闭环
    ├── mobile-surface-v1/spec.md       ④ 移动端外观与交互打磨
    ├── quant-visibility/spec.md        ⑤ 量化工作流可达性 + 热力图
    ├── onboarding-notify/spec.md       ⑥ 首启引导 + 盘后摘要
    ├── portfolio-attribution-v2/spec.md ⑦ 组合行业归因 + 基准对比（待交付）
    ├── eod-picker-cards/spec.md        ⑧ 尾盘选股卡片流（待交付）
    ├── sim-paper-deep/spec.md          ⑨ 模拟盘绩效 + PAPER 隔离（待交付）
    ├── alert-notify-harden/spec.md     ⑩ 告警生命周期 + 通知扇出（待交付）
    ├── quant-scheduler/spec.md         ⑪ 统一本地任务调度（待交付）
    ├── stock-decision-card/spec.md     ⑫ 个股决策卡
    ├── watchlist-radar-line/spec.md    ⑬ 自选雷达行 + 报价宽限
    ├── trade-colors-prefs/spec.md      ⑭ 涨跌色可配置
    ├── alert-lifecycle-ui/spec.md      ⑮ 告警生命周期 UI + 退避
    ├── sim-trade-timeline/spec.md      ⑯ 成交时间线 + 雷达强化
    ├── quality-gates/spec.md           ⑰ typecheck:app + QA 清单
    └── regime-recommend-chips/spec.md  ⑱ 市况推荐 chips
```

外部参考项目见 `docs/references/REFERENCE_PROJECTS.md`。真机清单见 `docs/QA_CHECKLIST.md`。

## 开发顺序建议

| 阶段 | 变更 | 状态 |
|---|---|---|
| 1–13 | 策略闭环 → UX → 归因/调度/决策卡 | 已交付 |
| 14 | trade-colors-prefs | 已交付 |
| 15 | alert-lifecycle-ui | 已交付 |
| 16 | sim-trade-timeline | 已交付 |
| 17 | quality-gates | 已交付 |
| 18 | regime-recommend-chips | 已交付 |

> 建议：`quant-scheduler` 可与 10/12 同期做内核；`stock-decision-card` 的缓存可被 15 复用。

下一阶段主攻见 `project.md`；外观/交互/功能参考映射见各 change 的 Why 与 `docs/references/REFERENCE_PROJECTS.md`。

每阶段完成后：更新对应 `specs/*/spec.md` 的验收勾选，并补单测。
