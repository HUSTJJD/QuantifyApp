# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# 重构规定

发现旧代码不合理时**直接删除重写**，不要留兼容层 / 双轨 / shims / deprecated 字段。
不要写 `ensureXxx` 之类的迁移函数；领域模型一次改干净。

策略档案模型：`legs: StrategyLeg[]` + `combineMode`（and/or/vote），**没有**「信号内核」绑定。
