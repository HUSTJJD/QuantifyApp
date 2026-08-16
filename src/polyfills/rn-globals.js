/**
 * RN 全局 API 补全（polyfill）。
 *
 * stock-sdk / stock-api 在 fetch 层依赖若干 Web 标准全局对象，而 RN 的
 * JavaScriptCore / Hermes 运行时缺少其中一部分，直接引用会抛
 * 「Property 'XXX' doesn't exist」：
 *   - DOMException：stock-api 的 isAbortError 用 `error instanceof DOMException` 判断中断；
 *   - TextDecoder：stock-api 解析响应体 `new TextDecoder('utf-8').decode(body)`；
 *   - TextEncoder：stock-api（iconv 等）编码时使用；
 *   - AbortController / AbortSignal：请求超时中断。
 *
 * 该模块必须在任何依赖 stock-sdk 的模块求值之前加载（见 index.js 顶部 import）。
 */
/* eslint-disable no-undef */

// AbortController / AbortSignal：现代 RN 通常已自带；缺失时补最小实现。
if (typeof globalThis.AbortController === 'undefined') {
  class AbortSignalPolyfill {
    constructor() {
      this.aborted = false;
      this.onabort = null;
    }
    abort() {
      this.aborted = true;
      if (this.onabort) this.onabort();
    }
  }
  class AbortControllerPolyfill {
    constructor() {
      this.signal = new AbortSignalPolyfill();
    }
    abort() {
      this.signal.abort();
    }
  }
  globalThis.AbortController = AbortControllerPolyfill;
  globalThis.AbortSignal = AbortSignalPolyfill;
}

// DOMException：RN 缺失，必须补。用已存在的 AbortSignal 构造符合语义的 AbortError 实例。
if (typeof globalThis.DOMException === 'undefined') {
  class DOMExceptionPolyfill extends Error {
    constructor(message, name) {
      super(message);
      this.name = name || 'Error';
    }
  }
  globalThis.DOMException = DOMExceptionPolyfill;
}

// TextEncoder / TextDecoder：RN JSCore 普遍缺失，按 UTF-8 实现最小可用版本。
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    constructor(encoding = 'utf-8') {
      this.encoding = (encoding || 'utf-8').toLowerCase();
    }
    decode(input) {
      if (input == null) return '';
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      let result = '';
      let i = 0;
      const len = bytes.length;
      while (i < len) {
        const byte = bytes[i++];
        if (byte <= 0x7f) {
          result += String.fromCharCode(byte);
        } else if (byte >= 0xc0 && byte <= 0xdf) {
          const b2 = bytes[i++];
          result += String.fromCharCode(((byte & 0x1f) << 6) | (b2 & 0x3f));
        } else if (byte >= 0xe0 && byte <= 0xef) {
          const b2 = bytes[i++];
          const b3 = bytes[i++];
          result += String.fromCharCode(((byte & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
        } else if (byte >= 0xf0 && byte <= 0xf7) {
          const b2 = bytes[i++];
          const b3 = bytes[i++];
          const b4 = bytes[i++];
          let cp = ((byte & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
          cp -= 0x10000;
          result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else {
          // 非法续字节：跳过，保持健壮
        }
      }
      return result;
    }
  };
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class {
    constructor(encoding = 'utf-8') {
      this.encoding = (encoding || 'utf-8').toLowerCase();
    }
    encode(input = '') {
      const str = String(input);
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff) {
          // 代理对
          const hi = code;
          const lo = str.charCodeAt(++i);
          code = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
          bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
        } else {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
      }
      return new Uint8Array(bytes);
    }
  };
}

export {};
