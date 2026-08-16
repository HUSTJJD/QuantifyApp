/**
 * 纯 JS 的 AsyncStorage mock（CJS）。
 * 通过 jest moduleNameMapper 直接替换原生 ESM 实现，避免 node 环境加载失败。
 */
let store = {};

const AsyncStorage = {
  getItem: (k) => Promise.resolve(store[k] ?? null),
  setItem: (k, v) => {
    store[k] = String(v);
    return Promise.resolve();
  },
  removeItem: (k) => {
    delete store[k];
    return Promise.resolve();
  },
  getAllKeys: () => Promise.resolve(Object.keys(store)),
  clear: () => {
    store = {};
    return Promise.resolve();
  },
  __reset: () => {
    store = {};
  },
};

module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
