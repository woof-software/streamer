import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("StreamerFactory", function () {
    const COMP = "0xc00e94Cb662C3520282E6f5717214004A7f26888",
        USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        COMP_ORACLE = "0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5",
        USDC_ORACLE = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
    const streamingAmount = ethers.parseUnits("2000000", 6);
    const slippage = 5e5;
    const claimCooldown = time.duration.days(7);
    const sweepCooldown = time.duration.days(10);
    const streamDuration = time.duration.years(1);
    const minimumNoticePeriod = time.duration.days(90);

    const fixture = async () => {
        const [deployer, ...signers] = await ethers.getSigners();
        const factory = await (await ethers.getContractFactory("StreamerFactory")).deploy();
        await factory.waitForDeployment();
        return { deployer, signers, factory };
    };

    const restore = async () => await loadFixture(fixture);

    it("Should deploy streamer", async () => {
        const { signers, factory } = await restore();
        const returnAddress = signers[0];
        const streamCreator = signers[1];
        const recipient = signers[2];

        const streamerAddress = await factory
            .connect(streamCreator)
            .deployStreamer.staticCall(
                COMP,
                USDC,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                recipient,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            );
        await factory
            .connect(streamCreator)
            .deployStreamer(
                COMP,
                USDC,
                COMP_ORACLE,
                USDC_ORACLE,
                returnAddress,
                streamCreator,
                recipient,
                streamingAmount,
                slippage,
                claimCooldown,
                sweepCooldown,
                streamDuration,
                minimumNoticePeriod
            );

        const streamer = await ethers.getContractAt("Streamer", streamerAddress);
        expect(await streamer.streamCreator()).to.equal(streamCreator);
        expect(await factory.counters(streamCreator)).to.equal(1);
    });

    it("Should revert if streaming and native assets are the same", async () => {
        const { signers, factory } = await restore();
        const returnAddress = signers[0];
        const streamCreator = signers[1];
        const recipient = signers[2];
        await expect(
            factory
                .connect(streamCreator)
                .deployStreamer(
                    COMP,
                    COMP,
                    COMP_ORACLE,
                    USDC_ORACLE,
                    returnAddress,
                    streamCreator,
                    recipient,
                    streamingAmount,
                    slippage,
                    claimCooldown,
                    sweepCooldown,
                    streamDuration,
                    minimumNoticePeriod
                )
        ).revertedWithCustomError(factory, "AssetsMatch");
    });

    // This test is currently commented as it would require to pick up a certain deployer's address in order to produce the issue
    // it("Should revert if streamer is already deployed (same deployer and salt)", async () => {
    //     const { signers, factory } = await restore();
    //     const returnAddress = signers[0];
    //     const streamCreator = signers[1];
    //     const recipient = signers[2];
    //     await factory
    //         .connect(streamCreator)
    //         .deployStreamer(
    //             COMP,
    //             USDC,
    //             COMP_ORACLE,
    //             USDC_ORACLE,
    //             returnAddress,
    //             recipient,
    //             streamingAmount,
    //             slippage,
    //             claimCooldown,
    //             sweepCooldown,
    //             streamDuration
    //         );
    //     await expect(
    //         factory
    //             .connect(streamCreator)
    //             .deployStreamer(
    //                 COMP,
    //                 USDC,
    //                 COMP_ORACLE,
    //                 USDC_ORACLE,
    //                 returnAddress,
    //                 recipient,
    //                 streamingAmount,
    //                 slippage,
    //                 claimCooldown,
    //                 sweepCooldown,
    //                 streamDuration
    //             )
    //     ).revertedWithCustomError(factory, "ContractIsAlreadyDeployedException");
    // });
});
