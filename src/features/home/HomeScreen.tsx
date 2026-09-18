/**
 * 主页面（Bloomberg 风格全球股市看板）：
 * 搜索 + LIVE → 全球指数条 → 会话时钟 → A股大盘 → 板块热力图 → A股个股焦点 → 资金折叠。
 * 自选/信号/模拟盘在独立底部页签。
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQuotes } from '@/hooks/useMarketData';
import type { Quote, Symbol } from '@/data/api';
import { spacing, fontSize, radius } from '@/theme';
import { useAppTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/theme/icons';
import { getAppPrefs, primeAppPrefs, DEFAULT_PREFS } from '@/settings/appPrefs';
import { SectorBoard } from './SectorBoard';
import { GlobalTickerStrip } from './board/GlobalTickerStrip';
import { SessionClock } from './board/SessionClock';
import { ChinaBoard } from './board/ChinaBoard';
import { AshareFocusBoard } from './board/AshareFocusBoard';
import { FundsSection } from './board/FundsSection';
import {
  ALL_BOARD_SYMBOLS,
  CN_BOARD_INDICES,
  GLOBAL_SYMBOLS,
  fullCodeOf,
} from './board/format';

const TAB_BAR_PAD = Platform.select({ ios: 56, android: 60, default: 56 });

const DEFAULT_FOCUS: Symbol = { code: '000001', exchange: 'SH', name: '上证指数' };

function findBoardSymbol(fullCode: string): Symbol {
  const all = [...GLOBAL_SYMBOLS, ...CN_BOARD_INDICES];
  return all.find((s) => fullCodeOf(s) === fullCode) ?? DEFAULT_FOCUS;
}

export function HomeScreen({
  onOpen,
  onSearch,
}: {
  onOpen: (s: Symbol) => void;
  onSearch: () => void;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [focusKey, setFocusKey] = useState(DEFAULT_PREFS.homeFocusIndex);
  const [focusSymbol, setFocusSymbol] = useState<Symbol>(DEFAULT_FOCUS);
  const [focusTab, setFocusTab] = useState(DEFAULT_PREFS.ashareFocusTab);
  const [fundsCollapsed, setFundsCollapsed] = useState(DEFAULT_PREFS.homeFundsCollapsed);

  const {
    data: boardData,
    loading: boardLoading,
    reload: reloadBoardQuotes,
  } = useQuotes(ALL_BOARD_SYMBOLS, 'stock', focused);

  useEffect(() => {
    getAppPrefs()
      .then((p) => {
        primeAppPrefs(p);
        if (p.homeFocusIndex) {
          setFocusKey(p.homeFocusIndex);
          setFocusSymbol(findBoardSymbol(p.homeFocusIndex));
        }
        setFocusTab(p.ashareFocusTab);
        setFundsCollapsed(p.homeFundsCollapsed);
      })
      .catch(() => undefined);
  }, []);

  const quoteMap = useMemo(() => {
    const m = new Map<string, Quote>();
    (boardData ?? []).forEach((q) => m.set(fullCodeOf(q.symbol), q));
    return m;
  }, [boardData]);

  const focusQuote = quoteMap.get(focusKey) ?? null;

  const onSelectFocus = useCallback((symbol: Symbol, fullCode: string) => {
    setFocusSymbol(symbol);
    setFocusKey(fullCode);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      reloadBoardQuotes?.();
    } finally {
      setRefreshing(false);
    }
  }, [reloadBoardQuotes]);

  const styles = makeStyles(colors);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: (insets.bottom || 0) + TAB_BAR_PAD + spacing.md },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* 顶栏：标题 + 搜索 */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brand}>锐见</Text>
          <Text style={styles.brandSub}>全球股市看板</Text>
        </View>
        <TouchableOpacity style={styles.searchEntry} onPress={onSearch} activeOpacity={0.7}>
          <Icon name={Icons.search} size={2} color="textSecondary" style={styles.searchIcon} />
          <Text style={styles.searchPlaceholder}>搜索代码 / 名称</Text>
        </TouchableOpacity>
      </View>

      <GlobalTickerStrip
        quotes={boardData}
        loading={boardLoading}
        selectedFullCode={focusKey}
        onSelect={onSelectFocus}
      />

      <SessionClock />

      <ChinaBoard
        quotes={boardData}
        loading={boardLoading}
        focusSymbol={focusSymbol}
        focusQuote={focusQuote}
        selectedFullCode={focusKey}
      />

      <SectorBoard
        tag="industry"
        onPress={(idx) => onOpen({ ...idx.symbol, name: idx.name || idx.symbol.name })}
      />

      <AshareFocusBoard
        defaultTab={focusTab}
        onPressStock={(s) => onOpen({ ...s, name: s.name })}
      />

      <FundsSection
        defaultCollapsed={fundsCollapsed}
        onPressStock={onOpen}
      />
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.md },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    brand: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '800',
      letterSpacing: 1,
    },
    brandSub: {
      color: colors.textSecondary,
      fontSize: fontSize.micro,
      marginTop: 2,
    },
    searchEntry: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      height: 36,
      maxWidth: 220,
    },
    searchIcon: { marginRight: spacing.sm },
    searchPlaceholder: { color: colors.textSecondary, fontSize: fontSize.xs },
  });
}
