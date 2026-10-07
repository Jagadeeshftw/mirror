// Shared position links and suggested levels (docs/api.md "Shared positions"). Service: services/share.ts.
import type { FastifyInstance } from 'fastify';
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import type { Engine } from '../app.js';
import { parseLinkId, ShareError } from '../services/share-rules.js';

const Sig = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const Deadline = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]);
const Price = z.union([z.string().max(24), z.number()]).nullish();

const linkParam = (v: string): Hex => {
  const id = parseLinkId(v);
  if (!id) throw new ShareError(404, 'unknown_link', 'This link does not exist');
  return id;
};

export function registerShareRoutes(app: FastifyInstance, e: Engine, addrParam: (v: string) => Address, limit: (key: string, max: number, windowMs: number, scope: string) => void) {
  // Owner creates a link for one open position (one passkey signature: ShareLink).
  app.post('/v1/share', async (req) => {
    limit(`share-create:${req.ip}`, 60, 3_600_000, 'share links per-IP');
    const b = z.object({ account: z.string(), perpId: z.number().int().positive().max(2 ** 32 - 1), linkId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), deadline: Deadline, signature: Sig }).parse(req.body);
    return e.share.create({ account: addrParam(b.account), perpId: b.perpId, linkId: b.linkId as Hex, deadline: BigInt(b.deadline), signature: b.signature as Hex });
  });

  // The friend's page: read-only card, or {status: revoked | closed} without numbers.
  app.get('/v1/share/:id', async (req, reply) => {
    limit(`share-read:${req.ip}`, 600, 3_600_000, 'share reads per-IP');
    reply.header('cache-control', 'no-store');
    return e.share.card(linkParam((req.params as { id: string }).id));
  });

  app.post('/v1/share/:id/suggest', async (req) => {
    const b = z.object({ stopLossPNS: Price, takeProfitPNS: Price, note: z.string().max(2000).optional() }).strict().parse(req.body ?? {});
    return e.share.suggest(linkParam((req.params as { id: string }).id), req.ip, b);
  });

  app.post('/v1/share/:id/revoke', async (req) => {
    limit(`share-owner:${req.ip}`, 120, 3_600_000, 'share owner actions per-IP');
    const b = z.object({ deadline: Deadline, signature: Sig }).parse(req.body);
    return e.share.revoke(linkParam((req.params as { id: string }).id), BigInt(b.deadline), b.signature as Hex);
  });

  app.post('/v1/share/suggestions/:sid/decline', async (req) => {
    limit(`share-owner:${req.ip}`, 120, 3_600_000, 'share owner actions per-IP');
    const p = z.object({ sid: z.coerce.number().int().positive() }).parse(req.params);
    const b = z.object({ deadline: Deadline, signature: Sig }).parse(req.body);
    return e.share.decline(p.sid, BigInt(b.deadline), b.signature as Hex);
  });

  app.post('/v1/share/suggestions/:sid/accept', async (req) => {
    limit(`share-owner:${req.ip}`, 120, 3_600_000, 'share owner actions per-IP');
    const p = z.object({ sid: z.coerce.number().int().positive() }).parse(req.params);
    const b = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body);
    return e.share.accepted(p.sid, b.txHash as Hex);
  });

  // Owner list: links and suggestions sealed to one of the owner's registered device notification keys.
  app.get('/v1/accounts/:account/share', async (req, reply) => {
    const account = addrParam((req.params as { account: string }).account);
    const q = z.object({ key: z.string().min(40).max(100) }).parse(req.query);
    reply.header('cache-control', 'no-store');
    return e.share.ownerList(account, q.key);
  });
}
