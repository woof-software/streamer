# Solidity API

## Streamer

This contract streams a certain amount of native asset in a form of streaming asset to the recipient over a specified streaming duration.
- The contract is designed to work with a pair of Chainlink oracles: Native Asset / USD and Streaming Asset / USD. However, can support any oracle which supports AggregatorV3Interface.
- Streaming asset is accrued linearly over a streaming duration, unlocking a portion of Streaming asset each second. Recipient can claim any time during and after the stream.
- Stream Creator is able to:
 1. rescue any ERC-20 token stuck in contract except of streaming asset.
 2. terminate the stream until the stream end. In this case, the distribution of streaming asset will continue till the termination timestamp.
 3. sweep remaining streaming asset tokens after stream end or termination timestamp (in case the stream is terminated).
- The streaming amount is specified in the native asset units. During the claiming, accrued native asset amount is calculated into streaming asset.
- All the tokens transferred via sweepRemaining or rescueToken are sent to the returnAddress.
- Anyone is able to call claim or sweepRemaining after a specified duration. Assets will still be transferred to the recipient and returnAddress accordingly.

### SLIPPAGE_SCALE

```solidity
uint256 SLIPPAGE_SCALE
```

The denominator for slippage calculation. Equals 100%.

### MIN_DURATION

```solidity
uint256 MIN_DURATION
```

Minimal required duration for all duration parameters.

### MIN_DECIMALS

```solidity
uint8 MIN_DECIMALS
```

Minimal number of decimals allowed for tokens and price feeds.

### SCALE_DECIMALS

```solidity
uint8 SCALE_DECIMALS
```

Number of decimals used to scale prices.

### streamingAsset

```solidity
contract IERC20 streamingAsset
```

The address of asset used for distribution.

### streamingAssetOracle

```solidity
contract AggregatorV3Interface streamingAssetOracle
```

The address of price feed oracle for Streaming asset. Must return the price in USD.

### nativeAssetOracle

```solidity
contract AggregatorV3Interface nativeAssetOracle
```

The address of price feed oracle for Native asset. Must return the price in USD.

### returnAddress

```solidity
address returnAddress
```

The address which receives tokens during the execution of sweepRemaining and rescueToken functions.

### streamCreator

```solidity
address streamCreator
```

The owner of the stream.

### recipient

```solidity
address recipient
```

The recipient of streaming asset.

### nativeAssetStreamingAmount

```solidity
uint256 nativeAssetStreamingAmount
```

Amount of asset to be distributed. Specified in the Native asset units.

### slippage

```solidity
uint256 slippage
```

A percentage used to reduce the price of streaming asset to account for price fluctuations.

### claimCooldown

```solidity
uint256 claimCooldown
```

A period of time since last claim timestamp after which anyone can call claim.

### sweepCooldown

```solidity
uint256 sweepCooldown
```

A period of time since the end of stream after which anyone can call sweepRemaining.

### streamDuration

```solidity
uint256 streamDuration
```

A period of time since the initialization of the stream during which asset is streamed.

### minimumNoticePeriod

```solidity
uint256 minimumNoticePeriod
```

A minimal period of time during which Streaming asset must continue to accrue after termination is called.

### streamingAssetDecimals

```solidity
uint8 streamingAssetDecimals
```

Decimals of Streaming asset.

### nativeAssetDecimals

```solidity
uint8 nativeAssetDecimals
```

Decimals of Native asset.

### streamingAssetOracleDecimals

```solidity
uint8 streamingAssetOracleDecimals
```

Decimals of the price returned by the Streaming Asset Oracle.

### nativeAssetOracleDecimals

```solidity
uint8 nativeAssetOracleDecimals
```

Decimals of the price returned by the Native Asset Oracle.

### startTimestamp

```solidity
uint256 startTimestamp
```

The start of the stream. Set during initialization of the stream.

### lastClaimTimestamp

```solidity
uint256 lastClaimTimestamp
```

The timestamp of the latest claim call.

### terminationTimestamp

```solidity
uint256 terminationTimestamp
```

The timestamp till which tokens continue to accrue. Set during the terminateStream call.

### nativeAssetSuppliedAmount

```solidity
uint256 nativeAssetSuppliedAmount
```

Amount of Native asset already distributed.

### streamingAssetClaimedAmount

```solidity
uint256 streamingAssetClaimedAmount
```

Total amount of claimed Streaming asset.

### onlyStreamCreator

```solidity
modifier onlyStreamCreator()
```

### constructor

