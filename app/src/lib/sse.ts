// Minimal Server-Sent Events client on top of React Native's XMLHttpRequest, which delivers
// incremental responseText when an onprogress handler is attached. Reconnects with backoff
// and resumes with Last-Event-ID.

import { normalizeStreamMessage } from "./engineDemo";

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export interface SseHandle {
  close(): void;
}

export interface SseOptions {
  onMessage: (m: SseMessage) => void;
  onOpen?: () => void;
  onError?: (e: unknown) => void;
  /** Max reconnect delay (ms). */
  maxDelay?: number;
}

/** Parses an SSE text chunk; returns complete messages and the unconsumed tail. */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const norm = buffer.replace(/\r\n/g, "\n");
  const blocks = norm.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
    }
    if (data.length) messages.push({ event, data: data.join("\n"), id });
  }
  return { messages, rest };
}

export function openSse(url: string, rawOpts: SseOptions): SseHandle {
  // Engine envelopes ({type, item} feed frames, demo step events, keeper-internal frames) become app messages.
  const opts: SseOptions = {
    ...rawOpts,
    onMessage: (m) => {
      const n = normalizeStreamMessage(m);
      if (n) rawOpts.onMessage(n);
    },
  };
  let closed = false;
  let xhr: XMLHttpRequest | null = null;
  let lastId: string | undefined;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    let seen = 0;
    let buf = "";
    const x = new XMLHttpRequest();
    xhr = x;
    x.open("GET", url);
    // Only CORS-safelisted headers on the first connect, so browsers don't need a preflight.
    x.setRequestHeader("Accept", "text/event-stream");
    if (lastId) x.setRequestHeader("Last-Event-ID", lastId);
    x.onprogress = () => {
      const text = x.responseText ?? "";
      const chunk = text.slice(seen);
      seen = text.length;
      if (!chunk) return;
      if (attempt > 0 || seen === chunk.length) {
        attempt = 0;
      }
      buf += chunk;
      const { messages, rest } = parseSse(buf);
      buf = rest;
      for (const m of messages) {
        if (m.id) lastId = m.id;
        try {
          opts.onMessage(m);
        } catch (e) {
          opts.onError?.(e);
        }
      }
    };
    x.onreadystatechange = () => {
      if (x.readyState === 2 && x.status >= 200 && x.status < 300) opts.onOpen?.();
      if (x.readyState === 4) {
        if (closed) return;
        opts.onError?.(new Error(`stream ended (${x.status})`));
        schedule();
      }
    };
    x.onerror = () => {
      /* handled by readyState 4 */
    };
    x.send();
  };

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(opts.maxDelay ?? 15000, 1000 * 2 ** Math.min(attempt, 4));
    attempt++;
    timer = setTimeout(connect, delay);
  };

  connect();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      try {
        xhr?.abort();
      } catch {}
    },
  };
}
