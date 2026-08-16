/**
 * 图标名集中映射（MaterialCommunityIcons）。
 * 唯一来源，页面只引用常量，避免散落魔法字符串、便于统一换肤/替换。
 */
export const Icons = {
  // 底部导航
  home: 'home-variant',
  signals: 'bell-ring',
  strategy: 'robot',
  sim: 'account-cash',
  watchlist: 'format-list-bulleted',
  asset: 'wallet',
  settings: 'cog',
  user: 'account-circle',

  // 通用
  search: 'magnify',
  refresh: 'refresh',
  chevronRight: 'chevron-right',
  chart: 'chart-line',
  trendUp: 'trending-up',
  trendDown: 'trending-down',
  star: 'star',
  starOutline: 'star-outline',
  bell: 'bell',
  wallet: 'wallet',
  eye: 'eye',
  eyeOff: 'eye-off',
  alert: 'alert-circle',
  info: 'information',
  check: 'check-circle',
  close: 'close-circle',
  plus: 'plus-circle',
  minus: 'minus-circle',
  buy: 'arrow-up-bold-circle',
  sell: 'arrow-down-bold-circle',
  clock: 'clock-outline',
  book: 'book-open-variant',
  bug: 'bug',
  chartPie: 'chart-pie',
  flag: 'flag',
  fire: 'fire',
  cog: 'cog',
  sortAsc: 'sort-ascending',
  sortDesc: 'sort-descending',
  filter: 'filter-variant',
  openExternal: 'open-in-new',
} as const;

export type IconName = (typeof Icons)[keyof typeof Icons];
