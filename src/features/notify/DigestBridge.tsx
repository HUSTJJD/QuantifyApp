/**
 * 通知桥：应用内 Snackbar + 通道扇出的 inApp 实现。
 */
import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { useAlertCenter } from '@/features/watchlist/alertCenter';
import { setDigestSink, startDigestScheduler, stopDigestScheduler } from './localDigest';
import { setInAppNotifier } from './channels';

export function DigestBridge(): null {
  const { notify } = useAlertCenter();

  useEffect(() => {
    const push = (title: string, body: string) => {
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
    };
    setDigestSink(push);
    setInAppNotifier((p) => push(p.title, p.body));
    startDigestScheduler();
    return () => {
      stopDigestScheduler();
      setDigestSink(() => undefined);
      setInAppNotifier(null);
    };
  }, [notify]);

  return null;
}

/** 设置页试发：无 snackbar 上下文时的兜底 */
export function fireDigestAlert(title: string, body: string): void {
  Alert.alert(title, body);
}
