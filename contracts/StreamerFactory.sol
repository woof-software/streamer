// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IStreamerFactory } from "./interfaces/IStreamerFactory.sol";
import { Streamer } from "./Streamer.sol";

/** @title Streamer Factory
 * @author WOOF! Software
 * @custom:security-contact dmitriy@woof.software
 * @notice A Factory smart contract used for a safe deployment of new Streamer instances.
 * Anyone can use this Smart contract to deploy new streamers.
 */
contract StreamerFactory is IStreamerFactory {
    /// @notice A number per deployer used to generate a unique salt for Create2.
    mapping(address => uint256) public counters;

    /// @notice Deploys a new Streamer instance.
    /// @dev For details of each parameter, check documentation for Streamer.
    /// @dev Do not send tokens to Streamer address precomputed before actual deployment. Use the address returned from the function.
    /// @return The address of a new Streamer instance.
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
        uint256 _claimCooldown,
        uint256 _sweepCooldown,
        uint256 _streamDuration,
        uint256 _minimumNoticePeriod
    ) external returns (address) {
        if (_streamingAsset == _nativeAsset) revert AssetsMatch();
        uint8 streamingAssetDecimals = IERC20Metadata(_streamingAsset).decimals();
        uint8 nativeAssetDecimals = IERC20Metadata(_nativeAsset).decimals();
        bytes memory constructorParams = abi.encode(
            IERC20(_streamingAsset),
            _streamingAssetOracle,
            _nativeAssetOracle,
            _returnAddress,
            _streamCreator,
            _recipient,
            streamingAssetDecimals,
            nativeAssetDecimals,
            _nativeAssetStreamingAmount,
            _slippage,
            _claimCooldown,
            _sweepCooldown,
            _streamDuration,
            _minimumNoticePeriod
        );
        bytes32 uniqueSalt = keccak256(abi.encode(msg.sender, counters[msg.sender]++));
        bytes memory bytecodeWithParams = abi.encodePacked(type(Streamer).creationCode, constructorParams);
        address newContract = Create2.deploy(0, uniqueSalt, bytecodeWithParams);

        emit StreamerDeployed(newContract, constructorParams);
        return newContract;
    }
}
