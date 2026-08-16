# 资产目录（assets）

集中管理 App 的非代码资源与图标约定，避免散落。

## 目录规划
- `src/assets/icons.ts`：图标名常量集中定义（MaterialCommunityIcons 名称），单一来源，避免页面里散落魔法字符串。
- `src/assets/images/`：本地图片（启动图、空状态插画、品牌 Logo 等）。当前以占位为主，后续按需放入。
- `src/assets/fonts/`：自定义字体（如需）。

## 图标规范
- 统一使用 `react-native-vector-icons/MaterialCommunityIcons`，封装见 `components/ui/Icon.tsx`。
- 图标名在 `icons.ts` 以常量导出（如 `Icons.home`、`Icons.signals`），类型安全、易重构。
- 尺寸/颜色统一走 theme 的 `iconSize` 与语义色，不在页面硬编码。

## 接入说明
```ts
import { Icon } from '@/components/ui/Icon';
import { Icons } from '@/assets/icons';
<Icon name={Icons.home} size="md" color="primary" />
```
