// Polyfills for the macOS WKWebView, which lags Chrome/Edge on newer JS.
// pdf.js 6 calls Promise.withResolvers() (Safari 17.4+); macOS < 14.4 ships an
// older Safari, so provide it. Harmless where the engine already has it.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function") {
  (Promise as unknown as { withResolvers: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } }).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
