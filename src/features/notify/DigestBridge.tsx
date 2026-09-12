/**
 * 通知桥：把盘后摘要接入 AlertCenter 的应用内 Snackbar。
 * 后续换 expo-notifications 时只需替换本文件的 sink。
 */
import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { useAlertCenter } from '@/features/watchlist/alertCenter';
import { setDigestSink, startDigestScheduler, stopDigestScheduler } from './localDigest';

export function DigestBridge(): null {
  const { notify } = useAlertCenter();

  useEffect(() => {
    setDigestSink((title, body) => {
      // 用 AlertCenter 的 snackbar 通道（事件结构对齐 AlertEvent 简化版）
      notify([
        {
          ruleId: 'digest',
          type: 'pct',
          symbol: { code: '000001', exchange: 'SH', name: title },
          value: 0,
          message: body,
          time: Date.now(),
        },
      ]);
    });
    startDigestScheduler();
    return () => {
      stopDigestScheduler();
      setDigestSink(() => undefined);
    };
  }, [notify]);

  return null;
}

/** 设置页试发：无 snackbar 上下文时的兜底 */
export function fireDigestAlert(title: string, body: string): void {
  Alert.alert(title, body);
}
