// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { AggregatorV3Interface } from "./AggregatorV3Interface.sol";

interface IStreamerFactory {
    event StreamerDeployed(address newContract, bytes constructorParams);

    error AssetsMatch();

    function deployStreamer(
        address _streamingAsset,
        address _nativeAsset,
        AggregatorV3Interface _streamingAssetOracle,
        AggregatorV3Interface _nativeAssetOracle,
        address _returnAddress,
        address _streamCreator,
        address _recipient,
        uint256 _nativeAssetStreamingAmount,
        uint256 _slippage,
        uint256 _sweepCooldown,
        uint256 _finishCooldown,
        uint256 _streamDuration,
        uint256 _minimumNoticePeriod
    ) external returns (address);
}
