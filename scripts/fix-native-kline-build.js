/**
 * postinstall 钩子：修复 Android 构建配置在新版 AGP（9.x）下的兼容问题。
 *
 * 修复项 1：native-kline-view
 *   库的 android/build.gradle 使用了已废弃的
 *     getDefaultProguardFile('proguard-android.txt')
 *   新版 AGP/R8 不再支持该文件（它内含 -dontoptimize，阻止 R8 优化）。
 *   需改为 'proguard-android-optimize.txt'。
 *
 * 修复项 2：@react-native-async-storage/async-storage
 *   库在 AGP 9 下（gradle.properties 设置 builtInKotlin=true 由 AGP 统一接管 kotlin
 *   编译与扩展注册）仍自行 apply plugin: "kotlin-android"，导致
 *     "Cannot add extension with name 'kotlin'"
 *   重复注册报错。AGP 已接管 kotlin，故需移除库里这一行手动 apply。
 *
 * 修复项 1（native-kline-view proguard）已直接落到 fork 源码
 *   （https://github.com/HUSTJJD/native-kline-view，子模块 native-kline-view/），
 *   不再需要在 postinstall 里打补丁。
 *
 * 仅保留修复项 2：@react-native-async-storage/async-storage 在 AGP 9 下
 *   （gradle.properties 设置 builtInKotlin=true 由 AGP 统一接管 kotlin 编译与
 *   扩展注册）仍自行 apply plugin: "kotlin-android"，导致
 *     "Cannot add extension with name 'kotlin'"
 *   重复注册报错。AGP 已接管 kotlin，故需移除库里这一行手动 apply。
 *   该库从 npm 安装，node_modules 重装时会被覆盖，故用 postinstall 自动修复。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function fixFile(file, replacements) {
  if (!fs.existsSync(file)) {
    console.log(`[fix-build] 跳过（文件不存在）: ${file}`);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const { old, new: replacement, label } of replacements) {
    if (content.includes(old)) {
      content = content.split(old).join(replacement);
      changed = true;
      console.log(`[fix-build] ${label}: ${file}`);
    }
  }
  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
  } else {
    console.log(`[fix-build] 已是最新，无需修复: ${file}`);
  }
}

// 修复项 2：async-storage 在 AGP 9 下重复 apply kotlin-android
fixFile(
  path.join(
    ROOT,
    'node_modules',
    '@react-native-async-storage',
    'async-storage',
    'android',
    'build.gradle'
  ),
  [
    {
      // AGP 已通过 builtInKotlin=true 接管 kotlin 扩展与编译，移除库内手动 apply 避免重复注册
      old: 'apply plugin: "kotlin-android"\n',
      new: '// kotlin-android 已由 AGP 9 (builtInKotlin=true) 统一接管，移除以避免重复注册冲突\n',
      label: '移除重复的 kotlin-android apply',
    },
  ]
);

