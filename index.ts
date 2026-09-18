/**
 * Expo / RN 入口：注册根组件。
 * 业务初始化与导航见 App.tsx / src/navigation。
 *
 * 注意：react-native-gesture-handler 必须在任何业务模块之前 import，
 * 否则 Android 上手势/ScrollView 滚动可能失效。
 */
import 'react-native-gesture-handler';
import './src/polyfills/rn-globals';
import './src/polyfills/promiseRejectionLog';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
