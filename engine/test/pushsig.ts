// Test helper: an owner-signed /v1/push/register body (PushRegister typed data, services/pushauth.ts).
import { getAddress, type Hex, type LocalAccount } from 'viem';
import { decodeNotifyKey } from '../src/services/pushcrypto.js';
import { channelHash, pushTypedData, type PushChannel } from '../src/services/pushauth.js';
import type { RegisterBody, WebPushSubscription } from '../src/services/push.js';

export const PUSH_CHAIN = 143;
export const nowSec = () => Math.floor(Date.now() / 1000);

export async function signedRegister(
  who: LocalAccount,
  body: { owner?: string; notifyPublicKey: string; webPush?: WebPushSubscription; fcmToken?: string; expoPushToken?: string },
  o: { deadline?: bigint; chainId?: number; channel?: [PushChannel, string] } = {},
): Promise<RegisterBody> {
  const owner = getAddress(body.owner ?? who.address);
  const deadline = o.deadline ?? BigInt(nowSec() + 600);
  const [channel, target] = o.channel ?? (body.webPush ? ['webpush', body.webPush.endpoint] : body.fcmToken ? ['fcm', body.fcmToken] : body.expoPushToken ? ['expo', body.expoPushToken] : ['app', '']);
  const td = pushTypedData(o.chainId ?? PUSH_CHAIN, {
    primaryType: 'PushRegister',
    message: { owner, notifyPublicKey: `0x${decodeNotifyKey(body.notifyPublicKey).toString('hex')}` as Hex, channelHash: channelHash(channel, target), deadline },
  });
  const signature = await who.signTypedData(td as never);
  return { ...body, owner, deadline: deadline.toString(), signature };
}

export async function signedUnregister(who: LocalAccount, channel: 'webpush' | 'fcm' | 'expo', target: string, deadline = BigInt(nowSec() + 600)) {
  const owner = getAddress(who.address);
  const signature = await who.signTypedData(pushTypedData(PUSH_CHAIN, { primaryType: 'PushUnregister', message: { owner, channelHash: channelHash(channel, target), deadline } }) as never);
  return { owner, channel, target, deadline: deadline.toString(), signature };
}
