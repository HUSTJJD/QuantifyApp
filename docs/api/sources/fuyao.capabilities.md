## FuyaoHttpClient
constructor(options: FuyaoClientOptions);

## MetaResource
constructor(http: FuyaoHttpClient);
search(params: TickerSearchParams): Promise<ApiResponse<TickerListData>>;
listTickers(params?: TickerListParams): Promise<ApiResponse<TickerListData>>;
iterateAllTickers(params?: {

## DumpsResource
constructor(http: FuyaoHttpClient);

## PricesResource
constructor(http: FuyaoHttpClient);
snapshot(params?: PriceSnapshotParams): Promise<ApiResponse<PriceSnapshotData>>;
iterateAllSnapshot(params?: {
historical(params: PriceHistoricalParams): Promise<ApiResponse<PriceHistoricalData>>;

## CorporateActionsResource
constructor(http: FuyaoHttpClient);
adjustmentFactors(params: AdjustmentFactorsParams): Promise<ApiResponse<AdjustmentFactorsData>>;

## FinancialStatementsResource
constructor(http: FuyaoHttpClient);
incomeStatements(params: FinancialStatementParams): Promise<ApiResponse<FinancialListData<IncomeStatementItem>>>;
balanceSheets(params: FinancialStatementParams): Promise<ApiResponse<FinancialListData<BalanceSheetItem>>>;
cashFlowStatements(params: FinancialStatementParams): Promise<ApiResponse<FinancialListData<CashFlowStatementItem>>>;
indicators(params: {

## CalendarResource
constructor(http: FuyaoHttpClient);
tradingDays(): Promise<ApiResponse<TradingDaysData>>;

## ValuationsResource
constructor(http: FuyaoHttpClient);
snapshot(params: {

## AuctionResource
constructor(http: FuyaoHttpClient);
snapshot(params: {
shortTermBenchmark(params?: {

## IndexResource
constructor(http: FuyaoHttpClient);
catalogThsIndexList(params?: {
constituentsThsStockList(params: {
pricesSnapshot(params: {
pricesHistorical(params: {

## SpecialDataResource
constructor(http: FuyaoHttpClient);
limitUpPool(params?: PoolQueryParams & {
limitDownPool(params?: PoolQueryParams & {
limitBreakPool(params?: PoolQueryParams & {
limitUpLadder(): Promise<ApiResponse<LimitUpLadderData>>;
skyrocketList(params?: {
hotStockList(params?: {
hotStockListHistory(params: {
hotStockRankTrend(params: {
anomalyAnalysisList(params?: {
anomalyAnalysisStock(params: {
dragonTigerList(params?: {

## FundsResource
constructor(http: FuyaoHttpClient);

## FundProfileResource
constructor(http: FuyaoHttpClient);
detail(params: {

## FundPortfolioResource
constructor(http: FuyaoHttpClient);
holdings(params: {
stockHistory(params: FundHistoryParams): Promise<ApiResponse<{
bondHistory(params: FundHistoryParams): Promise<ApiResponse<{
stockReportDates(params: FundReportDatesParams): Promise<ApiResponse<{
bondReportDates(params: FundReportDatesParams): Promise<ApiResponse<{
assetAllocation(params: {
industryAllocation(params: {

## FundPerformanceResource
constructor(http: FuyaoHttpClient);
nav(params: {
returns(params: {
indicatorsHistorical(params: {
drawdowns(params: {

## FundHoldersResource
constructor(http: FuyaoHttpClient);
detail(params: {
top(params: {

## FundFinancialsResource
constructor(http: FuyaoHttpClient);
indicators(params: {
incomeStatements(params: {
balanceSheets(params: {

## FundCorporateActionsResource
constructor(http: FuyaoHttpClient);
dividends(params: {

## FundManagersResource
constructor(http: FuyaoHttpClient);
investmentStyle(params: {
performance(params: {
experience(params: {
detail(params: {

## FundCompaniesResource
constructor(http: FuyaoHttpClient);
detail(params: {

## FundDiagnosticsResource
constructor(http: FuyaoHttpClient);
detail(params: {

## FundOfferingsResource
constructor(http: FuyaoHttpClient);
list(params: {

## FundNewsResource
constructor(http: FuyaoHttpClient);
articleList(params: {
iterateArticles(params: {

## FundMarketResource
constructor(http: FuyaoHttpClient);
snapshot(params: {
historical(params: {

## FuyaoClient
constructor(options: FuyaoClientOptions);

---PARAMS---

### TickerSearchParams
/** 搜索关键词：完整 thscode、ticker 代码或中英文名称（支持子串匹配）。必填。 */
q: string;
/** 交易所过滤：SH / SZ / BJ；场外基金不参与该过滤。 */
exchange?: ExchangeFilter;
/**
* 规范化资产类型，支持单值或逗号分隔多值。
* 非法值服务端返回 code=1003。
*/
assetType?: AssetType | AssetType[];
/** 返回上限，最大 50；默认 10。 */
limit?: number;

### TickerListParams
/** 规范化资产类型，支持单值或逗号分隔多值；省略时返回全部类型。 */
assetType?: AssetType | AssetType[];
/** 单页条数，最大 10000；默认 1000。 */
limit?: number;
/** 分页偏移；默认 0。循环递增直至 item.length < limit 取尽。 */
offset?: number;

### PriceSnapshotParams
/**
* 逗号分隔的 thscode 列表（如 `600519.SH,000001.SZ`）。
* 给定时按入参顺序批量取数且不分页；省略时遍历全市场并使用分页参数。
*/
thscodes?: string | string[];
/** 分页大小，仅在省略 thscodes 时生效，默认 100。 */
limit?: number;
/** 分页偏移，仅在省略 thscodes 时生效，默认 0。 */
offset?: number;

### PriceHistoricalParams
/** 单只标的 thscode（不接受逗号）。必填。 */
thscode: string;
/**
* K 线周期：`1d`(日线，默认) / `1w`(周线) / `1mo`(月线)。
*
* > 实测补充（2026-08-25）：官方文档标注「当前仅支持 1d」已过时，
* > 服务端实测支持 `1w` 与 `1mo`（其余写法如 `1W`/`week`/`month`
* > 返回 code=1002）。注意指数与基金行情接口仍仅支持 `1d`。
*/
interval?: '1d' | '1w' | '1mo';
/** 起始时间毫秒 Unix 时间戳。必填；缺失服务端返回 code=1001。 */
start: number;
/** 结束时间毫秒 Unix 时间戳。必填；窗口超 10 年返回 code=1003。 */
end: number;
/** 复权方式：none / forward(前复权) / backward(后复权)；默认 forward。 */
adjust?: AdjustMode;
/** 分页偏移，默认 0。 */
offset?: number;

### AdjustmentFactorsParams
/** 单只标的 thscode（不接受逗号）。必填。 */
thscode: string;
/** 事件起始日，`YYYY-MM-DD`。 */
from?: string;
/** 事件截止日，`YYYY-MM-DD`。 */
to?: string;

### FinancialStatementParams
/** 单只标的 thscode（含交易所后缀，如 600519.SH）。必填。 */
thscode: string;
/** 报告期类型；默认 annual。 */
period?: FinancialPeriod;
/** 最近 N 期模式条数，范围 [1,20]；与 start/end 互斥。 */
limit?: number;
/** 时间区间模式起始毫秒戳，需与 end 同传。 */
start?: number;
/** 时间区间模式结束毫秒戳，需 ≥ start。 */
end?: number;

### PoolQueryParams
/** 查询交易日毫秒戳（Asia/Shanghai 零点）；省略时取服务端当前自然日。 */
dateMs?: number;
/** 页码，必须 >=1，默认 1。 */
page?: number;
/** 分页大小，范围 1..200，默认 50。 */
size?: number;
/** 排序字段（各接口白名单不同）。 */
sortField?: string;
/** 排序方向 asc/desc，默认 desc。 */
sortDir?: 'asc' | 'desc';

### FundHistoryParams
fundType: FundType;
thscode: string;
reportType: string;
/** `yyyy-MM-dd`。 */
endDate: string;

### FundReportDatesParams
fundType: FundType;
thscode: string;
reportType?: string;
