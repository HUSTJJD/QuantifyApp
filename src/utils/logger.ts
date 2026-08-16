/**
 * App 级日志模块。
 *
 * 设计目标：
 *  - 分级：debug / info / warn / error，带 tag + 时间戳；
 *  - 双输出：console（开发期） + 内存环形缓冲（可在 App 内查看/导出，真机无 debugger 时也能 debug）；
 *  - 全局开关：生产环境可关闭 debug/info，仅保留 warn/error；
 *  - 不依赖任何第三方库，纯 RN 可用。
 */
import { Platform } from 'react-native';

/**
 * App 专属日志 TAG。
 * - Android 上 RN 的 console.* 统一打到 Logcat tag `ReactNativeJS`，
 *   因此这里把 APP_TAG 作为消息前缀注入，adb 可用 `logcat | grep QuantifyApp`
 *   （或 `logcat -s ReactNativeJS | grep QuantifyApp`）精确抓取本 App 日志。
 * - 如需按模块细抓：`logcat | grep 'QuantifyApp:MarketData'`。
 */
export const APP_TAG = 'QuantifyApp';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  level: LogLevel;
  tag: string;
  message: string;
  timestamp: number;
  /** 附加上下文，如请求参数、错误对象信息 */
  extra?: unknown;
}

const MAX_BUFFER = 500;

class Logger {
  private buffer: LogEntry[] = [];
  /** 低于该级别的日志不写入 console / 内存缓冲 */
  private minLevel: LogLevel = __DEV__ ? 'debug' : 'warn';

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  private emit(level: LogLevel, tag: string, message: string, extra?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      level,
      tag,
      message,
      timestamp: Date.now(),
      extra,
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();

    const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
    // APP_TAG 作为 Logcat 抓取锚点：adb logcat | grep QuantifyApp
    // 两级 tag：QuantifyApp(全局) : tag(模块)，可按模块细抓，如 grep 'QuantifyApp:MarketData'
    const prefix = `[${ts}][${level.toUpperCase()}][${APP_TAG}:${tag}]`;
    const body = extra !== undefined ? `${message} :: ${safeStringify(extra)}` : message;

    switch (level) {
      case 'debug':
        console.log(prefix, body);
        break;
      case 'info':
        console.info(prefix, body);
        break;
      case 'warn':
        console.warn(prefix, body);
        break;
      case 'error':
        console.error(prefix, body);
        break;
    }
  }

  debug(tag: string, message: string, extra?: unknown): void {
    this.emit('debug', tag, message, extra);
  }
  info(tag: string, message: string, extra?: unknown): void {
    this.emit('info', tag, message, extra);
  }
  warn(tag: string, message: string, extra?: unknown): void {
    this.emit('warn', tag, message, extra);
  }
  error(tag: string, message: string, extra?: unknown): void {
    this.emit('error', tag, message, extra);
  }

  /** 读取内存日志（最新在末尾），供 App 内日志面板使用 */
  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  /** 清空内存日志 */
  clear(): void {
    this.buffer = [];
  }

  /** 导出为可读文本（用于分享/排查） */
  exportText(): string {
    return this.buffer
      .map((e) => {
        const ts = new Date(e.timestamp).toISOString();
        const body = e.extra !== undefined ? `${e.message} :: ${safeStringify(e.extra)}` : e.message;
        return `${ts} [${e.level.toUpperCase()}] [${APP_TAG}:${e.tag}] ${body}`;
      })
      .join('\n');
  }
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) {
    return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ''}`;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const logger = new Logger();
export const log = logger;
export const platformTag = Platform.OS;
