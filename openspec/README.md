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
└── changes/                            下一阶段变更提案
    ├── strategy-maturity/spec.md       ① 策略引擎成熟化
    ├── backtest-trust/spec.md          ② 回测可信化
    └── signal-to-trade-loop/spec.md    ③ 扫描→信号→模拟→跟单闭环
```

## 开发顺序建议

| 阶段 | 变更 | 产出 |
|---|---|---|
| 1 | strategy-maturity | 策略可配置、信号可解释、风控闭环 |
| 2 | backtest-trust | 回测数字可信，参数扫描可用 |
| 3 | signal-to-trade-loop | 端到端量化工作流 |

每阶段完成后：更新对应 `specs/*/spec.md` 的验收勾选，并补单测。
