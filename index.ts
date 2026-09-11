/**
 * Expo / RN 入口：注册根组件。
 * 业务初始化与导航见 App.tsx / src/navigation。
 */
import './src/polyfills/rn-globals';
import './src/polyfills/promiseRejectionLog';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
