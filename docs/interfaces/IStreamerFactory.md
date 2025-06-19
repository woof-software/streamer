# Solidity API

## IStreamerFactory

### StreamerDeployed

```solidity
event StreamerDeployed(address newContract, bytes constructorParams)
```

### AssetsMatch

```solidity
error AssetsMatch()
```

### deployStreamer

```solidity
function deployStreamer(address _streamingAsset, address _nativeAsset, contract AggregatorV3Interface _streamingAssetOracle, contract AggregatorV3Interface _nativeAssetOracle, address _returnAddress, address _streamCreator, address _recipient, uint256 _nativeAssetStreamingAmount, uint256 _slippage, uint256 _sweepCooldown, uint256 _finishCooldown, uint256 _streamDuration, uint256 _minimumNoticePeriod) external returns (address)
```

