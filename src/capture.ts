export type LogLine = { level: string; message: string; at: number };
export type NetCall = { method: string; url: string; status: number; durationMs: number; at: number };

export class Ring<T> {
  private q: T[] = [];
  constructor(private cap: number) {}
  push(x: T) { this.q.push(x); if (this.q.length > this.cap) this.q.splice(0, this.q.length - this.cap); }
  all() { return this.q.slice(); }
}

export const logs = new Ring<LogLine>(200);
export const network = new Ring<NetCall>(100);
let ownHost = "astratest.dev";
export const setOwnHost = (h: string) => { ownHost = h; };

const str = (a: unknown) => {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try { return JSON.stringify(a); } catch { return String(a); }
};

export function log(level: string, message: string) {
  const m = message.slice(0, 2000);
  if (!m.trim() || m.startsWith("[AstraTest]")) return;
  logs.push({ level, message: m, at: Date.now() });
}

export function cleanUrl(u: string) {
  return u.split("#")[0].split("?")[0].slice(0, 500);
}

export function record(method: string, url: string, status: number, durationMs: number) {
  if (url.includes(ownHost)) return;
  network.push({ method: method.toUpperCase(), url: cleanUrl(url), status, durationMs, at: Date.now() });
}

let consolePatched = false;
/** Mirrors console.* and uncaught JS errors into the report log. */
export function patchConsole() {
  if (consolePatched) return;
  consolePatched = true;
  for (const level of ["log", "info", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => { log(level === "info" ? "log" : level, args.map(str).join(" ")); orig(...args); };
  }
  const EU = (globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
  if (EU) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e, fatal) => { log("error", `${fatal ? "Fatal: " : ""}${str(e)}`); prev(e, fatal); });
  }
}

let xhrPatched = false;
/** fetch() in React Native runs on XMLHttpRequest, so patching it records fetch, axios and the rest. */
export function patchXhr() {
  if (xhrPatched) return;
  const X = (globalThis as { XMLHttpRequest?: { prototype: XMLHttpRequest } }).XMLHttpRequest;
  if (!X) return;
  xhrPatched = true;
  const open = X.prototype.open, send = X.prototype.send;
  X.prototype.open = function (this: XMLHttpRequest & { __astra?: { m: string; u: string; t: number } }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__astra = { m: method, u: String(url), t: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (open as any).call(this, method, url, ...rest);
  } as typeof open;
  X.prototype.send = function (this: XMLHttpRequest & { __astra?: { m: string; u: string; t: number } }, body?: unknown) {
    const a = this.__astra;
    if (a) {
      a.t = Date.now();
      this.addEventListener("loadend", () => record(a.m, a.u, this.status, Date.now() - a.t));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (send as any).call(this, body);
  };
}
