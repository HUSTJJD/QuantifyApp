## quotes
cn: (codes: string[]) => Promise<FullQuote[]>;
cnSimple: (codes: string[]) => Promise<SimpleQuote[]>;
hk: (codes: string[]) => Promise<HKQuote[]>;
us: (codes: string[]) => Promise<USQuote[]>;
fund: (codes: string[]) => Promise<FundQuote[]>;
fundFlow: (codes: string[]) => Promise<FundFlow[]>;
largeOrder: (codes: string[]) => Promise<PanelLargeOrder[]>;
timeline: (code: string) => Promise<TodayTimelineResponse>;

## codes
cn: (options?: GetAShareCodeListOptions) => Promise<string[]>;
us: (options?: GetUSCodeListOptions) => Promise<string[]>;
hk: () => Promise<string[]>;
fund: () => Promise<string[]>;

## batch
cn: (options?: GetAllAShareQuotesOptions) => Promise<FullQuote[]>;
hk: (options?: GetAllHKQuotesOptions) => Promise<HKQuote[]>;
us: (options?: GetAllUSQuotesOptions) => Promise<USQuote[]>;
byCodes: (codes: string[], options?: GetAllAShareQuotesOptions) => Promise<FullQuote[]>;
raw: (params: string) => Promise<{
key: string;
fields: string[];
}[]>;

## kline
cn: (symbol: string, options?: HistoryKlineOptions) => Promise<HistoryKline[]>;
cnMinute: (symbol: string, options?: MinuteKlineOptions) => Promise<MinuteTimeline[] | MinuteKline[]>;
hk: (symbol: string, options?: HKKlineOptions) => Promise<HKHistoryKline[]>;
hkMinute: (symbol: string, options?: HKMinuteKlineOptions) => Promise<HKMinuteTimeline[] | HKMinuteKline[]>;
us: (symbol: string, options?: USKlineOptions) => Promise<USHistoryKline[]>;
usMinute: (symbol: string, options?: USMinuteKlineOptions) => Promise<USMinuteTimeline[] | USMinuteKline[]>;
withIndicators: (symbol: string, options?: KlineWithIndicatorsOptions) => Promise<KlineWithIndicators<AnyHistoryKline>[]>;
signals: (symbol: string, options?: KlineSignalsOptions) => Promise<KlineSignal[]>;

## chips
cn: (symbol: string, options?: ChipDistributionRequestOptions) => Promise<ChipDistributionItem[]>;
hk: (symbol: string, options?: ChipDistributionRequestOptions) => Promise<ChipDistributionItem[]>;
us: (symbol: string, options?: ChipDistributionRequestOptions) => Promise<ChipDistributionItem[]>;

## board
industry: {
list: () => Promise<IndustryBoard[]>;
spot: (symbol: string) => Promise<IndustryBoardSpot[]>;
constituents: (symbol: string) => Promise<IndustryBoardConstituent[]>;
kline: (symbol: string, options?: IndustryBoardKlineOptions) => Promise<IndustryBoardKline[]>;
minuteKline: (symbol: string, options?: IndustryBoardMinuteKlineOptions) => Promise<IndustryBoardMinuteTimeline[] | IndustryBoardMinuteKline[]>;
};
concept: {
list: () => Promise<ConceptBoard[]>;
spot: (symbol: string) => Promise<ConceptBoardSpot[]>;
constituents: (symbol: string) => Promise<ConceptBoardConstituent[]>;
kline: (symbol: string, options?: ConceptBoardKlineOptions) => Promise<ConceptBoardKline[]>;
minuteKline: (symbol: string, options?: ConceptBoardMinuteKlineOptions) => Promise<ConceptBoardMinuteTimeline[] | ConceptBoardMinuteKline[]>;
};

## options
index: {
spot: (product: IndexOptionProduct, contract: string) => Promise<OptionTQuoteResult>;
kline: (symbol: string) => Promise<OptionKline[]>;
};
etf: {
months: (cate: ETFOptionCate) => Promise<ETFOptionMonth>;
expireDay: (cate: ETFOptionCate, month: string) => Promise<ETFOptionExpireDay>;
minute: (code: string) => Promise<OptionMinute[]>;
dailyKline: (code: string) => Promise<OptionKline[]>;
fiveDayMinute: (code: string) => Promise<OptionMinute[]>;
};
commodity: {
spot: (variety: string, contract: string) => Promise<OptionTQuoteResult>;
kline: (symbol: string) => Promise<OptionKline[]>;
};
cffex: {
quotes: (options?: CFFEXOptionQuotesOptions) => Promise<CFFEXOptionQuote[]>;
};
lhb: (symbol: string, date: string) => Promise<OptionLHBItem[]>;

