# hithsa（同花顺官方 REST）已接端点

从 HithsaApiSource 源码提取：端点 + 查询参数（权威契约为 .agents/skills/hithink-finance/references/api/*.md，本地未包含该 skill 文档，字段以源码实参为准）

266:      this.client.get<any>('/api/meta/tickers/search', {
280:      this.client.get<any>('/api/meta/tickers/list', { exchange: 'SH,SZ', limit: '1000', offset: '0' }),
322:        this.client.get<any[]>('/api/a-share/prices/snapshot', { thscodes: thsCodes }),
366:      this.client.get<any>('/api/a-share/prices/historical', {
429:      this.client.get<any>('/api/a-share-index/prices/historical', {
470:      this.client.get<any[]>('/api/a-share-index/prices/snapshot', { thscodes: codes }),
494:      this.client.get<any>('/api/a-share/corporate-actions/adjustment-factors', params),
557:      this.client.get<any>(`/api/a-share/financials/income-statements`, {
586:      this.client.get<any>(`/api/a-share/financials/balance-sheets`, {
609:      this.client.get<any>(`/api/a-share/financials/cash-flow-statements`, {
631:      this.client.get<any>(`/api/a-share/financials/indicators`, {
702:    const data = await this.guard(this.client.get<any>('/api/a-share-index/catalog/ths-index-list', params), '同花顺指数列表失败');
713:      this.client.get<any>(`/api/a-share-index/constituents/ths-stock-list`, { thscode: toThsCode(symbol) }),
726:      this.client.get<any>('/api/fund/profile/detail', {
744:      this.client.get<any>('/api/fund/portfolio/holdings', {
763:      this.client.get<any>('/api/fund/performance/nav', params),
777:      this.client.get<any>('/api/fund/performance/returns', {
802:      this.client.get<any>('/api/fund/holders/detail', params),
820:      this.client.get<any>('/api/fund/market/snapshot', { thscode: toThsCode(symbol) }),
828:      this.client.get<any>('/api/fund/market/historical', {
869:      this.client.get<any>('/api/a-share/special-data/limit-up-pool', params),
893:      this.client.get<any>('/api/a-share/special-data/limit-up-ladder', {}),
904:      this.client.get<any>('/api/a-share/special-data/anomaly-analysis-list', params),
919:      this.client.get<any>('/api/a-share/special-data/anomaly-analysis-stock', {
938:      this.client.get<any>('/api/a-share/special-data/skyrocket-list', params),
956:      this.client.get<any>('/api/a-share/special-data/hot-stock-list', params),
972:      this.client.get<any>('/api/a-share/special-data/hot-stock-list-history', { date }),
988:      this.client.get<any>('/api/a-share/special-data/hot-stock-rank-trend', {
1012:      this.client.get<any>('/api/a-share/special-data/dragon-tiger-list', params),
1066:      this.client.get<any>('/api/a-share/calendar/trading-days'),
