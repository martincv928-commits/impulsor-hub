import { useSyncExternalStore } from "react";
import { demoStore } from "./store";
import { DemoState } from "./types";

export function useDemoStore(): DemoState {
  return useSyncExternalStore(
    (onChange) => demoStore.subscribe(onChange),
    () => demoStore.getState()
  );
}
