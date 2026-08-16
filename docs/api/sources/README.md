# 行情源能力清单与封装规范

目标：**先把每个源吃透，再由多源汇总成 App 的总体能力**。
重复能力由 `SourceRouter` 在运行时挑最稳的源；某个源挂了自动降级，不影响上层。

## 一、能力清单（可由类型定义重新生成，不会漏）

| 源 | 清单文件 | 权威来源 | 生成方式 |
| --- | --- | --- | --- |
| stock-sdk | `stock-sdk.capabilities.md` | `node_modules/stock-sdk/dist/sdk-*.d.ts` 的 `StockSDK` 类 | 解析 `get xxx(): {...}` 命名空间 |
| fuyao | `fuyao.capabilities.md` | `node_modules/@opptrix/fuyao/dist/index.d.ts` | 解析 `declare class *Resource` 方法与 `interface *Params` |
| hithsa | `hithsa.capabilities.md` | 源码 `HithsaApiSource.ts` 的 `client.get(...)` 实参 | grep 端点（官方 skill 文档未入库，以实参为准） |
| fund-api | 见下 | `node_modules/fund-api/dist/index.d.ts`（仅 5 个能力） | 手工 |

### 重新生成

```bash
cd node_modules/stock-sdk/dist
node -e 'const fs=require("fs");const t=fs.readFileSync("sdk-Cd0dfXDL.d.ts","utf8");const s=t.indexOf("declare class StockSDK");const seg=t.slice(s);const re=/get (\w+)\(\): \{([\s\S]*?)\n    \};/g;let m;const out=[];while((m=re.exec(seg))){out.push("## "+m[1]+"\n"+m[2].split("\n").map(x=>x.trim()).filter(Boolean).join("\n"));}console.log(out.join("\n\n"))' \
  > ../../docs/api/sources/stock-sdk.capabilities.md

cd ../../@opptrix/fuyao/dist
node -e 'const fs=require("fs");const t=fs.readFileSync("index.d.ts","utf8");const re=/interface (\w+Params) \{([\s\S]*?)\n\}/g;let m;const ps=[];while((m=re.exec(t))){ps.push("### "+m[1]+"\n"+m[2].split("\n").map(x=>x.trim()).filter(Boolean).join("\n"));}const re2=/declare class (\w+)\s*\{([\s\S]*?)\n\}/g;let m2;const cs=[];while((m2=re2.exec(t))){const meth=m2[2].split("\n").map(x=>x.trim()).filter(x=>/^[a-zA-Z]+\(/.test(x));if(meth.length)cs.push("## "+m2[1]+"\n"+meth.join("\n"));}console.log(cs.join("\n\n")+"\n\n---PARAMS---\n\n"+ps.join("\n\n"))' \
  > ../../../docs/api/sources/fuyao.capabilities.md
```

SDK 升版后重跑一次，diff 出来就是"新能力 / 变更字段"，直接转成补录任务。

## 二、现状：吃透了多少

| 源 | 清单里的能力 | 已封装进接口契约 | 闲置（接口外，路由不到） |
| --- | --- | --- | --- |
| stock-sdk | 20 个命名空间 / 约 80 个 | 27 | 81（已登记在 `__tests__/sourceContract.test.ts` 的 `KNOWN_SOURCE_ONLY`） |
| fuyao | 12 个 Resource / 约 40 个 | 33 | 0（但有多个 Resource 方法未用，如 `limitDownPool`、`limitBreakPool`、`auction.snapshot`、`shortTermBenchmark`、`dumps`） |
| hithsa | 34 个端点 | 33 | 0 |
| fund-api | 5 | 5 | 0 |

**结论**：stock-sdk 是最没吃透的源（81 个能力挂在接口外），也是兜底源，价值最高。

## 三、封装规范：每个方法必须写清"协议 + 字段 + 取值"

模板（照抄，逐项填满；示例见 `StockSdkSource.getStockIndustryBoard`）：

