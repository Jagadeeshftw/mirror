import { keccak256, toBytes, type Hex } from 'viem';

export const MATCH_NOW_REF: Hex = keccak256(toBytes('MIRROR_MATCH_NOW'));
