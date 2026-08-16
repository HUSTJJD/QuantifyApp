/**
 * postinstall 钩子：修复 Android 构建配置在新版 AGP（9.x）下的兼容问题。
 *
 * 背景：AGP 9 有两类破坏性变更，第三方库普遍未适配：
 *   (a) builtInKotlin=true 时，库里手动 `apply plugin: "kotlin-android"` 会导致
 *       "Cannot add extension with name 'kotlin'" 重复注册；
 *       且 .kt 源码必须放 kotlin.srcDirs（放 java.srcDirs 不会被编译）。
 *   (b) 已移除 compileSdkVersion DSL、libraryVariants 等旧 API，
 *       并强制 Groovy 赋值语法（namespace = "x"，而非 namespace "x"）。
 *
 * 这些库都从 npm 安装，node_modules 重装即被覆盖，故在 postinstall 自动打补丁。
 * 文件不存在时 fixFile 会跳过，因此删依赖后残留的补丁块是死代码，应及时清理。
 *
 * 当前修复项（详见文件内各处注释）：
 *   2：@react-native-async-storage/async-storage（kotlin-android 重复 apply）
 *   3：async-storage 的 Groovy 空格赋值语法
 *   4：其余第三方库（linear-gradient / safe-area-context / svg / vector-icons）同 (b)
 *   5：@nozbe/watermelondb
 *   6：@op-engineering/op-sqlite（本地库引擎）
 *
 * 已移除：native-kline-view 的 proguard 修复直接落到 fork 源码
 *   （https://github.com/HUSTJJD/native-kline-view，子模块 native-kline-view/）；
 *   react-native-nitro-modules / react-native-nitro-sqlite 的修复项随依赖一并删除。
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

// 修复项 3：async-storage 使用 Groovy 空格赋值语法（如 namespace "x"、buildConfig true），
// 在 Gradle 9.4 下触发 "scheduled to be removed in Gradle 10" 弃用警告。
// 改为 'prop = value' 赋值语法以消除该弃用警告。
// 注意：kotlin.srcDirs 写法必须保留——AGP 9 builtInKotlin=true 下 kotlin 源集不会从
// java.srcDirs 自动编译 kotlin 文件，移除会导致 compileDebugKotlin 失败；其触发的
// "Kotlin source set contains ..." 校验由 gradle.properties 的 disallowKotlinSourceSets=false 关闭。
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
      old: '    namespace "org.asyncstorage"\n',
      new: '    namespace = "org.asyncstorage"\n',
      label: 'async-storage namespace 改为赋值语法',
    },
    {
      old: '        buildConfig true\n',
      new: '        buildConfig = true\n',
      label: 'async-storage buildConfig 改为赋值语法',
    },
  ]
);

// 修复项 4：其余第三方库使用 Groovy 空格赋值语法（namespace "x"、abortOnError false、
// url "x"、ndkVersion x、versionCode x 等），触发 "scheduled to be removed in Gradle 10"
// 弃用警告。统一改为 'prop = value' 赋值语法。仅改动属性赋值，不碰方法调用
// （如 compileSdkVersion/minSdkVersion/targetSdkVersion 等），避免破坏构建。
// 字符串精确匹配各库当前版本；库升级后不匹配则自动跳过（安全 no-op）。
const THIRD_PARTY_LIBS = [
  {
    name: 'react-native-linear-gradient',
    file: 'node_modules/react-native-linear-gradient/android/build.gradle',
    replacements: [
      { old: '        abortOnError false\n', new: '        abortOnError = false\n', label: 'linear-gradient abortOnError' },
      { old: '        url "$rootDir/../node_modules/react-native/android"\n', new: '        url = "$rootDir/../node_modules/react-native/android"\n', label: 'linear-gradient url' },
      { old: '        url "$rootDir/../node_modules/jsc-android/dist"\n', new: '        url = "$rootDir/../node_modules/jsc-android/dist"\n', label: 'linear-gradient jsc url' },
    ],
  },
  {
    name: 'react-native-safe-area-context',
    file: 'node_modules/react-native-safe-area-context/android/build.gradle',
    replacements: [
      { old: '        namespace "com.th3rdwave.safeareacontext"\n', new: '        namespace = "com.th3rdwave.safeareacontext"\n', label: 'safe-area-context namespace' },
      { old: '            buildConfig true\n', new: '            buildConfig = true\n', label: 'safe-area-context buildConfig' },
      { old: '        abortOnError false\n', new: '        abortOnError = false\n', label: 'safe-area-context abortOnError' },
      { old: '        ndkPath rootProject.ext.ndkPath\n', new: '        ndkPath = rootProject.ext.ndkPath\n', label: 'safe-area-context ndkPath' },
      { old: '        ndkVersion rootProject.ext.ndkVersion\n', new: '        ndkVersion = rootProject.ext.ndkVersion\n', label: 'safe-area-context ndkVersion' },
      { old: '        versionCode 1\n', new: '        versionCode = 1\n', label: 'safe-area-context versionCode' },
      { old: '        versionName "1.0"\n', new: '        versionName = "1.0"\n', label: 'safe-area-context versionName' },
      { old: '        url "$rootDir/../node_modules/react-native/android"\n', new: '        url = "$rootDir/../node_modules/react-native/android"\n', label: 'safe-area-context url' },
    ],
  },
  {
    name: 'react-native-svg',
    file: 'node_modules/react-native-svg/android/build.gradle',
    replacements: [
      { old: '    namespace "com.horcrux.svg"\n', new: '    namespace = "com.horcrux.svg"\n', label: 'svg namespace' },
      { old: '        abortOnError false\n', new: '        abortOnError = false\n', label: 'svg abortOnError' },
      { old: '        ndkVersion rootProject.ext.ndkVersion\n', new: '        ndkVersion = rootProject.ext.ndkVersion\n', label: 'svg ndkVersion' },
      { old: '        url "$rootDir/../node_modules/react-native/android"\n', new: '        url = "$rootDir/../node_modules/react-native/android"\n', label: 'svg url' },
    ],
  },
  {
    name: 'react-native-vector-icons',
    file: 'node_modules/react-native-vector-icons/android/build.gradle',
    replacements: [
      { old: '        url "$projectDir/../node_modules/react-native/android"\n', new: '        url = "$projectDir/../node_modules/react-native/android"\n', label: 'vector-icons url' },
    ],
  },
];

for (const lib of THIRD_PARTY_LIBS) {
  fixFile(path.join(ROOT, lib.file), lib.replacements);
}

// 修复项 5：@nozbe/watermelondb 在 AGP 9 下的兼容问题
//   (a) native/android/build.gradle 仍手动 apply plugin: 'kotlin-android'，
//       与 AGP 9 builtInKotlin 已注册的 kotlin 扩展冲突，报
//       "Cannot add extension with name 'kotlin'"。用 try/catch 包裹以兼容 AGP 8/9。
//   (b) native/android 与 native/android-jsi 的 build.gradle 使用已移除的
//       compileSdkVersion DSL，AGP 9 要求 compileSdk，否则报
//       "does not specify `compileSdk`"。
fixFile(
  path.join(
    ROOT,
    'node_modules',
    '@nozbe',
    'watermelondb',
    'native',
    'android',
    'build.gradle'
  ),
  [
    {
      // 仅匹配未打补丁的两行连续块，避免对已打补丁（含 try/catch）的文件重复嵌套
      old: "apply plugin: 'com.android.library'\napply plugin: 'kotlin-android'\n",
      new:
        "apply plugin: 'com.android.library'\n" +
        "try {\n" +
        "    apply plugin: 'kotlin-android'\n" +
        "} catch (Exception e) {\n" +
        "    // kotlin 扩展已由 AGP 9 builtInKotlin 注册，忽略重复注册\n" +
        "}\n",
      label: 'watermelondb 包裹 kotlin-android apply',
    },
    {
      old: "    compileSdkVersion getExtOrIntegerDefault('compileSdkVersion')\n",
      new: "    compileSdk getExtOrIntegerDefault('compileSdkVersion')\n",
      label: 'watermelondb compileSdkVersion -> compileSdk',
    },
    {
      // AGP 9 下 BuildConfig 默认不生成，但 watermelondb 原生代码引用了 BuildConfig.DEBUG
      old: '    namespace "com.nozbe.watermelondb"\n\n    defaultConfig',
      new: '    namespace "com.nozbe.watermelondb"\n\n    buildFeatures {\n        buildConfig = true\n    }\n\n    defaultConfig',
      label: 'watermelondb 启用 buildConfig',
    },
  ]
);

fixFile(
  path.join(
    ROOT,
    'node_modules',
    '@nozbe',
    'watermelondb',
    'native',
    'android-jsi',
    'build.gradle'
  ),
  [
    {
      old: "    compileSdkVersion rootProject.hasProperty('compileSdkVersion') ? rootProject.compileSdkVersion : DEFAULT_COMPILE_SDK_VERSION\n",
      new: "    compileSdk rootProject.hasProperty('compileSdkVersion') ? rootProject.compileSdkVersion : DEFAULT_COMPILE_SDK_VERSION\n",
      label: 'watermelondb-jsi compileSdkVersion -> compileSdk',
    },
  ]
);

// 修复项 6：@op-engineering/op-sqlite 在 AGP 9 下的兼容问题
//   (a) 仍手动 apply plugin: "kotlin-android"，与 AGP 9 builtInKotlin 已注册的
//       kotlin 扩展冲突，报 "Cannot add extension with name 'kotlin'"。
//   (b) 使用已移除的 compileSdkVersion DSL，AGP 9 要求 compileSdk，否则报
//       "does not specify compileSdk"。
fixFile(
  path.join(
    ROOT,
    'node_modules',
    '@op-engineering',
    'op-sqlite',
    'android',
    'build.gradle'
  ),
  [
    {
      old: 'apply plugin: "com.android.library"\napply plugin: "kotlin-android"\n',
      new:
        'apply plugin: "com.android.library"\n' +
        'try {\n' +
        '    apply plugin: "kotlin-android"\n' +
        '} catch (Exception e) {\n' +
        '    // kotlin 扩展已由 AGP 9 builtInKotlin 注册，忽略重复注册\n' +
        '}\n',
      label: 'op-sqlite 包裹 kotlin-android apply',
    },
    {
      old: '  compileSdkVersion getExtOrIntegerDefault("compileSdkVersion")\n',
      new: '  ndkVersion getExtOrDefault("ndkVersion")\n  compileSdk getExtOrIntegerDefault("compileSdkVersion")\n',
      label: 'op-sqlite ndkVersion + compileSdkVersion -> compileSdk',
    },
  ]
);

