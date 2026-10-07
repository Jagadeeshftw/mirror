// "Stop following, keep my positions", per leader, enforced by the follower's own MirrorAccount:
// `leaderDetached(leader)` is set by the owner (setLeaderDetached, or a signed execute with
// ACTION_SET_LEADER_DETACHED = 11, relayed through POST /v1/relay/execute like any other owner action). While it is
// set, the contract refuses every copy naming that leader, opens and closes, keeper or match now, with
// Blocked(LeaderDetached = 22, actual = leader id). Positions stay attributed to the leader; levels, the stops
// anyone can trigger, closeMarket, closeAll and withdraw keep working. follow() naming the leader, a signed
// detached = false, or removing the leader from the policy clears it (each emits LeaderDetachedSet(id, false)).
//
// The engine only indexes LeaderDetachedSet (services/registry.ts) so the keeper does not send copies the contract
// would refuse anyway (they would only cost gas and produce a Blocked event).

/** Followers that should get keeper copies of `leaderId`: everyone whose account has not detached that leader. */
export function copyTargets<T extends { leaders: Map<number, { detached?: boolean }> }>(followers: T[], leaderId: number): T[] {
  return followers.filter((f) => !f.leaders.get(leaderId)?.detached);
}

export const DETACH_LABELS = { true: 'Stopped following this leader (positions kept)', false: 'Following this leader again' } as const;

export const detachLabel = (detached: boolean) => DETACH_LABELS[String(detached) as 'true' | 'false'];

/** Answer for the retired engine-held route (POST /v1/accounts/:account/detach). */
export const DETACH_GONE = {
  error: 'Stop following is enforced by your own MirrorAccount now: sign execute(ACTION_SET_LEADER_DETACHED = 11, abi.encode(uint32 leader, bool detached)) and relay it with POST /v1/relay/execute.',
  code: 'moved_onchain',
  actionKind: 11,
} as const;
