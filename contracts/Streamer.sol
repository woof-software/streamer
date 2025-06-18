// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

// Developed with @openzeppelin/contracts v5.3.0
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { StreamState, IStreamer } from "./interfaces/IStreamer.sol";

/** @title Streamer
 * @author WOOF! Software
 * @custom:security-contact dmitriy@woof.software
 * @notice This contract streams a certain amount of native asset in a form of streaming asset to the recipient over a specified streaming duration.
 * - The contract is designed to work with a pair of Chainlink oracles: Native Asset / USD and Streaming Asset / USD. However, can support any oracle which supports AggregatorV3Interface.
 * - Streaming asset is accrued linearly over a streaming duration, unlocking a portion of Streaming asset each second. Recipient can claim any time during and after the stream.
 * - Stream Creator is able to:
 *  1. rescue any ERC-20 token stuck in contract except of streaming asset.
 *  2. terminate the stream until the stream end. In this case, the distribution of streaming asset will continue till the termination timestamp.
 *  3. sweep remaining streaming asset tokens after stream end or termination timestamp (in case the stream is terminated).
 * - The streaming amount is specified in the native asset units. During the claiming, accrued native asset amount is calculated into streaming asset.
 * - All the tokens transferred via sweepRemaining or rescueToken are sent to the returnAddress.
 * - Anyone is able to call claim or sweepRemaining after a specified duration. Assets will still be transferred to the recipient and returnAddress accordingly.
 */