## futures
kline: (symbol: string, options?: FuturesKlineOptions) => Promise<FuturesKline[]>;
globalSpot: (options?: GlobalFuturesSpotOptions) => Promise<GlobalFuturesQuote[]>;
globalKline: (symbol: string, options?: GlobalFuturesKlineOptions) => Promise<FuturesKline[]>;
inventorySymbols: () => Promise<FuturesInventorySymbol[]>;
inventory: (symbol: string, options?: FuturesInventoryOptions) => Promise<FuturesInventory[]>;
comexInventory: (symbol: "gold" | "silver", options?: ComexInventoryOptions) => Promise<ComexInventory[]>;

## fundFlow
individual: (symbol: string, options?: FundFlowOptions) => Promise<StockFundFlowDaily[]>;
market: () => Promise<MarketFundFlow[]>;
rank: (options?: FundFlowRankOptions) => Promise<FundFlowRankItem[]>;
sectorRank: (options?: FundFlowRankOptions) => Promise<SectorFundFlowItem[]>;
sectorHistory: (symbol: string, options?: FundFlowOptions) => Promise<StockFundFlowDaily[]>;

## northbound
minute: (direction?: NorthboundDirection) => Promise<NorthboundMinuteItem[]>;
summary: () => Promise<NorthboundFlowSummary[]>;
holdingRank: (options?: NorthboundHoldingRankOptions) => Promise<NorthboundHoldingRankItem[]>;
history: (direction?: NorthboundDirection, options?: NorthboundHistoryOptions) => Promise<NorthboundHistoryItem[]>;
individual: (symbol: string, options?: NorthboundHistoryOptions) => Promise<NorthboundIndividualItem[]>;

## marketEvent
ztPool: (type?: ZTPoolType, date?: string) => Promise<ZTPoolItem[]>;
stockChanges: (type?: StockChangeType | StockChangeType[] | "all") => Promise<StockChangeItem[]>;
boardChanges: () => Promise<BoardChangeItem[]>;
individualChanges: (symbol: string, options?: IndividualChangesOptions) => Promise<IndividualStockChangeItem[]>;
individualChangesHistory: (symbol: string, options?: IndividualChangesHistoryOptions) => Promise<IndividualChangesHistory>;

## dragonTiger
detail: (options: DragonTigerDateOptions) => Promise<DragonTigerDetailItem[]>;
stockStats: (period?: DragonTigerPeriod) => Promise<DragonTigerStockStatItem[]>;
institution: (options: DragonTigerDateOptions) => Promise<DragonTigerInstitutionItem[]>;
branchRank: (period?: DragonTigerPeriod) => Promise<DragonTigerBranchItem[]>;
seatDetail: (symbol: string, date: string) => Promise<DragonTigerSeatItem[]>;

## blockTrade
marketStat: () => Promise<BlockTradeMarketStatItem[]>;
detail: (options?: BlockTradeDateOptions) => Promise<BlockTradeDetailItem[]>;
dailyStat: (options?: BlockTradeDateOptions) => Promise<BlockTradeDailyStatItem[]>;

## margin
accountInfo: () => Promise<MarginAccountItem[]>;
targetList: (date?: string) => Promise<MarginTargetItem[]>;

## fund
dividendList: (options?: FundDividendListOptions) => Promise<FundDividendListResult>;
navHistory: (code: string) => Promise<FundNavHistory>;
rankHistory: (code: string) => Promise<FundRankHistory>;
profile: (code: string) => Promise<FundProfile>;
theme: FundThemeService;

## calendar
isTradingDay: (date?: string | Date) => Promise<boolean>;
nextTradingDay: (date?: string | Date) => Promise<string>;
prevTradingDay: (date?: string | Date) => Promise<string>;
marketStatus: (market?: SupportedMarket, now?: Date) => MarketStatus;

## reference
dividendDetail: (symbol: string) => Promise<DividendDetail[]>;
tradingCalendar: () => Promise<string[]>;
