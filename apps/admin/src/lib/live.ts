import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { SocketEvent, type OrderView, type UsageSummary } from '@cullinari/shared';
import { API_URL, getToken } from './api';

/** Origin for Socket.IO: same origin in dev (through the Vite proxy), else the API's origin. */
function socketOrigin() {
  return API_URL.startsWith('http') ? new URL(API_URL).origin : window.location.origin;
}

/**
 * One live connection per signed-in session. New and updated orders are merged into the
 * cached order lists, so every screen showing orders updates without refetching.
 */
export function useLiveEvents(enabled: boolean, onNewOrder?: (o: OrderView) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const cb = useRef(onNewOrder);
  cb.current = onNewOrder;

  useEffect(() => {
    if (!enabled) return;
    const socket: Socket = io(`${socketOrigin()}/admin`, {
      auth: { token: getToken() },
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    const upsert = (order: OrderView) => {
      // Active-order lists are keyed ['orders', 'active', branchId | 'all'].
      for (const query of qc.getQueryCache().findAll({ queryKey: ['orders', 'active'] })) {
        const branch = query.queryKey[2];
        qc.setQueryData<OrderView[]>(query.queryKey, (list) => {
          if (!list) return list;
          const done = order.status === 'completed' || order.status === 'cancelled';
          const belongs = branch === 'all' || branch === order.branchId;
          const rest = list.filter((o) => o.id !== order.id);
          return done || !belongs ? rest : [...rest, order].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
        });
      }
      qc.setQueryData(['order', order.id], order);
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (order.status === 'completed' || order.status === 'cancelled') {
        void qc.invalidateQueries({ queryKey: ['orders', 'history'] });
      }
    };

    socket.on(SocketEvent.ORDER_CREATED, (o: OrderView) => {
      upsert(o);
      cb.current?.(o);
    });
    socket.on(SocketEvent.ORDER_UPDATED, upsert);
    socket.on(SocketEvent.USAGE_UPDATED, (u: UsageSummary) => qc.setQueryData(['usage'], u));
    // After a reconnect, refetch in case events were missed.
    socket.io.on('reconnect', () => void qc.invalidateQueries({ queryKey: ['orders'] }));

    return () => {
      socket.disconnect();
    };
  }, [enabled, qc]);

  return connected;
}

/** Short two-tone chime for new orders, generated so there's no audio file to ship. */
export function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}