```solidity
constructor(contract IERC20 _streamingAsset, contract AggregatorV3Interface _streamingAssetOracle, contract AggregatorV3Interface _nativeAssetOracle, address _returnAddress, address _streamCreator, address _recipient, uint8 _streamingAssetDecimals, uint8 _nativeAssetDecimals, uint256 _nativeAssetStreamingAmount, uint256 _slippage, uint256 _claimCooldown, uint256 _sweepCooldown, uint256 _streamDuration, uint256 _minimumNoticePeriod) public
```

_Decimals for tokens and price feeds should be between 6 and 18 to ensure proper calculations.
Streaming asset should not be a token with multiple addresses to ensure the correct flow of the stream.
USD value of `_nativeAssetStreamingAmount` must be equal to at least $1._

### initialize

```solidity
function initialize() external
```

Initializes the stream by setting start timestamp and validating that the contract has enough Streaming asset.

_Streaming asset must be transferred to the contract's balance before function is called.
It is recommended to send a sufficient amount of Streaming asset in order to ensure the correct work of the Streamer.
The extra amount depends on the volatility of assets. In general, we recommend sending extra 10% of the necessary Streaming asset amount.
Use the function `calculateStreamingAssetAmount` to determine the amount of Streaming asset to transfer._

### claim

```solidity
function claim() external
```

Claims the accrued amount of Streaming asset to the recipient's address.

_The stream must be initialized.
Can be called by the recipient or anyone after claim cooldown has passed since the last claim timestamp.
In case the contract doesn't have enough Streaming asset on its balance, the whole balance will be sent. The stream owner will have to replenish
the balance in order to resume the stream._

### terminateStream

```solidity
function terminateStream(uint256 _terminationTimestamp) external
```

Terminates the stream, stopping the distribution after the termination timestamp.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _terminationTimestamp | uint256 | The timestamp after which the stream is stopped. Must be longer than `block.timestamp + minimumNoticePeriod` and less than the end of stream. If the parameter is equal to 0, the termination timestamp will be set as `block.timestamp + minimumNoticePeriod`. |

### sweepRemaining

```solidity
function sweepRemaining() external
```

Allows to sweep all the Streaming asset tokens from the Streamer's balance.

_Can be called by Stream Creator before initialization without any additional conditions.
After the end of stream (Either after stream duration or after termination timestamp if termination was called), can be called
by Stream Creator or anyone after sweep cooldown has passed._

### rescueToken

```solidity
function rescueToken(contract IERC20 token) external
```

Allows to transfer any ERC-20 token except the Streaming asset from the Streamer's balance.

_Can only be called by Stream Creator._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| token | contract IERC20 | Address of ERC-20 token to transfer. |

### getNativeAssetAmountOwed

```solidity
function getNativeAssetAmountOwed() public view returns (uint256)
```

Calculates the amount of asset accrued since the last claiming

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | Amount of accrued asset in Native asset units. |

### calculateStreamingAssetAmount

```solidity
function calculateStreamingAssetAmount(uint256 nativeAssetAmount) public view returns (uint256)
```

Calculates the amount of Streaming asset based on the specified Native asset amount.

_Used in `claim` to calculate the amount Native asset owed in Streaming asset.
The price of streaming asset is reduced by the slippage to account for price fluctuations._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| nativeAssetAmount | uint256 | The amount of Native asset to be converted to Streaming asset. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | Amount of Streaming asset. |

### calculateNativeAssetAmount

```solidity
function calculateNativeAssetAmount(uint256 streamingAssetAmount) public view returns (uint256)
```

Calculates the amount of Native asset based on the specified Streaming asset amount.

_Used in `initialize` to validate if the Streamer has enough Streaming asset to begin stream.
Used in `claim` to calculate how much the remaining balance of Streaming asset is equal to the Native Asset
(For cases where the Streamer doesn't have enough Streaming asset to distribute)._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| streamingAssetAmount | uint256 | The amount of Streaming asset to be converted to Native asset. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | Amount of Native asset. |

### getStreamEnd

```solidity
function getStreamEnd() public view returns (uint256)
```

_Returns a correct end of the stream once the stream is initialized._

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | Timestamp representing the end of the stream. |

### getStreamState

```solidity
function getStreamState() external view returns (enum StreamState)
```

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | enum StreamState | Current state of the stream. |

### scaleAmount

```solidity
function scaleAmount(uint256 amount, uint256 fromDecimals, uint256 toDecimals) internal pure returns (uint256)
```

Scales an amount from one decimal representation to another.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| amount | uint256 | The amount to be scaled. |
| fromDecimals | uint256 | The number of decimals of the original amount. |
| toDecimals | uint256 | The number of decimals of the target amount. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The scaled amount. |

