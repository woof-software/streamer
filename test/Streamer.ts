import { expect } from "chai";
import { network, ethers } from "hardhat";
import { loadFixture, time, SnapshotRestorer, takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { IComptrollerV2, IERC20, Streamer } from "../typechain-types";

const StreamState = {
    NOT_INITIALIZED: 0,
    STARTED: 1,
    SHORTENED: 2,
    FINISHED: 3
} as const;
const DUST = 30;
const SLIPPAGE_SCALE = 1e8;
const MIN_DURATION = time.duration.days(1);

describe("Streamer", function () {
    const timelockAddress = "0x6d903f6003cca6255D85CcA4D3B5E5146dC33925";
    const comptrollerV2Address = "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B";
    const CompAddress = "0xc00e94Cb662C3520282E6f5717214004A7f26888";

    const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        COMP_ORACLE = "0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5",
        USDC_ORACLE = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
    const returnAddress = comptrollerV2Address;
    const streamCreator = timelockAddress;
    const streamingAmount = ethers.parseUnits("2000000", 6);
    const slippage = 5e5;
    const claimCooldown = time.duration.days(7);
    const sweepCooldown = time.duration.days(10);
    const streamDuration = time.duration.years(1);
    const minimumNoticePeriod = time.duration.days(30);
    let timelockSigner: HardhatEthersSigner;
    let comptrollerV2: IComptrollerV2;
    let COMP: IERC20;

    before(async () => {
        comptrollerV2 = await ethers.getContractAt("IComptrollerV2", comptrollerV2Address);
        COMP = await ethers.getContractAt("IERC20", CompAddress);
        timelockSigner = await ethers.getImpersonatedSigner(timelockAddress);
    });

    const fixture = async () => {
        const { user, streamer, signers } = await deployStreamer();
        await initStreamer(streamer, streamingAmount, timelockSigner);
        return { user, streamer, signers };
    };

    const deployStreamer = async () => {
        const [user, ...signers] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        const streamer = await streamerFactory.deploy(
            CompAddress,
            COMP_ORACLE,
            USDC_ORACLE,
            returnAddress,
            streamCreator,
            user,
            18,
            6,
            streamingAmount,
            slippage,
            claimCooldown,
            sweepCooldown,
            streamDuration,
            minimumNoticePeriod
        );
        await streamer.waitForDeployment();
        return { streamer, user, signers };
    };

    const initStreamer = async (streamer: Streamer, nativeAssetAmount: bigint, sender: HardhatEthersSigner) => {
        const streamingAssetAmount = await streamer.calculateStreamingAssetAmount(nativeAssetAmount + 1n);
        await comptrollerV2.connect(timelockSigner)._grantComp(streamer, streamingAssetAmount);
        await streamer.connect(sender).initialize();
    };

    const getExpectedAmount = async (streamer: Streamer, claimTimestamp: number) => {
        const startTimestamp = await streamer.startTimestamp();
        let owed =
            claimTimestamp < startTimestamp + BigInt(streamDuration)
                ? (streamingAmount * (BigInt(claimTimestamp) - startTimestamp)) / BigInt(streamDuration)
                : streamingAmount;
        owed -= await streamer.nativeAssetSuppliedAmount();
        const expectedAmount = await streamer.calculateStreamingAssetAmount(owed);
        return expectedAmount;
    };

    const restore = async () => await loadFixture(fixture);

    it("Should initialize", async () => {
        const { streamer, user } = await restore();

        // Check initialize
        expect(await streamer.startTimestamp()).to.equal(await time.latest());
        expect(await streamer.lastClaimTimestamp()).to.equal(await time.latest());
        // Check constructor
        expect(await streamer.streamingAsset()).to.equal(CompAddress);
        expect(await streamer.streamingAssetOracle()).to.equal(COMP_ORACLE);
        expect(await streamer.nativeAssetOracle()).to.equal(USDC_ORACLE);
        expect(await streamer.returnAddress()).to.equal(returnAddress);
        expect(await streamer.streamCreator()).to.equal(streamCreator);
        expect(await streamer.recipient()).to.equal(user);
        expect(await streamer.nativeAssetStreamingAmount()).to.equal(streamingAmount);
        expect(await streamer.slippage()).to.equal(slippage);
        expect(await streamer.claimCooldown()).to.equal(claimCooldown);
        expect(await streamer.sweepCooldown()).to.equal(sweepCooldown);
        expect(await streamer.streamDuration()).to.equal(streamDuration);
        expect(await streamer.streamingAssetDecimals()).to.equal(18); // COMP has 18 decimals
        expect(await streamer.nativeAssetDecimals()).to.equal(6); // USDC has 6 decimals
        expect(await streamer.streamingAssetOracleDecimals()).to.equal(8); // Chainlink oracle price feeds by default have 8 decimals
        expect(await streamer.nativeAssetOracleDecimals()).to.equal(8); // Chainlink oracle price feeds by default have 8 decimals
        expect(await streamer.getStreamState()).to.equal(StreamState.STARTED);
    });

    it("Should not initialize with not enough supply", async () => {
        // Deploy streamer
        const { streamer } = await deployStreamer();

        // Try to initialize with not enough balance
        const nativeAssetAmount = streamingAmount / 2n;
        const streamingAssetAmount = await streamer.calculateStreamingAssetAmount(nativeAssetAmount + 1n);
        await expect(initStreamer(streamer, nativeAssetAmount, timelockSigner))
            .revertedWithCustomError(streamer, "NotEnoughBalance")
            .withArgs(streamingAssetAmount, streamingAmount);
    });

    it("Should let only Stream Creator initialize", async () => {
        // Deploy streamer
        const { user, streamer } = await deployStreamer();

        await expect(initStreamer(streamer, streamingAmount, user)).revertedWithCustomError(
            streamer,
            "NotStreamCreator"
        );
    });

    it("Should not let initialize more than once", async () => {
        const { streamer } = await restore();

        await expect(streamer.connect(timelockSigner).initialize()).revertedWithCustomError(
            streamer,
            "AlreadyInitialized"
        );
    });

    it("Should not deploy if zero value provided", async () => {
        const [user] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        // Streaming Asset
        await expect(
            streamerFactory.deploy(
                ethers.ZeroAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "ZeroAddress");
        // Recipient
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                ethers.ZeroAddress,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "ZeroAddress");
        // Stream Creator
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                ethers.ZeroAddress,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "ZeroAddress");
        // Return address
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                ethers.ZeroAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "ZeroAddress");
        // Streaming amount
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                0,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "ZeroAmount");
    });

    it("Should not deploy if slippage exceed slippage scale", async () => {
        const [user] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        await expect(
            streamerFactory.deploy(
                COMP,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                SLIPPAGE_SCALE + 1000,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "SlippageExceedsScaleFactor");
    });

    it("Should not deploy if duration is less than minimum duration", async () => {
        const [user] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        // Claim duration
        await expect(
            streamerFactory.deploy(
                COMP,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                MIN_DURATION - time.duration.days(1),
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DurationTooShort");
        // Sweep duration
        await expect(
            streamerFactory.deploy(
                COMP,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                MIN_DURATION - time.duration.days(1),
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DurationTooShort");
        // Stream duration
        await expect(
            streamerFactory.deploy(
                COMP,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                MIN_DURATION - time.duration.days(1),
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DurationTooShort");
        // Minimum notice period
        await expect(
            streamerFactory.deploy(
                COMP,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                MIN_DURATION - time.duration.days(1)
            )
        ).revertedWithCustomError(streamerFactory, "DurationTooShort");
    });

    it("Should not deploy if minimum notice period is longer than stream duration", async () => {
        const [user] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                streamDuration + time.duration.days(1)
            )
        ).revertedWithCustomError(streamerFactory, "NoticePeriodExceedsStreamDuration");
    });

    it("Should not deploy if decimals are less than minimum", async () => {
        const [user] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                5,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DecimalsNotInBounds");
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                2,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DecimalsNotInBounds");
        // Deploy Mock oracle with low decimals
        const mockOracle = await (await ethers.getContractFactory("SimplePriceFeed")).deploy(0, 5);
        await expect(
            streamerFactory.deploy(
                CompAddress,
                mockOracle,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DecimalsNotInBounds");
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                mockOracle,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "DecimalsNotInBounds");
    });

    it("Should not deploy if streaming amount is less than 1 dollar", async () => {
        const [user] = await ethers.getSigners();
        const streamerFactory = await ethers.getContractFactory("Streamer");
        const newStreamingAmount = ethers.parseUnits("0.8", 6);
        await expect(
            streamerFactory.deploy(
                CompAddress,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                user,
                18,
                6,
                newStreamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            )
        ).revertedWithCustomError(streamerFactory, "StreamingAmountTooLow");
    });

    it("Should claim", async () => {
        const { streamer, user } = await restore();
        await time.increase(time.duration.days(3));
        const expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        const tx = streamer.connect(user).claim();

        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
    });

    it("Should not claim before initialization", async () => {
        const { user, streamer } = await deployStreamer();

        await expect(streamer.connect(user).claim()).revertedWithCustomError(streamer, "NotInitialized");
    });

    it("Should not let not recipient claim", async () => {
        const { streamer } = await restore();

        await expect(streamer.connect(timelockSigner).claim()).revertedWithCustomError(streamer, "NotReceiver");
    });

    it("Should claim several times", async () => {
        const { streamer, user } = await restore();
        const advanceTimeDurations = [
            time.duration.days(7),
            time.duration.hours(5),
            time.duration.days(30),
            time.duration.days(1),
            time.duration.hours(31)
        ];
        for (const advanceTime of advanceTimeDurations) {
            await time.increase(advanceTime);
            const expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
            const tx = streamer.connect(user).claim();
            await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        }
    });

    it("Should let not recipient claim if receiver did not claim for a claim duration", async () => {
        const { streamer, user, signers } = await restore();
        // Claim for the first time (Recipient doesn't claim for claim duration)
        await expect(streamer.connect(signers[0]).claim()).revertedWithCustomError(streamer, "NotReceiver");
        let expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        let tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        // Recipient claims
        await time.increase(time.duration.hours(1));
        expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        // Not recipient tries to claim after recipient
        await time.increase(claimCooldown / 2);
        await expect(streamer.connect(signers[0]).claim()).revertedWithCustomError(streamer, "NotReceiver");
        // Not recipient claims after cooldown period
        await time.increase(claimCooldown / 2);
        expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        tx = streamer.connect(signers[0]).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
    });

    it("Should claim all (Claiming each month during duration period)", async () => {
        const { streamer, user } = await restore();
        for (let i = 0; i < 12; i++) {
            await time.increase(streamDuration / 12);
            const expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
            const tx = streamer.connect(user).claim();
            await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        }
        const owed = await streamer.getNativeAssetAmountOwed();
        const suppliedAmount = await streamer.nativeAssetSuppliedAmount();
        const claimedAmount = await streamer.streamingAssetClaimedAmount();
        expect(owed).to.equal(0);
        expect(suppliedAmount).to.equal(streamingAmount);
        expect(claimedAmount).to.be.closeTo(await streamer.calculateStreamingAssetAmount(streamingAmount), DUST);
    });

    it("Should not claim after all is claimed", async () => {
        const { streamer, user } = await restore();
        for (let i = 0; i < 12; i++) {
            await time.increase(streamDuration / 12);
            const expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
            const tx = streamer.connect(user).claim();
            await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        }

        await expect(streamer.connect(user).claim()).revertedWithCustomError(streamer, "ZeroAmount");
    });

    it("Should sweep all after stream duration", async () => {
        const { streamer, user } = await restore();
        await time.increase(streamDuration + sweepCooldown);

        const balance = await COMP.balanceOf(streamer);
        const tx = streamer.connect(user).sweepRemaining();
        await expect(tx).changeTokenBalances(COMP, [streamer, returnAddress], [-balance, balance]);
    });

    it("Should not sweep all before stream is finished", async () => {
        const { streamer, user } = await restore();
        await time.increase(streamDuration / 2);
        await expect(streamer.connect(user).sweepRemaining()).revertedWithCustomError(
            streamer,
            "SweepCooldownNotPassed"
        );
    });

    it("Should not let stream creator sweep all before stream is finished", async () => {
        const { streamer, user } = await restore();
        // Claim 1 time
        await time.increase(time.duration.days(20));
        await streamer.connect(user).claim();
        // Sweep remaining
        await expect(streamer.connect(timelockSigner).sweepRemaining()).revertedWithCustomError(
            streamer,
            "CreatorCannotSweepYet"
        );
    });

    it("should sweep all after stream is finished", async () => {
        const { streamer, user, signers } = await restore();
        for (let i = 0; i < 12; i++) {
            await time.increase(streamDuration / 12);
            const expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
            const tx = streamer.connect(user).claim();
            await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        }
        const remainingBalance = await COMP.balanceOf(streamer);
        expect(remainingBalance).to.be.greaterThan(0);
        await time.increase(sweepCooldown);
        expect(await streamer.getStreamState()).to.equal(StreamState.FINISHED);
        const tx = streamer.connect(signers[0]).sweepRemaining();
        await expect(tx).changeTokenBalances(COMP, [streamer, returnAddress], [-remainingBalance, remainingBalance]);
    });

    it("Should claim available amount if balance is not enough", async () => {
        const { streamer, user } = await restore();
        for (let i = 0; i < 11; i++) {
            await time.increase(streamDuration / 12);
            await streamer.connect(user).claim();
        }
        const streamerBalance = await COMP.balanceOf(streamer);

        // Simulate decrease of balance. In normal conditions, lack of balance should happen due to the price growth.
        const streamerSignerMock = await ethers.getImpersonatedSigner(await streamer.getAddress());
        const remainingAmount = ethers.parseUnits("1000", 18);
        await network.provider.request({
            method: "hardhat_setBalance",
            params: [await streamer.getAddress(), "0x100000000000000000"]
        });
        await COMP.connect(streamerSignerMock).transfer(timelockAddress, streamerBalance - remainingAmount);
        // Check that balance is decreased
        expect(await COMP.balanceOf(streamer)).to.equal(remainingAmount);

        // Claim remaining
        await time.increaseTo(Number(await streamer.startTimestamp()) + streamDuration);
        const expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        expect(expectedAmount).to.be.greaterThan(remainingAmount);
        const tx = streamer.connect(user).claim();
        await expect(tx).to.not.be.reverted;
        await expect(tx).changeTokenBalance(COMP, user, remainingAmount);
        // Check that the streamer still ows user the tokens
        expect(await getExpectedAmount(streamer, (await time.latest()) + 1)).to.be.closeTo(
            expectedAmount - remainingAmount,
            1e12
        );
    });

    it("Should terminate stream with standard notice period", async () => {
        const { streamer, user } = await restore();
        // Skip the time for 5 month
        await time.increase(time.duration.days(5 * 30));
        // Terminate the stream
        await streamer.connect(timelockSigner).terminateStream(0);
        expect(await streamer.terminationTimestamp()).to.equal((await time.latest()) + minimumNoticePeriod);
        expect(await streamer.getStreamState()).to.equal(StreamState.SHORTENED);
        const expectedWholeAmount = await getExpectedAmount(streamer, Number(await streamer.terminationTimestamp()));
        let expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        // Claim after termination
        let tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        // Claim one more time during temination period
        await time.increase(minimumNoticePeriod / 2);
        expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        // Claim whole after termination period
        await time.increaseTo(Number(await streamer.terminationTimestamp()));
        expectedAmount = await getExpectedAmount(streamer, await time.latest());
        tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        expect(await COMP.balanceOf(user)).to.be.closeTo(expectedWholeAmount, DUST);
        // Check that no more tokens are accrued
        await time.increase(time.duration.days(5));
        await expect(streamer.connect(user).claim()).revertedWithCustomError(streamer, "ZeroAmount");
        // Sweep remaining
        const remainingBalance = await COMP.balanceOf(streamer);
        expect(await streamer.calculateNativeAssetAmount(remainingBalance)).to.be.closeTo(
            (await streamer.nativeAssetStreamingAmount()) - (await streamer.nativeAssetSuppliedAmount()),
            DUST
        );
        tx = streamer.connect(timelockSigner).sweepRemaining();
        await expect(tx).changeTokenBalance(COMP, returnAddress, remainingBalance);
    });

    it("Should terminate stream with custom notice period", async () => {
        const { streamer, user } = await restore();
        // Skip the time for 5 month
        await time.increase(time.duration.days(5 * 30));
        // Terminate the stream
        const newTerminationTimestamp = (await time.latest()) + time.duration.days(60);
        await streamer.connect(timelockSigner).terminateStream(newTerminationTimestamp);
        expect(await streamer.terminationTimestamp()).to.equal(newTerminationTimestamp);
        expect(await streamer.getStreamState()).to.equal(StreamState.SHORTENED);
        const expectedWholeAmount = await getExpectedAmount(streamer, Number(await streamer.terminationTimestamp()));
        let expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        // Claim after termination
        let tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        // Claim one more time during temination period
        await time.increase(minimumNoticePeriod / 2);
        expectedAmount = await getExpectedAmount(streamer, (await time.latest()) + 1);
        tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        // Claim whole after termination period
        await time.increaseTo(Number(await streamer.terminationTimestamp()));
        expectedAmount = await getExpectedAmount(streamer, await time.latest());
        tx = streamer.connect(user).claim();
        await expect(tx).changeTokenBalance(COMP, user, expectedAmount);
        expect(await COMP.balanceOf(user)).to.be.closeTo(expectedWholeAmount, DUST);
        // Check that no more tokens are accrued
        await time.increase(time.duration.days(5));
        await expect(streamer.connect(user).claim()).revertedWithCustomError(streamer, "ZeroAmount");
        // Sweep remaining
        const remainingBalance = await COMP.balanceOf(streamer);
        expect(await streamer.calculateNativeAssetAmount(remainingBalance)).to.be.closeTo(
            (await streamer.nativeAssetStreamingAmount()) - (await streamer.nativeAssetSuppliedAmount()),
            DUST
        );
        tx = streamer.connect(timelockSigner).sweepRemaining();
        await expect(tx).changeTokenBalance(COMP, returnAddress, remainingBalance);
    });

    it("Should not let terminate if passed termination timestamp is after stream duration", async () => {
        const { streamer } = await restore();
        const newTerminationTimestamp =
            Number(await streamer.startTimestamp()) + streamDuration + time.duration.days(1);
        await expect(streamer.connect(timelockSigner).terminateStream(newTerminationTimestamp)).revertedWithCustomError(
            streamer,
            "TerminationIsAfterStream"
        );
    });

    it("Should not let terminate if block.timestamp + minimum notice period is after stream duration", async () => {
        const { streamer } = await restore();
        await time.increaseTo(Number(await streamer.startTimestamp()) + streamDuration - minimumNoticePeriod / 2);
        await expect(streamer.connect(timelockSigner).terminateStream(0)).revertedWithCustomError(
            streamer,
            "TerminationIsAfterStream"
        );
    });

    it("Should not let terminate if notice period is shorter than minimum notice period", async () => {
        const { streamer } = await restore();
        const newTerminationTimestamp = (await time.latest()) + minimumNoticePeriod / 2;
        await expect(streamer.connect(timelockSigner).terminateStream(newTerminationTimestamp)).revertedWithCustomError(
            streamer,
            "DurationTooShort"
        );
    });

    it("Should let only stream creator terminate", async () => {
        const { streamer, user } = await restore();
        await expect(streamer.connect(user).terminateStream(0)).revertedWithCustomError(streamer, "NotStreamCreator");
    });

    it("Should not let terminate more than once", async () => {
        const { streamer } = await restore();
        await streamer.connect(timelockSigner).terminateStream(0);
        await time.increase(time.duration.days(60));
        await expect(streamer.connect(timelockSigner).terminateStream(0)).revertedWithCustomError(
            streamer,
            "AlreadyTerminated"
        );
    });

    it("Should let stream creator sweep before initialization", async () => {
        const { streamer, user } = await deployStreamer();
        const amount = ethers.parseEther("100");
        await comptrollerV2.connect(timelockSigner)._grantComp(streamer, amount);
        await expect(streamer.connect(user).sweepRemaining()).revertedWithCustomError(streamer, "NotStreamCreator");
        const tx = streamer.connect(timelockSigner).sweepRemaining();
        await expect(tx).changeTokenBalance(COMP, returnAddress, amount);
    });

    it("Should rescue token", async () => {
        const { streamer } = await restore();
        const token = await (await ethers.getContractFactory("MockERC20")).deploy("Mock token", "MOCK", 18);
        const amount = ethers.parseEther("100");
        await token.mint(streamer, amount);
        const tx = streamer.connect(timelockSigner).rescueToken(token);
        await expect(tx).changeTokenBalance(token, returnAddress, amount);
    });

    it("Should not let rescue streaming asset", async () => {
        const { streamer } = await restore();
        await expect(streamer.connect(timelockSigner).rescueToken(COMP)).revertedWithCustomError(
            streamer,
            "CantRescueStreamingAsset"
        );
    });

    it("Only stream creator can rescue token", async () => {
        const { streamer, user } = await restore();
        const token = await (await ethers.getContractFactory("MockERC20")).deploy("Mock token", "MOCK", 18);
        const amount = ethers.parseEther("100");
        await token.mint(streamer, amount);
        await expect(streamer.connect(user).rescueToken(token)).revertedWithCustomError(streamer, "NotStreamCreator");
    });

    it("Should distribute same amount of streaming asset for 6 month with and without termination", async () => {
        const { streamer, user } = await restore();
        // Skip 5 month
        await time.increase(time.duration.days(5 * 30));
        const snapshot = await takeSnapshot();
        // Skip 1 more month and claim for 6 month
        await time.increase(time.duration.days(30));
        await streamer.connect(user).claim();
        const balWithoutTermination = await COMP.balanceOf(user);
        await snapshot.restore();
        // Terminate, skip 1 month and claim
        await streamer.connect(timelockSigner).terminateStream(0);
        await time.increase(time.duration.days(30));
        await streamer.connect(user).claim();
        const balWithTermination = await COMP.balanceOf(user);
        expect(balWithoutTermination).to.equal(balWithTermination);
        // Check that this a correct amount of asset for 6 month duration
        const expectedNativeAsset = (streamingAmount * BigInt(time.duration.days(6 * 30) + 1)) / BigInt(streamDuration);
        const expectedStreamingAsset = await streamer.calculateStreamingAssetAmount(expectedNativeAsset);
        expect(expectedStreamingAsset).to.equal(balWithTermination);
        // Check that no more asset is accrued after termination
        await time.increase(time.duration.hours(10));
        await expect(streamer.connect(user).claim()).revertedWithCustomError(streamer, "ZeroAmount");
    });

    it("Should revert termination if stream is not initialized", async () => {
        const { streamer } = await deployStreamer();
        await expect(streamer.connect(timelockSigner).terminateStream(0)).revertedWithCustomError(
            streamer,
            "TerminationIsAfterStream"
        );
    });

    it("Should return 0 amount owed before initialization", async () => {
        const { streamer } = await deployStreamer();
        expect(await streamer.getStreamEnd()).to.equal(0);
        expect(await streamer.getNativeAssetAmountOwed()).to.equal(0);
    });

    it("Should return stream state not initialized before initialization", async () => {
        const { streamer } = await deployStreamer();
        expect(await streamer.getStreamState()).to.equal(StreamState.NOT_INITIALIZED);
    });
});
