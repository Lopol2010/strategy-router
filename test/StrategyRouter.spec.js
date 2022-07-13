const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupCore, setupFakeTokens, setupTestParams, setupTokensLiquidityOnPancake, deployFakeStrategy } = require("./shared/commonSetup");
const { MaxUint256, parseUniform } = require("./utils");


describe("Test StrategyRouter", function () {

  let owner, nonReceiptOwner;
  // mock tokens with different decimals
  let usdc, usdt, busd;
  // helper functions to parse amounts of mock tokens
  let parseUsdc, parseBusd, parseUsdt;
  // core contracts
  let router, oracle, exchange, batching, receiptContract, sharesToken;
  // revert to test-ready state
  let snapshotId;
  // revert to fresh fork state
  let initialSnapshot;

  before(async function () {

    [owner, nonReceiptOwner] = await ethers.getSigners();
    initialSnapshot = await provider.send("evm_snapshot");

    // deploy core contracts
    ({ router, oracle, exchange, batching, receiptContract, sharesToken } = await setupCore());

    // deploy mock tokens 
    ({ usdc, usdt, busd, parseUsdc, parseBusd, parseUsdt } = await setupFakeTokens());

    // setup fake token liquidity
    let amount = (1_000_000).toString();
    await setupTokensLiquidityOnPancake(usdc, busd, amount);
    await setupTokensLiquidityOnPancake(busd, usdt, amount);
    await setupTokensLiquidityOnPancake(usdc, usdt, amount);

    // setup params for testing
    await setupTestParams(router, oracle, exchange, usdc, usdt, busd);

    // setup infinite allowance
    await busd.approve(router.address, parseBusd("1000000"));
    await usdc.approve(router.address, parseUsdc("1000000"));
    await usdt.approve(router.address, parseUsdt("1000000"));

    // setup supported tokens
    await router.setSupportedToken(usdc.address, true);
    await router.setSupportedToken(busd.address, true);
    await router.setSupportedToken(usdt.address, true);

    // add fake strategies
    await deployFakeStrategy({ router, token: busd });
    await deployFakeStrategy({ router, token: usdc });
    await deployFakeStrategy({ router, token: usdt });

    // admin initial deposit to set initial shares and pps
    await router.depositToBatch(busd.address, parseBusd("1"));
    await router.depositToStrategies();
  });

  beforeEach(async function () {
    snapshotId = await provider.send("evm_snapshot");
  });

  afterEach(async function () {
    await provider.send("evm_revert", [snapshotId]);
  });

  after(async () => {
    await provider.send("evm_revert", [initialSnapshot]);
  });


  it("should depositToStrategies", async function () {
    await router.depositToBatch(busd.address, parseBusd("100"))

    await router.depositToStrategies()
    let strategiesBalance = await router.getStrategiesValue()
    expect(strategiesBalance.totalBalance).to.be.closeTo(parseUniform("100"), parseUniform("2"));
  });

  it("should withdrawFromStrategies whole amount", async function () {
    await router.depositToBatch(busd.address, parseBusd("100"))
    await router.depositToStrategies()

    let receiptsShares = await router.receiptsToShares([1]);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawFromStrategies([1], usdc.address, receiptsShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("100"), parseUsdc("1"));
  });

  it("should withdrawFromStrategies both nft and shares", async function () {
    await router.depositToBatch(busd.address, parseBusd("100"))
    await router.depositToBatch(busd.address, parseBusd("100"))
    await router.depositToStrategies()

    await router.unlockShares([1]);

    let sharesBalance = await sharesToken.balanceOf(owner.address);
    let receiptsShares = await router.receiptsToShares([2]);
    let withdrawShares = sharesBalance.add(receiptsShares);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawFromStrategies([2], usdc.address, withdrawShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("200"), parseUsdc("2"));
  });

  it("crossWithdrawFromBatching", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("100000"));

    let oldBalance = await usdc.balanceOf(owner.address);
    let receiptsShares = await router.receiptsToShares([1]);
    await router.crossWithdrawFromBatching([1], usdc.address, receiptsShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("10000"), parseUsdc("500"));
  });

  it("crossWithdrawFromBatching both nft and shares", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("100000"));

    await router.unlockShares([1]);

    let sharesBalance = await sharesToken.balanceOf(owner.address);
    let receiptsShares = await router.receiptsToShares([2]);
    let withdrawShares = sharesBalance.add(receiptsShares);


    let oldBalance = await usdc.balanceOf(owner.address);
    await router.crossWithdrawFromBatching([2], usdc.address, withdrawShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("20000"), parseUsdc("2000"));

  });

  it("crossWithdrawFromStrategies", async function () {
    await router.depositToBatch(busd.address, parseBusd("100000")); // nft 1
    await router.depositToBatch(busd.address, parseBusd("20000")); // 2
    await router.depositToStrategies(); // 120k
    await router.depositToBatch(busd.address, parseBusd("10000")); // 3
    await router.depositToBatch(busd.address, parseBusd("20000")); // 4

    let receiptsShares = await router.receiptsToShares([2]);
    await router.crossWithdrawFromBatching([2], usdc.address, receiptsShares);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.crossWithdrawFromStrategies([3], usdc.address, [MaxUint256]);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("10000"), parseUsdc("200"));

  });

  it("withdrawShares", async function () {
    await router.depositToBatch(busd.address, parseBusd("100000"));
    await router.depositToStrategies();

    let receiptsShares = await router.receiptsToShares([1]);
    await router.unlockShares([1]);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawShares(receiptsShares, usdc.address);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("100000"), parseUsdc("10000"));
  });

  it("crossWithdrawShares", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("100000"));

    let receiptsShares = await router.receiptsToShares([1]);
    await router.unlockShares([1]);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.crossWithdrawShares(receiptsShares, usdc.address);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("10000"), parseUsdc("500"));

  });

  it("withdrawUniversal - withdraw from batching", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("100000"));

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawUniversal([2], [], usdc.address, [parseUsdc("100000")], 0);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("100000"), parseUsdc("20000"));
  });

  it("withdrawUniversal - withdraw shares (by receipt)", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("100000"));

    let receiptsShares = await router.receiptsToShares([1]);
    let amountFromShares = await router.sharesToUsd(receiptsShares);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawUniversal([], [1], usdc.address, [], receiptsShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("10000"), parseUsdc("600"));
  });

  it("withdrawUniversal - withdraw shares (no receipt)", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000"));
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("100000"));

    let receiptsShares = await router.receiptsToShares([1]);
    await router.unlockShares([1]);
    let amountFromShares = await router.sharesToUsd(receiptsShares);

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawUniversal([], [], usdc.address, [], receiptsShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("10000"), parseUsdc("500"));
  });

  it("withdrawUniversal - withdraw batch, shares and shares by receipt", async function () {
    await router.depositToBatch(busd.address, parseBusd("10000")); // 1
    await router.depositToBatch(busd.address, parseBusd("10000")); // 2
    await router.depositToStrategies();
    await router.depositToBatch(busd.address, parseBusd("10000")); // 3

    let withdrawShares = await router.receiptsToShares([1])
    await router.unlockShares([1]);
    let withdrawSharesFromReceipt = await router.receiptsToShares([2]);
    let totalShares = withdrawShares.add(withdrawSharesFromReceipt);

    let amountReceiptBatch = (await receiptContract.getReceipt(3)).amount;

    let oldBalance = await usdc.balanceOf(owner.address);
    await router.withdrawUniversal([3], [2], usdc.address, [amountReceiptBatch], totalShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(parseUsdc("30000"), parseUsdc("1000"));
    expect(await sharesToken.balanceOf(owner.address)).to.be.equal(0);
    expect(receiptContract.getReceipt(1)).to.be.reverted;
    expect(receiptContract.getReceipt(2)).to.be.reverted;
    expect(receiptContract.getReceipt(3)).to.be.reverted;
  });

  it("Remove strategy", async function () {

    // deposit to strategies
    await router.depositToBatch(busd.address, parseBusd("10"));
    await router.depositToStrategies();

    // deploy new farm
    const Farm = await ethers.getContractFactory("MockStrategy");
    farm2 = await Farm.deploy(usdc.address, 10000);
    await farm2.deployed();
    await farm2.transferOwnership(router.address);

    // add new farm
    await router.addStrategy(farm2.address, usdc.address, 1000);

    // remove 2nd farm with index 1
    await router.removeStrategy(1);
    await router.rebalanceStrategies();

    // withdraw user shares
    let oldBalance = await usdc.balanceOf(owner.address);
    let receiptsShares = await router.receiptsToShares([1]);
    await router.withdrawFromStrategies([1], usdc.address, receiptsShares);
    let newBalance = await usdc.balanceOf(owner.address);
    expect(newBalance.sub(oldBalance)).to.be.closeTo(
      parseUsdc("10"),
      parseUniform("1")
    );

  });

  describe("unlockSharesFromReceipts", function () {
    it("should revert when caller not whitelisted unlocker", async function () {
      await router.depositToBatch(busd.address, parseBusd("10"));
      await router.depositToStrategies();
      await expect(router.unlockSharesFromReceipts([1])).to.be.revertedWith("NotWhitelistedUnlocker()");
    });

    it("should unlock list of 1 receipt", async function () {
      await router.setUnlocker(owner.address, true);
      await router.depositToBatch(busd.address, parseBusd("10"));
      await router.depositToStrategies();
      let receiptsShares = await router.receiptsToShares([1]);

      let oldBalance = await sharesToken.balanceOf(owner.address);
      await router.unlockSharesFromReceipts([1]);
      let newBalance = await sharesToken.balanceOf(owner.address);

      expect(newBalance.sub(oldBalance)).to.be.equal(receiptsShares);
      let receipts = await receiptContract.getTokensOfOwner(owner.address);
      expect(receipts.toString()).to.be.equal("0");
    });

    it("should unlock list of 2 receipt same owner", async function () {
      await router.setUnlocker(owner.address, true);
      await router.depositToBatch(busd.address, parseBusd("10"));
      await router.depositToBatch(busd.address, parseBusd("10"));
      await router.depositToStrategies();
      let receiptsShares = await router.receiptsToShares([1]);
      let receiptsShares2 = await router.receiptsToShares([2]);

      let oldBalance = await sharesToken.balanceOf(owner.address);
      await router.unlockSharesFromReceipts([1,2]);
      let newBalance = await sharesToken.balanceOf(owner.address);
      expect(newBalance.sub(oldBalance)).to.be.equal(receiptsShares.add(receiptsShares2));

      let receipts = await receiptContract.getTokensOfOwner(owner.address);
      expect(receipts.toString()).to.be.equal("0");
    });

    it("should unlock list of 2 receipt with different owners", async function () {
      [,,,,owner2] = await ethers.getSigners();
      await router.setUnlocker(owner.address, true);
      await router.depositToBatch(busd.address, parseBusd("10"));
      await busd.transfer(owner2.address, parseBusd("10"));
      await busd.connect(owner2).approve(router.address, parseBusd("10"));
      await router.connect(owner2).depositToBatch(busd.address, parseBusd("10"));
      await router.depositToStrategies();
      let receiptsShares = await router.receiptsToShares([1]);
      let receiptsShares2 = await router.receiptsToShares([2]);

      let oldBalance = await sharesToken.balanceOf(owner.address);
      let oldBalance2 = await sharesToken.balanceOf(owner2.address);
      await router.unlockSharesFromReceipts([1,2]);
      let newBalance = await sharesToken.balanceOf(owner.address);
      let newBalance2 = await sharesToken.balanceOf(owner2.address);
      expect(newBalance.sub(oldBalance)).to.be.equal(receiptsShares);
      expect(newBalance2.sub(oldBalance2)).to.be.equal(receiptsShares2);

      let receipts = await receiptContract.getTokensOfOwner(owner.address);
      let receipts2 = await receiptContract.getTokensOfOwner(owner2.address);
      expect(receipts.toString()).to.be.equal("0");
      expect(receipts2.toString()).to.be.equal("");
    });

    it("should unlock list of 4 receipt, two different owners", async function () {
      [,,,,owner2] = await ethers.getSigners();
      await router.setUnlocker(owner.address, true);
      await router.depositToBatch(busd.address, parseBusd("10"));
      await router.depositToBatch(busd.address, parseBusd("10"));
      await busd.transfer(owner2.address, parseBusd("100"));
      await busd.connect(owner2).approve(router.address, parseBusd("100"));
      await router.connect(owner2).depositToBatch(busd.address, parseBusd("10"));
      await router.connect(owner2).depositToBatch(busd.address, parseBusd("10"));
      await router.depositToStrategies();
      let receiptsShares = await router.receiptsToShares([1,2]);
      let receiptsShares2 = await router.receiptsToShares([3,4]);

      let oldBalance = await sharesToken.balanceOf(owner.address);
      let oldBalance2 = await sharesToken.balanceOf(owner2.address);
      await router.unlockSharesFromReceipts([1,2,3,4]);
      let newBalance = await sharesToken.balanceOf(owner.address);
      let newBalance2 = await sharesToken.balanceOf(owner2.address);
      expect(newBalance.sub(oldBalance)).to.be.equal(receiptsShares);
      expect(newBalance2.sub(oldBalance2)).to.be.equal(receiptsShares2);

      let receipts = await receiptContract.getTokensOfOwner(owner.address);
      let receipts2 = await receiptContract.getTokensOfOwner(owner2.address);
      expect(receipts.toString()).to.be.equal("0");
      expect(receipts2.toString()).to.be.equal("");
    });

  });

});
