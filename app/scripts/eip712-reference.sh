#!/usr/bin/env bash
# Reproduces the reference vectors in __tests__/eip712.test.ts with Foundry.
# Part 2 deploys the compiled contracts to a LOCAL, non-forked anvil (chainId 143). Nothing
# touches mainnet or testnet.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../../contracts/out" && pwd)"
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=$(cast wallet address --private-key $PK)
POLICY='(500,50,1000,1500,1798761600,[(1043,25)],[(1,12000000),(20,12000000)])'
ORDERS='[(1043,1,0,15,1196000,500,100,0x0000000000000000000000000000000000000000000000000000000000000000)]'
DATA=$(cast abi-encode "f((uint16,uint16,uint16,uint16,uint40,(uint32,uint32)[],(uint32,uint64)[]),(uint32,uint32,uint8,uint64,uint64,uint16,uint16,bytes32)[])" "$POLICY" "$ORDERS")
echo "FOLLOW_DATA=$DATA"
# 1) manual digest for verifyingContract 0x5FbD…0aa3
ACCT=0x5FbDB2315678afecb367f032d93F642f64180aa3
TH=$(cast keccak "Action(uint8 kind,bytes data,uint256 nonce,uint256 deadline)")
DOMTH=$(cast keccak "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
DS=$(cast keccak $(cast abi-encode "f(bytes32,bytes32,bytes32,uint256,address)" $DOMTH $(cast keccak "Mirror Account") $(cast keccak "1") 143 $ACCT))
SH=$(cast keccak $(cast abi-encode "f(bytes32,uint8,bytes32,uint256,uint256)" $TH 7 $(cast keccak $DATA) 3 1798000000))
echo "MANUAL_DIGEST=$(cast keccak $(cast concat-hex 0x1901 $DS $SH))"
# 2) the contract's own actionDigest()
anvil --port 8599 --chain-id 143 --silent & APID=$!; trap "kill $APID" EXIT; sleep 2
RPC=http://127.0.0.1:8599
bc(){ python3 -c "import json;print(json.load(open('$OUT/$1.sol/$1.json'))['bytecode']['object'])"; }
dep(){ cast send --rpc-url $RPC --private-key $PK --create "$@" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['contractAddress'])"; }
AUSD=$(dep $(bc MockAUSD))
EX=$(dep $(bc MockPerplExchange)$(cast abi-encode "f(address)" $AUSD | cut -c3-))
KR=$(dep $(bc KeeperRegistry)$(cast abi-encode "f(address)" $ME | cut -c3-))
F=$(dep $(bc MirrorAccountFactory)$(cast abi-encode "f(address,address,address,uint256)" $EX $AUSD $KR 25000000 | cut -c3-))
SALT=0x0000000000000000000000000000000000000000000000000000000000000002
PRED=$(cast call --rpc-url $RPC $F "predictAccount(address,bytes32)(address)" $ME $SALT)
cast send --rpc-url $RPC --private-key $PK $F "createAccount(address,bytes32)" $ME $SALT >/dev/null
echo "FACTORY=$F IMPL=$(cast call --rpc-url $RPC $F 'implementation()(address)') PREDICTED=$PRED"
echo "CONTRACT_DIGEST=$(cast call --rpc-url $RPC $PRED 'actionDigest((uint8,bytes,uint256,uint256))(bytes32)' "(7,$DATA,3,1798000000)")"
echo "MOCK_AUSD_DOMAIN_SEPARATOR=$(cast call --rpc-url $RPC $AUSD 'DOMAIN_SEPARATOR()(bytes32)')"
