# Solidity API

## StreamState

```solidity
enum StreamState {
  NOT_INITIALIZED,
  STARTED,
  SHORTENED,
  FINISHED
}
```

## IStreamer

### Initialized

```solidity
event Initialized()
```

### Claimed

```solidity
event Claimed(uint256 streamingAssetAmount, uint256 nativeAssetAmount)
```

### Terminated

```solidity
event Terminated(uint256 terminationTimestamp)
```

### Swept

```solidity
event Swept(uint256 amount)
```

### Rescued

```solidity
event Rescued(address token, uint256 balance)
```

### InsufficientAssetBalance

```solidity
event InsufficientAssetBalance(uint256 balanceRequired, uint256 balance)
```

### ZeroAmount

```solidity
error ZeroAmount()
```

### NotReceiver

```solidity
error NotReceiver()
```

### NotStreamCreator

```solidity
error NotStreamCreator()
```

### CantRescueStreamingAsset

```solidity
error CantRescueStreamingAsset()
```

### ZeroAddress

```solidity
error ZeroAddress()
```

### SlippageExceedsScaleFactor

```solidity
error SlippageExceedsScaleFactor()
```

### InvalidPrice

```solidity
error InvalidPrice()
```

### NotInitialized

```solidity
error NotInitialized()
```

### NotEnoughBalance

```solidity
error NotEnoughBalance(uint256 balance, uint256 streamingAmount)
```

### StreamNotFinished

```solidity
error StreamNotFinished()
```

### AlreadyInitialized

```solidity
error AlreadyInitialized()
```

### DurationTooShort

```solidity
error DurationTooShort()
```

### TerminationIsAfterStream

```solidity
error TerminationIsAfterStream(uint256 terminationTimestamp)
```

### CreatorCannotSweepYet

```solidity
error CreatorCannotSweepYet()
```

### SweepCooldownNotPassed

```solidity
error SweepCooldownNotPassed()
```

### AlreadyTerminated

```solidity
error AlreadyTerminated()
```

### NoticePeriodExceedsStreamDuration

```solidity
error NoticePeriodExceedsStreamDuration()
```

### DecimalsNotInBounds

```solidity
error DecimalsNotInBounds()
```

### StreamingAmountTooLow

```solidity
error StreamingAmountTooLow()
```

### initialize

```solidity
function initialize() external
```

### claim

```solidity
function claim() external
```

### sweepRemaining

```solidity
function sweepRemaining() external
```

### terminateStream

```solidity
function terminateStream(uint256 _terminationTimestamp) external
```

### rescueToken

```solidity
function rescueToken(contract IERC20 token) external
```

### getNativeAssetAmountOwed

```solidity
function getNativeAssetAmountOwed() external view returns (uint256)
```

### calculateStreamingAssetAmount

```solidity
function calculateStreamingAssetAmount(uint256 nativeAssetAmount) external view returns (uint256)
```

### calculateNativeAssetAmount

```solidity
function calculateNativeAssetAmount(uint256 streamingAssetAmount) external view returns (uint256)
```

