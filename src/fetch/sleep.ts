/** The one timer in the request path, so fake timers drive every rule in it (SPEC 8.6). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
