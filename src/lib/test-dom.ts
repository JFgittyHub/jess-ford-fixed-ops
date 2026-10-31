import { Window } from "happy-dom";

/** Installed before the app modules load so dialogs can attach to document.body. */
const dom = new Window({ url: "http://127.0.0.1:8080/" });

function install(key: string, value: unknown) {
  const current = Object.getOwnPropertyDescriptor(globalThis, key);
  if (current && !current.configurable && !current.writable) return;
  Object.defineProperty(globalThis, key, { value, configurable: true });
}

install("__JF_DEMO_MODE__", "true");
install("__JF_SHELL_MOUNT__", true);
install("window", dom);
install("document", dom.document);
install("HTMLElement", dom.HTMLElement);
install("Node", dom.Node);
install("localStorage", dom.localStorage);
install("location", dom.location);
install("history", dom.history);
install("navigator", dom.navigator);
install("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
install("cancelAnimationFrame", (id: number) => clearTimeout(id));
install("getComputedStyle", dom.getComputedStyle.bind(dom));
install("MutationObserver", dom.MutationObserver);
install("Event", dom.Event);
install("CustomEvent", dom.CustomEvent);
install("MouseEvent", dom.MouseEvent);
install("KeyboardEvent", dom.KeyboardEvent);
install("FocusEvent", dom.FocusEvent);
install("NodeFilter", dom.NodeFilter);
for (const key of Object.getOwnPropertyNames(dom)) {
  if (!(key.startsWith("HTML") || key.startsWith("SVG") || key === "Element")) continue;
  const value = (dom as unknown as Record<string, unknown>)[key];
  if (value) install(key, value);
}
