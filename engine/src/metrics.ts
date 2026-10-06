/** Minimal Prometheus text-format registry (counters, gauges, summaries with fixed quantiles). */

type Labels = Record<string, string | number>;

const key = (labels?: Labels) =>
  labels && Object.keys(labels).length
    ? '{' + Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',') + '}'
    : '';

abstract class Metric {
  constructor(readonly name: string, readonly help: string, readonly type: string) {}
  abstract lines(): string[];
}

class Counter extends Metric {
  private values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }
  inc(labels?: Labels, by = 1) {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels?: Labels) {
    return this.values.get(key(labels)) ?? 0;
  }
  lines() {
    return [...this.values].map(([k, v]) => `${this.name}${k} ${v}`);
  }
}

class Gauge extends Metric {
  private values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, 'gauge');
  }
  set(v: number, labels?: Labels) {
    this.values.set(key(labels), v);
  }
  lines() {
    return [...this.values].map(([k, v]) => `${this.name}${k} ${v}`);
  }
}

class Summary extends Metric {
  private samples: number[] = [];
  private sum = 0;
  private count = 0;
  constructor(name: string, help: string, private readonly window = 1000) {
    super(name, help, 'summary');
  }
  observe(v: number) {
    this.samples.push(v);
    if (this.samples.length > this.window) this.samples.shift();
    this.sum += v;
    this.count += 1;
  }
  quantile(q: number) {
    if (!this.samples.length) return NaN;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  }
  lines() {
    return [
      ...[0.5, 0.9, 0.99].map((q) => `${this.name}{quantile="${q}"} ${this.quantile(q)}`),
      `${this.name}_sum ${this.sum}`,
      `${this.name}_count ${this.count}`,
    ];
  }
}

const all: Metric[] = [];
const reg = <T extends Metric>(m: T) => (all.push(m), m);

export const metrics = {
  leaderEvents: reg(new Counter('mirror_leader_events_total', 'Perpl position events for followed leaders')),
  perplEvents: reg(new Counter('mirror_perpl_position_events_total', 'All Perpl position events seen')),
  copiesPlanned: reg(new Counter('mirror_copies_planned_total', 'Copy orders planned')),
  copiesSubmitted: reg(new Counter('mirror_copies_submitted_total', 'Copy transactions by outcome')),
  copiesBlocked: reg(new Counter('mirror_copies_blocked_total', 'Blocked copies by reason')),
  copyLatency: reg(new Summary('mirror_copy_latency_ms', 'Leader fill observed to copy tx included, ms')),
  txSent: reg(new Counter('mirror_tx_sent_total', 'Transactions sent by sender and status')),
  txErrors: reg(new Counter('mirror_tx_errors_total', 'Transaction send errors by kind')),
  circuitOpen: reg(new Gauge('mirror_circuit_open', 'Circuit breaker open (1) per sender')),
  balanceWei: reg(new Gauge('mirror_signer_balance_wei', 'Native balance per signer')),
  headBlock: reg(new Gauge('mirror_head_block', 'Latest head block seen')),
  indexerLag: reg(new Gauge('mirror_indexer_lag_blocks', 'Registry indexer lag in blocks')),
  perplWsConnected: reg(new Gauge('mirror_perpl_ws_connected', 'Perpl market-data WebSocket connected')),
  perplWsMessages: reg(new Counter('mirror_perpl_ws_messages_total', 'Perpl WS messages by type')),
  perplMarkAgeMs: reg(new Gauge('mirror_perpl_mark_age_ms', 'Age of the latest Perpl WS mark per market')),
  httpRequests: reg(new Counter('mirror_http_requests_total', 'HTTP requests by route and status')),
  relayCalls: reg(new Counter('mirror_relay_calls_total', 'Relay calls by kind and outcome')),
  demoCycles: reg(new Counter('mirror_demo_cycles_total', 'Demo cycles by kind and outcome')),
  nansenCalls: reg(new Counter('mirror_nansen_calls_total', 'Nansen calls by endpoint and outcome')),
};

export function renderMetrics(): string {
  const out: string[] = [];
  for (const m of all) {
    out.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`, ...m.lines());
  }
  return out.join('\n') + '\n';
}
