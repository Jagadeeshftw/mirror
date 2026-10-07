// Wires ShareService to the chain, the push service and the bus: links close when a close shows up in the account's
// feed (a copied close, a fired level, Close position, Close all) and on a periodic sweep.
import type { Address, Hex, PublicClient } from 'viem';
import { mirrorAccountAbi } from '../abi/MirrorAccount.js';
import type { Reads } from '../chain/reads.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { MarketData } from '../perpl/market.js';
import type { Bus } from './bus.js';
import type { PushService } from './push.js';
import { ShareService as Core, type ShareDeps } from './share.js';

const CLOSE_KINDS = new Set(['StopTriggered', 'MarketClosed', 'ClosedAll']);
const SWEEP_MS = 60_000;

export class ShareService extends Core {
  private off?: () => void;
  private timer?: NodeJS.Timeout;
  constructor(deps: ShareDeps, private readonly bus: Bus) {
    super(deps);
  }
  watch() {
    this.off = this.bus.subscribeAll((channel, e) => {
      if (e.type !== 'feed' || channel === 'demo') return;
      const it = e.item as { kind?: string; orderType?: number | null } | undefined;
      if (!it?.kind) return;
      if (CLOSE_KINDS.has(it.kind) || (it.kind === 'Mirrored' && Number(it.orderType) >= 2)) void this.sweep(channel).catch(() => {});
    });
    this.timer = setInterval(() => void this.sweep().catch(() => {}), SWEEP_MS);
    this.timer.unref();
  }
  unwatch() {
    this.off?.();
    clearInterval(this.timer);
  }
}

export interface ShareWiring {
  db: Db;
  client: PublicClient;
  reads: Reads;
  market: MarketData;
  bus: Bus;
  push: PushService;
  chainId: number;
  head: () => number;
  hit: ShareDeps['hit'];
  env: Config['env'];
}

export function startShareService(w: ShareWiring): ShareService {
  const deps: ShareDeps = {
    db: w.db,
    chainId: w.chainId,
    readOwner: (a: Address) => w.client.readContract({ address: a, abi: mirrorAccountAbi, functionName: 'owner' }) as Promise<Address>,
    position: async (perplId, perpId) => {
      const p = await w.reads.position(perpId, perplId);
      return { side: p.side, lots: p.lots, entryPNS: p.entryPricePNS, markPNS: p.mark, depositCNS: p.depositCNS, pnlCNS: p.pnlCNS };
    },
    level: (a, perpId) => w.reads.level(a, perpId),
    leaderOf: async (a, perpId) => {
      const id = await w.reads.marketLeader(a, perpId);
      return id ? ((await w.reads.accountAddress(id)) ?? null) : null;
    },
    market: (perpId) => w.market.meta(perpId),
    head: w.head,
    alert: (owner, account, p) => w.push.deliver(owner, account, p),
    ownerKeys: (owner) => w.db.all<{ k: string }>('SELECT DISTINCT notify_public_key AS k FROM push_subs WHERE owner = ?', owner.toLowerCase()).map((r) => r.k),
    receipt: async (hash: Hex) => {
      const r = await w.client.getTransactionReceipt({ hash });
      return { status: r.status, logs: r.logs.map((g) => ({ address: g.address, topics: g.topics as Hex[], data: g.data })) };
    },
    publish: (account) => w.bus.publish(account, { type: 'share' }),
    hit: w.hit,
    limits: {
      linkIpHourly: w.env.SHARE_SUGGEST_LINK_IP_HOURLY,
      linkHourly: w.env.SHARE_SUGGEST_LINK_HOURLY,
      ipHourly: w.env.SHARE_SUGGEST_IP_HOURLY,
      maxOpenLinks: w.env.SHARE_MAX_OPEN_LINKS,
      maxPending: w.env.SHARE_MAX_PENDING,
    },
  };
  return new ShareService(deps, w.bus);
}
