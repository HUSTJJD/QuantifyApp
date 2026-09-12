/**
 * SectorBoard 回归测试：宽度测量 → 渲染板块方块。
 *
 * 背景：onLayout 曾挂在「仅有数据时才渲染」的 treemap 容器上，形成
 * “测不到宽度 → 没有 rects → 不渲染容器 → 永远测不到宽度”的死锁，
 * 首页行业板块恒显示「暂无板块数据」。宽度改在常驻容器上测量后需保持可渲染。
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { SectorBoard } from '@/features/home/SectorBoard';
import { ThemeProvider } from '@/theme/ThemeProvider';

jest.mock('@/data/api', () => ({
  marketData: {
    listIndices: jest.fn().mockResolvedValue([
      { symbol: { code: '881121', exchange: 'TI' }, name: '半导体' },
      { symbol: { code: '881145', exchange: 'TI' }, name: '白酒' },
    ]),
  },
}));

jest.mock('@/hooks/useMarketData', () => ({
  useQuotes: () => ({
    data: [
      { symbol: { code: '881121', exchange: 'TI' }, last: 1100, prevClose: 1000, amount: 3e10, open: 0, high: 0, low: 0, volume: 0 },
      { symbol: { code: '881145', exchange: 'TI' }, last: 900, prevClose: 1000, amount: 1e10, open: 0, high: 0, low: 0, volume: 0 },
    ],
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));

/** 收集所有 Text 的文案（children 可能是数组，如 ['+', '10.00', '%']） */
function texts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')));
}

describe('SectorBoard', () => {
  it('测得宽度后渲染板块方块（回归：宽度测量死锁）', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <ThemeProvider>
          <SectorBoard tag="industry" />
        </ThemeProvider>,
      );
    });
    expect(texts(tree)).toContain('板块热力');

    // 容器常驻，因此总能拿到 onLayout 并测得宽度
    const measured = tree.root.findAllByType(View).find(v => typeof v.props.onLayout === 'function');
    expect(measured).toBeTruthy();
    await act(async () => {
      measured!.props.onLayout({ nativeEvent: { layout: { width: 360, height: 0 } } });
    });

    const all = texts(tree);
    expect(all).toContain('半导体');
    expect(all).toContain('+10.00%');
    expect(all).toContain('-10.00%');
    expect(all).not.toContain('暂无板块数据');
  });
});
