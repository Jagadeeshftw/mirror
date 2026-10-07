// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal view of the Perpl Exchange (Monad) used by MirrorAccount.
/// @dev Declared from the published Exchange ABI (perpl dex-sdk, contract v1.1.7.x). Only the calls a
///      MirrorAccount forwards or reads are declared. Struct layouts must match the ABI exactly because
///      they are ABI-encoded across the call boundary.
///      Units: CNS = collateral native scale (AUSD, 6 decimals), PNS = price native scale (per-perp
///      priceDecimals), LNS = lot native scale (per-perp lotDecimals), Hdths = hundredths (leverage x100).
interface IPerplExchange {
    /// On-chain order type enum (OrderDescEnum).
    /// 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort, 4 Cancel, 5 IncreasePositionCollateral, 6 Change.
    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType;
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths;
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS;
    }

    struct OrderSignature {
        uint256 perpId;
        uint256 orderId;
    }

    /// Bit i of the 1024-bit map (bank1 = bits 0..255, bank2 = 256..511, ...) is set when the account
    /// holds a position in perpetual id i.
    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    /// positionType: 0 Long, 1 Short.
    struct PositionInfoV2 {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType;
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
        uint256 priceResiduePNSQ16;
    }

    struct PerpetualInfoV2 {
        string name;
        string symbol;
        uint256 priceDecimals;
        uint256 lotDecimals;
        bytes32 linkFeedId;
        uint256 priceTolPer100K;
        uint256 marginTol;
        uint256 marginTolDecimals;
        uint256 refPriceMaxAgeSec;
        uint256 positionBalanceCNS;
        uint256 insuranceBalanceCNS;
        uint256 markPNS;
        uint256 markTimestamp;
        uint256 lastPNS;
        uint256 lastTimestamp;
        uint256 oraclePNS;
        uint256 oracleTimestampSec;
        uint256 longOpenInterestLNS;
        uint256 shortOpenInterestLNS;
        uint256 fundingStartBlock;
        int16 fundingRatePct100k;
        uint256 absFundingClampPctPer100K;
        uint8 status;
        uint256 basePricePNS;
        uint256 maxBidPriceONS;
        uint256 minBidPriceONS;
        uint256 maxAskPriceONS;
        uint256 minAskPriceONS;
        uint256 numOrders;
        bool ignOracle;
        uint256 fundingSumScalingExp;
    }

    function createAccount(uint256 amountCNS) external returns (uint256 accountId);
    function depositCollateral(uint256 amountCNS) external;
    function withdrawCollateral(uint256 amountCNS) external;
    function execOrder(OrderDesc memory orderDesc) external returns (OrderSignature memory signature);
    /// V2 entrypoint: `extension` is `abi.encode(uint16 version, bytes payload)` with version 1 and payload
    /// `abi.encode(uint256 builderId, uint256 builderFeePer100K)` (perpl dex-sdk `BuilderAttribution::encode`).
    /// An empty extension is the builder-blind path.
    function execOrderV2(OrderDesc memory orderDesc, bytes memory extension) external returns (OrderSignature memory signature);

    function getAccountById(uint256 accountId) external view returns (AccountInfo memory accountInfo);
    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory accountInfo);
    function getPositionV2(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfoV2 memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function getPerpetualInfoV2(uint256 perpId) external view returns (PerpetualInfoV2 memory perpetualInfo);
    function getMinAccountOpenCNS() external view returns (uint256 minAccountOpenCNS);
}