contract Streamer is IStreamer {
    using SafeERC20 for IERC20;

    /// @notice The denominator for slippage calculation. Equals 100%.
    uint256 public constant SLIPPAGE_SCALE = 1e8;
    /// @notice Minimal required duration for all duration parameters.
    uint256 public constant MIN_DURATION = 1 days;
    /// @notice Scale factor for price calculations.
    uint256 public constant SCALE_FACTOR = 1e18;
    /// @notice Minimal number of decimals allowed for tokens and price feeds.
    uint8 public constant MIN_DECIMALS = 6;
    /// @notice Number of decimals used to scale prices.
    uint8 public constant SCALE_DECIMALS = 18;

    /// @notice The address of asset used for distribution.
    IERC20 public immutable streamingAsset;
    /// @notice The address of price feed oracle for Streaming asset. Must return the price in USD.
    AggregatorV3Interface public immutable streamingAssetOracle;
    /// @notice The address of price feed oracle for Native asset. Must return the price in USD.
    AggregatorV3Interface public immutable nativeAssetOracle;
    /// @notice The address which receives tokens during the execution of sweepRemaining and rescueToken functions.
    address public immutable returnAddress;
    /// @notice The owner of the stream.
    address public immutable streamCreator;
    /// @notice The recipient of streaming asset.
    address public immutable recipient;
    /// @notice Amount of asset to be distributed. Specified in the Native asset units.
    uint256 public immutable nativeAssetStreamingAmount;
    /// @notice A percentage used to reduce the price of streaming asset to account for price fluctuations.
    uint256 public immutable slippage;
    /// @notice A period of time since last claim timestamp after which anyone can call claim.
    uint256 public immutable claimCooldown;
    /// @notice A period of time since the end of stream after which anyone can call sweepRemaining.
    uint256 public immutable sweepCooldown;
    /// @notice A period of time since the initialization of the stream during which asset is streamed.
    uint256 public immutable streamDuration;
    /// @notice A minimal period of time during which Streaming asset must continue to accrue after termination is called.
    uint256 public immutable minimumNoticePeriod;
    /// @notice Decimals of Streaming asset.
    uint8 public immutable streamingAssetDecimals;
    /// @notice Decimals of Native asset.
    uint8 public immutable nativeAssetDecimals;
    /// @notice Decimals of the price returned by the Streaming Asset Oracle.
    uint8 public immutable streamingAssetOracleDecimals;
    /// @notice Decimals of the price returned by the Native Asset Oracle.
    uint8 public immutable nativeAssetOracleDecimals;
    /// @notice The start of the stream. Set during initialization of the stream.
    uint256 public startTimestamp;
    /// @notice The timestamp of the latest claim call.
    uint256 public lastClaimTimestamp;
    /// @notice The timestamp till which tokens continue to accrue. Set during the terminateStream call.
    uint256 public terminationTimestamp;
    /// @notice Amount of Native asset already distributed.
    uint256 public nativeAssetSuppliedAmount;
    /// @notice Total amount of claimed Streaming asset.
    uint256 public streamingAssetClaimedAmount;
    /// @notice The state which indicated if the stream is not initialized, ongoing or terminated.
    StreamState private state;

    modifier onlyStreamCreator() {
        if (msg.sender != streamCreator) revert NotStreamCreator();
        _;
    }

    /// @dev Decimals for tokens and price feeds should be between 6 and 18 to ensure proper calculations.
    /// @dev Streaming asset should not be a token with multiple addresses to ensure the correct flow of the stream.
    /// USD value of `_nativeAssetStreamingAmount` must be equal to at least $1.
    constructor(
        IERC20 _streamingAsset,
        AggregatorV3Interface _streamingAssetOracle,
        AggregatorV3Interface _nativeAssetOracle,
        address _returnAddress,
        address _streamCreator,
        address _recipient,
        uint8 _streamingAssetDecimals,
        uint8 _nativeAssetDecimals,
        uint256 _nativeAssetStreamingAmount,
        uint256 _slippage,
        uint256 _claimCooldown,
        uint256 _sweepCooldown,
        uint256 _streamDuration,
        uint256 _minimumNoticePeriod
    ) {
        if (_recipient == address(0)) revert ZeroAddress();
        if (_streamCreator == address(0)) revert ZeroAddress();
        if (_returnAddress == address(0)) revert ZeroAddress();
        if (address(_streamingAsset) == address(0)) revert ZeroAddress();
        if (_nativeAssetStreamingAmount == 0) revert ZeroAmount();
        if (_slippage > SLIPPAGE_SCALE) revert SlippageExceedsScaleFactor();
        if (_claimCooldown < MIN_DURATION) revert DurationTooShort();
        if (_sweepCooldown < MIN_DURATION) revert DurationTooShort();
        if (_streamDuration < MIN_DURATION) revert DurationTooShort();
        if (_minimumNoticePeriod < MIN_DURATION) revert DurationTooShort();
        if (_minimumNoticePeriod > _streamDuration) revert NoticePeriodExceedsStreamDuration();
        streamingAssetOracleDecimals = _streamingAssetOracle.decimals();
        nativeAssetOracleDecimals = _nativeAssetOracle.decimals();
        if (
            _streamingAssetDecimals < MIN_DECIMALS ||
            _nativeAssetDecimals < MIN_DECIMALS ||
            streamingAssetOracleDecimals < MIN_DECIMALS ||
            nativeAssetOracleDecimals < MIN_DECIMALS
        ) revert DecimalsNotInBounds();
        (, int256 nativeAssetPrice, , , ) = _nativeAssetOracle.latestRoundData();
        if (nativeAssetPrice <= 0) revert InvalidPrice();
        if (
            (_nativeAssetStreamingAmount * uint256(nativeAssetPrice)) / 10 ** nativeAssetOracleDecimals <
            10 ** _nativeAssetDecimals
        ) revert StreamingAmountTooLow();

        streamingAsset = _streamingAsset;
        streamingAssetOracle = _streamingAssetOracle;
        nativeAssetOracle = _nativeAssetOracle;
        returnAddress = _returnAddress;
        streamCreator = _streamCreator;
        recipient = _recipient;
        streamingAssetDecimals = _streamingAssetDecimals;
        nativeAssetDecimals = _nativeAssetDecimals;
        nativeAssetStreamingAmount = _nativeAssetStreamingAmount;
        slippage = _slippage;
        claimCooldown = _claimCooldown;
        sweepCooldown = _sweepCooldown;
        streamDuration = _streamDuration;
        minimumNoticePeriod = _minimumNoticePeriod;
    }

    /** @notice Initializes the stream by setting start timestamp and validating that the contract has enough Streaming asset.
     * @dev Streaming asset must be transferred to the contract's balance before function is called.
     * @dev It is recommended to send a sufficient amount of Streaming asset in order to ensure the correct work of the Streamer.
     * The extra amount depends on the volatility of assets. In general, we recommend sending extra 10% of the necessary Streaming asset amount.
     * @dev Use the function `calculateStreamingAssetAmount` to determine the amount of Streaming asset to transfer.
     */
    function initialize() external onlyStreamCreator {
        if (state != StreamState.NOT_INITIALIZED) revert AlreadyInitialized();
        startTimestamp = block.timestamp;
        lastClaimTimestamp = block.timestamp;
        state = StreamState.STARTED;

        uint256 balance = streamingAsset.balanceOf(address(this));
        if (calculateNativeAssetAmount(balance) < nativeAssetStreamingAmount)
            revert NotEnoughBalance(balance, nativeAssetStreamingAmount);

        emit Initialized();
    }

    /** @notice Claims the accrued amount of Streaming asset to the recipient's address.
     * @dev The stream must be initialized.
     * @dev Can be called by the recipient or anyone after claim cooldown has passed since the last claim timestamp.
     * @dev In case the contract doesn't have enough Streaming asset on its balance, the whole balance will be sent. The stream owner will have to replenish
     * the balance in order to resume the stream.
     */
    function claim() external {
        if (state == StreamState.NOT_INITIALIZED) revert NotInitialized();
        if (msg.sender != recipient && block.timestamp < lastClaimTimestamp + claimCooldown) revert NotReceiver();

        uint256 owed = getNativeAssetAmountOwed();
        if (owed == 0) revert ZeroAmount();

        uint256 streamingAssetAmount = calculateStreamingAssetAmount(owed);
        if (streamingAssetAmount == 0) revert ZeroAmount();

        uint256 balance = streamingAsset.balanceOf(address(this));
        if (balance < streamingAssetAmount) {
            emit InsufficientAssetBalance(streamingAssetAmount, balance);
            streamingAssetAmount = balance;
            owed = calculateNativeAssetAmount(balance);
        }

        lastClaimTimestamp = block.timestamp;
        nativeAssetSuppliedAmount += owed;
        streamingAssetClaimedAmount += streamingAssetAmount;

        streamingAsset.safeTransfer(recipient, streamingAssetAmount);
        emit Claimed(streamingAssetAmount, owed);
    }

    /// @notice Terminates the stream, stopping the distribution after the termination timestamp.
    /// @param _terminationTimestamp The timestamp after which the stream is stopped. Must be longer than `block.timestamp + minimumNoticePeriod` and less than the end of stream.
    /// If the parameter is equal to 0, the termination timestamp will be set as `block.timestamp + minimumNoticePeriod`.
    function terminateStream(uint256 _terminationTimestamp) external onlyStreamCreator {
        if (state == StreamState.SHORTENED) revert AlreadyTerminated();
        if (_terminationTimestamp == 0) {
            terminationTimestamp = block.timestamp + minimumNoticePeriod;
        } else {
            if (_terminationTimestamp < block.timestamp + minimumNoticePeriod) revert DurationTooShort();
            terminationTimestamp = _terminationTimestamp;
        }

        if (terminationTimestamp > startTimestamp + streamDuration)
            revert TerminationIsAfterStream(_terminationTimestamp);
        state = StreamState.SHORTENED;
        emit Terminated(terminationTimestamp);
    }

    /** @notice Allows to sweep all the Streaming asset tokens from the Streamer's balance.
     * @dev Can be called by Stream Creator before initialization without any additional conditions.
     * @dev After the end of stream (Either after stream duration or after termination timestamp if termination was called), can be called
     * by Stream Creator or anyone after sweep cooldown has passed.
     */
    function sweepRemaining() external {
        if (state == StreamState.NOT_INITIALIZED) {
            if (msg.sender != streamCreator) {
                revert NotStreamCreator();
            }
        } else {
            uint256 streamEnd = getStreamEnd();

            if (msg.sender == streamCreator) {
                if (block.timestamp <= streamEnd) {
                    revert CreatorCannotSweepYet();
                }
            } else if (block.timestamp <= streamEnd + sweepCooldown) {
                revert SweepCooldownNotPassed();
            }
        }
        uint256 remainingBalance = streamingAsset.balanceOf(address(this));

        streamingAsset.safeTransfer(returnAddress, remainingBalance);
        emit Swept(remainingBalance);
    }

    /** @notice Allows to transfer any ERC-20 token except the Streaming asset from the Streamer's balance.
     * @param token Address of ERC-20 token to transfer.
     * @dev Can only be called by Stream Creator.
     */
    function rescueToken(IERC20 token) external onlyStreamCreator {
        if (token == streamingAsset) revert CantRescueStreamingAsset();
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(returnAddress, balance);
        emit Rescued(address(token), balance);
    }

    /// @notice Calculates the amount of asset accrued since the last claiming
    /// @return Amount of accrued asset in Native asset units.
    function getNativeAssetAmountOwed() public view returns (uint256) {
        if (nativeAssetSuppliedAmount >= nativeAssetStreamingAmount) {
            return 0;
        }
        uint256 streamEnd = getStreamEnd();
        // Validate if stream is properly initialized
        if (streamEnd == 0) return 0;
        uint256 totalOwed;

        if (block.timestamp < streamEnd) {
            uint256 elapsed = block.timestamp - startTimestamp;
            totalOwed = (nativeAssetStreamingAmount * elapsed) / streamDuration;
        } else {
            // If Stream is terminated, calculate amount accrued before termination timestamp
            if (state == StreamState.SHORTENED)
                totalOwed = (nativeAssetStreamingAmount * (streamEnd - startTimestamp)) / streamDuration;
            else totalOwed = nativeAssetStreamingAmount;
        }
        return totalOwed - nativeAssetSuppliedAmount;
    }

    /** @notice Calculates the amount of Streaming asset based on the specified Native asset amount.
     * @param nativeAssetAmount The amount of Native asset to be converted to Streaming asset.
     * @dev Used in `claim` to calculate the amount Native asset owed in Streaming asset.
     * @dev The price of streaming asset is reduced by the slippage to account for price fluctuations.
     * @return Amount of Streaming asset.
     */
    function calculateStreamingAssetAmount(uint256 nativeAssetAmount) public view returns (uint256) {
        (, int256 streamingAssetPrice, , , ) = streamingAssetOracle.latestRoundData();
        if (streamingAssetPrice <= 0) revert InvalidPrice();

        (, int256 nativeAssetPrice, , , ) = nativeAssetOracle.latestRoundData();
        if (nativeAssetPrice <= 0) revert InvalidPrice();

        uint256 streamingAssetPriceScaled = (scaleAmount(
            uint256(streamingAssetPrice),
            streamingAssetOracleDecimals,
            SCALE_DECIMALS
        ) * (SLIPPAGE_SCALE - slippage)) / SLIPPAGE_SCALE;
        // Scale native asset price to streaming asset decimals for calculations
        uint256 nativeAssetPriceScaled = scaleAmount(
            uint256(nativeAssetPrice),
            nativeAssetOracleDecimals,
            SCALE_DECIMALS
        );
        uint256 amountInStreamingAsset = (scaleAmount(nativeAssetAmount, nativeAssetDecimals, SCALE_DECIMALS) *
            nativeAssetPriceScaled) / streamingAssetPriceScaled;

        return scaleAmount(amountInStreamingAsset, SCALE_DECIMALS, streamingAssetDecimals);
    }

    /** @notice Calculates the amount of Native asset based on the specified Streaming asset amount.
     * @param streamingAssetAmount The amount of Streaming asset to be converted to Native asset.
     * @dev Used in `initialize` to validate if the Streamer has enough Streaming asset to begin stream.
     * @dev Used in `claim` to calculate how much the remaining balance of Streaming asset is equal to the Native Asset
     * (For cases where the Streamer doesn't have enough Streaming asset to distribute).
     * @return Amount of Native asset.
     */
    function calculateNativeAssetAmount(uint256 streamingAssetAmount) public view returns (uint256) {
        (, int256 streamingAssetPrice, , , ) = streamingAssetOracle.latestRoundData();
        if (streamingAssetPrice <= 0) revert InvalidPrice();

        (, int256 nativeAssetPrice, , , ) = nativeAssetOracle.latestRoundData();
        if (nativeAssetPrice <= 0) revert InvalidPrice();

        // Streaming asset price is reduced by slippage to account for price fluctuations
        uint256 streamingAssetPriceScaled = (scaleAmount(
            uint256(streamingAssetPrice),
            streamingAssetOracleDecimals,
            SCALE_DECIMALS
        ) * (SLIPPAGE_SCALE - slippage)) / SLIPPAGE_SCALE;
        // Scale native asset price to streaming asset decimals for calculations
        uint256 nativeAssetPriceScaled = scaleAmount(
            uint256(nativeAssetPrice),
            nativeAssetOracleDecimals,
            SCALE_DECIMALS
        );
        uint256 amountInNativeAsset = (scaleAmount(streamingAssetAmount, streamingAssetDecimals, SCALE_DECIMALS) *
            streamingAssetPriceScaled) / nativeAssetPriceScaled;

        return scaleAmount(amountInNativeAsset, SCALE_DECIMALS, nativeAssetDecimals);
    }

    /// @dev Returns a correct end of the stream once the stream is initialized.
    /// @return Timestamp representing the end of the stream.
    function getStreamEnd() public view returns (uint256) {
        if (state == StreamState.NOT_INITIALIZED) return 0;
        return (state == StreamState.SHORTENED) ? terminationTimestamp : startTimestamp + streamDuration;
    }

    /// @return Current state of the stream.
    function getStreamState() external view returns (StreamState) {
        uint256 streamEnd = getStreamEnd();
        if (streamEnd == 0) return StreamState.NOT_INITIALIZED;
        return block.timestamp < streamEnd ? state : StreamState.FINISHED;
    }

    /** @notice Scales an amount from one decimal representation to another.
     * @param amount The amount to be scaled.
     * @param fromDecimals The number of decimals of the original amount.
     * @param toDecimals The number of decimals of the target amount.
     * @return The scaled amount.
     */
    function scaleAmount(uint256 amount, uint256 fromDecimals, uint256 toDecimals) internal pure returns (uint256) {
        if (fromDecimals == toDecimals) return amount;
        if (fromDecimals > toDecimals) {
            return amount / (10 ** (fromDecimals - toDecimals));
        }
        return amount * (10 ** (toDecimals - fromDecimals));
    }
}
