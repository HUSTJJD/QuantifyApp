/**
 * SearchScreen —— 全局搜索页。
 *
 * 功能：
 *  - 搜索 A股/港股/美股/指数/基金
 *  - 热门搜索（热门标的快捷入口）
 *  - 搜索历史（本地持久化，点击可快速搜索）
 *  - 搜索结果分组展示（股票 / 指数 / 基金）
 *  - 点击结果跳转个股详情
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SearchBar } from '@/components/ui/SearchBar';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { marketData } from '@/data/api';
import type { Instrument, Symbol } from '@/data/api';
import { storage, StorageKeys } from '@/data/db/storage';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { toFullCode } from '@/domain';

const HOT_SEARCHES: { code: string; exchange: Symbol['exchange']; name: string }[] = [
  { code: '600519', exchange: 'SH', name: '贵州茅台' },
  { code: '000858', exchange: 'SZ', name: '五粮液' },
  { code: '300750', exchange: 'SZ', name: '宁德时代' },
  { code: '601318', exchange: 'SH', name: '中国平安' },
  { code: '00700', exchange: 'HK', name: '腾讯控股' },
  { code: '03690', exchange: 'HK', name: '美团-W' },
  { code: 'AAPL', exchange: 'US', name: '苹果' },
  { code: 'TSLA', exchange: 'US', name: '特斯拉' },
];

const MAX_HISTORY = 20;

type SearchGroup = { type: 'stock' | 'index' | 'fund'; title: string; items: Instrument[] };

export function SearchScreen({
  onBack,
  onOpenStock,
}: {
  onBack: () => void;
  onOpenStock: (symbol: Symbol) => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const styles = makeStyles(colors);

  // 加载搜索历史
  useEffect(() => {
    storage.getObject<string[]>(StorageKeys.SEARCH_HISTORY).then((arr) => {
      if (Array.isArray(arr)) setHistory(arr);
    });
  }, []);

  // 保存到搜索历史
  const saveHistory = useCallback(async (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    const next = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, MAX_HISTORY);
    setHistory(next);
    await storage.setObject(StorageKeys.SEARCH_HISTORY, next);
  }, [history]);

  // 搜索防抖
  useEffect(() => {
    const kw = keyword.trim();
    if (!kw) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await marketData.search(kw);
        setResults(data.slice(0, 50));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [keyword]);

  const handleSelect = (item: Instrument) => {
    Keyboard.dismiss();
    saveHistory(item.name || item.symbol.code);
    onOpenStock({ code: item.symbol.code, exchange: item.symbol.exchange, name: item.name });
  };

  const handleHotPress = (item: typeof HOT_SEARCHES[number]) => {
    saveHistory(item.name);
    onOpenStock({ code: item.code, exchange: item.exchange, name: item.name });
  };

  const handleHistoryPress = (kw: string) => {
    setKeyword(kw);
  };

  const clearHistory = async () => {
    setHistory([]);
    await storage.remove(StorageKeys.SEARCH_HISTORY);
  };

  // 按资产类别分组：指数 / 基金 / 股票
  const groups: SearchGroup[] = [];
  if (results.length > 0) {
    const indices = results.filter((r) => r.assetType === 'a-share-index');
    const funds = results.filter((r) => r.assetType?.startsWith('fund-'));
    const stocks = results.filter((r) => r !== undefined && !indices.includes(r) && !funds.includes(r));
    if (stocks.length > 0) groups.push({ type: 'stock', title: '股票', items: stocks });
    if (indices.length > 0) groups.push({ type: 'index', title: '指数', items: indices });
    if (funds.length > 0) groups.push({ type: 'fund', title: '基金', items: funds });
  }

  const showResults = keyword.trim().length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 顶部搜索栏 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ 返回</Text>
        </TouchableOpacity>
        <View style={styles.searchWrap}>
          <SearchBar
            value={keyword}
            onChangeText={setKeyword}
            onClear={() => setKeyword('')}
            autoFocus
          />
        </View>
      </View>

      {showResults ? (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.type}
          renderItem={({ item: group }) => (
            <View style={styles.group}>
              <Text style={styles.groupTitle}>{group.title}（{group.items.length}）</Text>
              {group.items.map((item) => (
                <TouchableOpacity
                  key={toFullCode(item.symbol)}
                  style={styles.resultRow}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName}>{item.name || item.symbol.code}</Text>
                    <Text style={styles.resultCode}>{toFullCode(item.symbol)}</Text>
                  </View>
                  <Icon name={Icons.chevronRight} size={2} color="textSecondary" />
                </TouchableOpacity>
              ))}
            </View>
          )}
          ListEmptyComponent={
            !loading && keyword.trim() ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>未找到相关结果</Text>
              </View>
            ) : undefined
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={[{ key: 'hot' }, { key: 'history' }]}
          keyExtractor={(i) => i.key}
          renderItem={({ item }) => {
            if (item.key === 'hot') {
              return (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>热门搜索</Text>
                  <View style={styles.hotGrid}>
                    {HOT_SEARCHES.map((h) => (
                      <TouchableOpacity
                        key={`${h.code}.${h.exchange}`}
                        style={styles.hotTag}
                        onPress={() => handleHotPress(h)}
                      >
                        <Text style={styles.hotText} numberOfLines={1}>{h.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            }
            if (item.key === 'history' && history.length > 0) {
              return (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionTitle}>搜索历史</Text>
                    <TouchableOpacity onPress={clearHistory}>
                      <Text style={styles.clearText}>清空</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.historyWrap}>
                    {history.map((h) => (
                      <TouchableOpacity
                        key={h}
                        style={styles.historyTag}
                        onPress={() => handleHistoryPress(h)}
                      >
                        <Text style={styles.historyText} numberOfLines={1}>{h}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            }
            return null;
          }}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    back: { color: colors.primary, fontSize: fontSize.md },
    searchWrap: { flex: 1 },
    listContent: { padding: spacing.md, paddingBottom: spacing.xl },
    group: { marginBottom: spacing.lg },
    groupTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      marginBottom: spacing.sm,
      fontWeight: '600',
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    resultInfo: { flex: 1 },
    resultName: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
    resultCode: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    empty: { alignItems: 'center', paddingVertical: spacing.xl },
    emptyText: { color: colors.textSecondary, fontSize: fontSize.sm },
    section: { marginBottom: spacing.lg },
    sectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    clearText: { color: colors.textSecondary, fontSize: fontSize.sm },
    hotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    hotTag: {
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      minWidth: '22%',
    },
    hotText: { color: colors.text, fontSize: fontSize.sm, textAlign: 'center' },
    historyWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    historyTag: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
    },
    historyText: { color: colors.textSecondary, fontSize: fontSize.sm },
  });
}
