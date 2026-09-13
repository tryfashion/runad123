// Serialized into the page's isolated world; keep runtime helpers inside this function.
export function copyUnlock(enabled?: boolean) {
  const state = globalThis as typeof globalThis & { runadCopyUnlock?: () => void };
  if (enabled === undefined) return Boolean(state.runadCopyUnlock);
  state.runadCopyUnlock?.();
  delete state.runadCopyUnlock;
  if (!enabled) return false;
  const events = [
    'copy',
    'cut',
    'paste',
    'contextmenu',
    'selectstart',
    'dragstart',
    'keydown',
    'keyup',
  ];
  const allow = (event: Event) => {
    if (
      event instanceof KeyboardEvent &&
      (!(event.ctrlKey || event.metaKey) || !['a', 'c', 'x', 'v'].includes(event.key.toLowerCase()))
    )
      return;
    // Stop website handlers without cancelling the browser's native action.
    event.stopImmediatePropagation();
  };
  for (const name of events) window.addEventListener(name, allow, true);
  state.runadCopyUnlock = () => {
    for (const name of events) window.removeEventListener(name, allow, true);
  };
  return true;
}
export const copyUnlockCss =
  '* { user-select: text !important; -webkit-user-select: text !important; -webkit-touch-callout: default !important; }';
