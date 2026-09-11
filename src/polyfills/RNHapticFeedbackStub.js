/**
 * react-native-haptic-feedback 安全垫片。
 * 原生 TurboModule 未编入 APK 时 getEnforcing 会直接炸；
 * 这里用 get（非 enforcing）探测，缺失则 no-op。
 */
const { TurboModuleRegistry } = require('react-native');

let native = null;
try {
  native = TurboModuleRegistry.get('RNHapticFeedback');
} catch {
  native = null;
}

const RNHapticFeedback = {
  trigger: (type, _options) => {
    if (native && typeof native.trigger === 'function') {
      try {
        native.trigger(type, _options);
      } catch {
        // ignore
      }
    }
  },
};

module.exports = RNHapticFeedback;
module.exports.default = RNHapticFeedback;
