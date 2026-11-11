'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// A server-rendered control must not submit before its client handler is attached.
export function useHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
