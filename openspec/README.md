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
    └── onboarding-notify/spec.md       ⑥ 首启引导 + 盘后摘要
```

外部参考项目（stock-sdk / stock-dashboard / kline-charts-react / ghostfolio / react-native-graph / OpenStock / Opptrix）见 `docs/references/REFERENCE_PROJECTS.md`。

## 开发顺序建议

| 阶段 | 变更 | 产出 | 状态 |
|---|---|---|---|
| 1 | strategy-maturity | 策略可配置、信号可解释、风控闭环 | 已交付 |
| 2 | backtest-trust | 回测数字可信，参数扫描可用 | 已交付 |
| 3 | signal-to-trade-loop | 端到端量化工作流 | 已交付 |
| 4 | 盯盘告警完善 | 价格/指标/策略信号 + 规则管理 | 已交付 |
| 5 | 组合净值 | 日更快照 + 归因 + 净值指标 | 已交付 |
| 6 | mobile-surface-v1 | Token/骨架屏/自选密度/列表性能/资产页 | 已交付 |
| 7 | quant-visibility | 策略 Tab 工作台 + 热力图多维 | 已交付 |
| 8 | onboarding-notify | 首启 3 屏 + 盘后摘要 + 告警触达 | 已交付 |

下一阶段主攻见 `project.md`；外观/交互/功能参考映射见各 change 的 Why 与 `docs/references/REFERENCE_PROJECTS.md`。

每阶段完成后：更新对应 `specs/*/spec.md` 的验收勾选，并补单测。
