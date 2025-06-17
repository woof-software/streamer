// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

enum StreamState {
    NOT_INITIALIZED,
    STARTED,
    SHORTENED,
    FINISHED
}

interface IStreamer {
    event Initialized();
    event Claimed(uint256 streamingAssetAmount, uint256 nativeAssetAmount);
    event Terminated(uint256 terminationTimestamp);
    event Swept(uint256 amount);
    event Rescued(address token, uint256 balance);
    event InsufficientAssetBalance(uint256 balanceRequired, uint256 balance);

    error ZeroAmount();
    error NotReceiver();
    error NotStreamCreator();
    error CantRescueStreamingAsset();
    error ZeroAddress();
    error SlippageExceedsScaleFactor();
    error InvalidPrice();
    error NotInitialized();
    error NotEnoughBalance(uint256 balance, uint256 streamingAmount);
    error StreamNotFinished();
    error AlreadyInitialized();
    error DurationTooShort();
    error TerminationIsAfterStream(uint256 terminationTimestamp);
    error CreatorCannotSweepYet();
    error SweepCooldownNotPassed();
    error AlreadyTerminated();
    error NoticePeriodExceedsStreamDuration();
    error DecimalsNotInBounds();
    error StreamingAmountTooLow();

    function initialize() external;

    function claim() external;

    function sweepRemaining() external;

    function terminateStream(uint256 _terminationTimestamp) external;

    function rescueToken(IERC20 token) external;

    function getNativeAssetAmountOwed() external view returns (uint256);

    function calculateStreamingAssetAmount(uint256 nativeAssetAmount) external view returns (uint256);

    function calculateNativeAssetAmount(uint256 streamingAssetAmount) external view returns (uint256);
}
