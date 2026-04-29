export type Throttler = ReturnType<typeof throttle>;

export function throttle(fn: () => void, ms: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    if (typeof timeout === "undefined") {
      timeout = setTimeout(() => {
        timeout = undefined;
        fn();
      }, ms);
    }
  }

  function cancel() {
    if (typeof timeout !== "undefined") {
      clearTimeout(timeout);
      timeout = undefined;
    }
  }

  function flush() {
    cancel();
    fn();
  }

  return { schedule, cancel, flush };
}

export type Debouncer = ReturnType<typeof debounce>;

export function debounce(fn: () => void, ms: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    cancel();
    timeout = setTimeout(() => {
      timeout = undefined;
      fn();
    }, ms);
  }

  function cancel() {
    if (typeof timeout !== "undefined") {
      clearTimeout(timeout);
      timeout = undefined;
    }
  }

  function flush() {
    const shouldRun = typeof timeout !== "undefined";
    cancel();
    if (shouldRun) {
      fn();
    }
  }

  return { schedule, cancel, flush };
}