```ts
/**
 * <中文名>（统一方法 `<MethodName>`）。
 *
 * ── 传输协议 ──────────────────────────
 * 上游：<SDK 路径，如 board.industry.spot> / <REST：GET /api/...> / <裸数据源>
 * 编码：<UTF-8 / GBK / JSONP>
 * 批量：<单标 / 逗号分隔批量，上限 N>
 * 触发：<拉一次 / 可缓存时长>
 *
 * ── 请求 ──────────────────────────────
 * | 字段 | 类型 | 必填 | 取值/格式 | 说明 |
 * | code | string | 是 | BK1027 / 600519 | 板块用 BK 码，个股用纯代码 |
 * | period | enum | 否 | day,week,month,1m,…,60m | 缺省 day |
 *
 * ── 响应（源字段）──────────────────────
 * | 字段 | 类型 | 单位/取值 | 缺失语义 |
 * | changePercent | number | 百分点，可为负 | null = 停牌/无数据 |
 * | amount | number | 元 | 0 = 未成交 |
 *
 * ── 映射到统一类型 ────────────────────
 * changePercent → Quote.changePct；amount → Quote.amount；price → Quote.last
 * 注：本源不给昨收，统一 Quote.prevClose 置 0（消费方用 changePct 兜底，见 SectorBoard.pctOf）
 *
 * ── 失败与降级 ────────────────────────
 * 3004：代码不属于本体系（非 BK 码）/ 能力外；其余错误包装为可重试 DataSourceError
 */
```

写不出来的项就写"未知"并标 `@unknown`，**不要猜**。协议对齐以 SDK 类型定义或官方端点文档为准。

## 三·补、已踩的坑（写封装前先看）

1. **`board.industry.spot()` 返回 KV，不是对象数组**：类型定义是
   `{ item: string; value: number | null }[]`，`item` 是上游内部字段代号。
   板块全字段在 `board.industry.list()`（`IndustryBoard`：`price/changePercent/totalMarketCap/turnoverRate/riseCount/fallCount/leadingStock`）。
   曾按"对象数组"假设写过封装，字段全取到 `undefined` —— **已修正**（`getStockIndustryBoard` / `getBoardQuotes` 都改用 `list()`）。
2. **板块没有成交额**：`IndustryBoard` 无 `amount`，只有 `totalMarketCap` / `turnoverRate`。
   首页热力图的"块大小"用 `totalMarketCap` 代理，不要写死 `amount`。
3. **板块没有昨收**：不要算 `(last - prevClose) / prevClose`，统一用 `changePercent`。

## 四、推进批次（按价值排序）

1. **P1 · stock-sdk 高频能力**：`quotes.hk/us` → `getHkQuotes/getUsQuotes`、`kline.hk/us` → `getHkKline/getUsKline`、`quotes.timeline` → `getTimeSharing/getStockTimeSharing`、`fundFlow.*` → `getStockFundsFlowing/getStockIndustryFundsFlowing`、`dragonTiger.*` → `getDragonTiger`、`blockTrade.*` → `getBlockTrade`。
2. **P2 · 独家能力（接口需新增签名）**：北向资金 `northbound.*`、筹码分布 `chips.cn`、选股 `screen`、龙虎榜席位/机构、融资融券 `margin.*`、期权/期货。这些在 `methods.ts` 里没有对应签名，需先加签名（编译期强制补 catalog 与 expectations）。
3. **P3 · fuyao 未用端点**：`limitDownPool`、`limitBreakPool`、`auction.snapshot`（集合竞价）、`shortTermBenchmark`、`dumps`。
4. **P4 · 完备性闭环**：每个源的能力清单项 → 必须有封装 → 契约测试断言（现在只校验"已封装的不漂移"，下一步校验"清单里的都封装了"）。

## 五、多源汇总：重复能力自动选最稳的源（已落地）

`SourceRouter` 已实现稳定优先调度：

- 有运行统计时，按 `ApiStabilityStats.score()`（成功率 70% + 覆盖度 30%，0~100）降序尝试，
  重复能力优先打**最稳的那个源**，而不是永远先打配置里排第一的 fuyao。
- **冷启动（无统计）自动退化为 `config.sourceOrder`**，保证首次启动行为与可复现性不变。
- `RouterOptions.stableRouting`（默认 true）可关闭，强制用配置顺序（测试/调试用）。
- 熔断（`SourceHealth`）仍优先：熔断中的源直接排除，不参与排序。
- 兜底语义不变：第一个成功即返回；全失败才抛聚合错误。

`__tests__/SourceRouter.test.ts` 已覆盖三种场景：有统计选更稳源 / `stableRouting=false` 退化为配置顺序 / 冷启动保持配置顺序。
