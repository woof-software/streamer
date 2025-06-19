# Solidity API

## StreamerFactory

A Factory smart contract used for a safe deployment of new Streamer instances.
Anyone can use this Smart contract to deploy new streamers.

### counters

```solidity
mapping(address => uint256) counters
```

A number per deployer used to generate a unique salt for Create2.

### deployStreamer

```solidity
function deployStreamer(address _streamingAsset, address _nativeAsset, contract AggregatorV3Interface _streamingAssetOracle, contract AggregatorV3Interface _nativeAssetOracle, address _returnAddress, address _streamCreator, address _recipient, uint256 _nativeAssetStreamingAmount, uint256 _slippage, uint256 _claimCooldown, uint256 _sweepCooldown, uint256 _streamDuration, uint256 _minimumNoticePeriod) external returns (address)
```

Deploys a new Streamer instance.

_For details of each parameter, check documentation for Streamer.
Do not send tokens to Streamer address precomputed before actual deployment. Use the address returned from the function._

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | address | The address of a new Streamer instance. |

