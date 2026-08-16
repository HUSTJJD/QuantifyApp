import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { StatTile } from '@/components/ui/StatTile';
import { Tag } from '@/components/ui/Tag';
import { PriceText, ChangePct } from '@/components/ui/PriceText';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
import { ThemeProvider } from '@/theme/ThemeProvider';

/** 冒烟测试：在 ThemeProvider 下各 UI 组件能正常渲染、不抛错。 */
function render(node: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

describe('ui 组件冒烟', () => {
  it('PageHeader 渲染标题', () => {
    const tree = render(<PageHeader title="行情" subtitle="自选与信号" />).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('行情');
  });

  it('Card 渲染子内容', () => {
    const tree = render(<Card><Section title="区块" /></Card>).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('区块');
  });

  it('StatTile 渲染数值与标签', () => {
    const tree = render(<StatTile value={3} label="买入" />).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('买入');
  });

  it('Tag 买卖变体渲染', () => {
    const tree = render(<Tag text="买" variant="buy" />).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('买');
  });

  it('PriceText/ChangePct 渲染', () => {
    const tree = render(
      <Card>
        <PriceText value={10.5} />
        <ChangePct pct={1.25} />
        <PriceText value={null} />
        <ChangePct pct={null} />
      </Card>,
    ).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('--');
  });

  it('EmptyState 渲染文案', () => {
    const tree = render(<EmptyState text="暂无数据" hint="交易时段更新" />).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('暂无数据');
  });

  it('Icon 渲染（经 vector-icons mock）', () => {
    const tree = render(<Icon name={Icons.home} size={2} color="primary" />).toJSON();
    expect(tree).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('home-variant');
  });
});
