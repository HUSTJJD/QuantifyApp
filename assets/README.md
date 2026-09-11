# assets/

App 静态资源（Expo / 原生打包用）。**代码常量不放在本目录。**

| 子目录 | 用途 |
|--------|------|
| `fonts/` | 自定义字体（如 MaterialCommunityIcons.ttf） |
| `images/` | 启动图、图标、favicon |
| `expo.icon/` | Expo 图标描述 |

- `app.json` / `App.tsx` 通过相对路径 `./assets/...` 引用
- 图标名常量：`src/theme/icons.ts`（`@/theme/icons`），经 `components/ui/Icon` 使用
- 业务代码不要 `import` 本目录下的图片，除非启动图/品牌图；优先 `Icon` + `Icons` 常量
