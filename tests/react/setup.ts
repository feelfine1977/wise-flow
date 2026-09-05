// jsdom lacks the layout APIs React Flow relies on; these are the mocks its
// testing guide recommends. The file is a global setup, so it is a no-op in
// the Node environment of the core tests.
if (typeof window !== "undefined") {
  const rectOf = (target: Element) => {
    const el = target as HTMLElement;
    const width = parseFloat(el.style?.width) || el.offsetWidth || 800;
    const height = parseFloat(el.style?.height) || el.offsetHeight || 600;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
  };

  class ResizeObserverMock {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const rect = rectOf(target);
      const entry = { target, contentRect: rect, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }

  class DOMMatrixReadOnlyMock {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }

  Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverMock });
  Object.defineProperty(globalThis, "DOMMatrixReadOnly", { writable: true, value: DOMMatrixReadOnlyMock });

  Object.defineProperties(window.HTMLElement.prototype, {
    offsetHeight: {
      get() {
        return parseFloat((this as HTMLElement).style.height) || 600;
      },
    },
    offsetWidth: {
      get() {
        return parseFloat((this as HTMLElement).style.width) || 800;
      },
    },
  });

  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return rectOf(this) as DOMRect;
  };

  (globalThis as unknown as { SVGElement: { prototype: { getBBox: () => DOMRect } } }).SVGElement.prototype.getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }),
    });
  }
}
