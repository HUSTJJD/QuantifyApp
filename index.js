/**
 * @format
 */

// 必须最先加载：在 stock-sdk 等依赖现代 Web 全局 API 的模块求值前，补全 fetch /
// Headers / Request / Response / AbortController / AbortSignal / DOMException / TextEncoder 等。
import './src/polyfills/rn-globals';
// DEV 诊断：未处理 promise rejection 打印完整堆栈（必须早于 App 加载）
import './src/polyfills/promiseRejectionLog';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
