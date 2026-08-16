/**
 * React Native CLI 配置：链接 react-native-vector-icons 字体资源。
 *
 * Android 主方案是 app/build.gradle 里的 fonts.gradle（自动把 ttf 打进 APK）；
 * 这里把字体目录声明为 assets，供 `npx react-native-asset` 使用：
 *  - iOS：把字体写入 Info.plist 的 UIAppFonts；
 *  - Android：作为 fonts.gradle 的补充（冗余无害）。
 */
module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts'],
};
