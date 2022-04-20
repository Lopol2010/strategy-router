const { expect, should, use, assert } = require("chai");
const { BigNumber } = require("ethers");
const { parseEther, parseUnits, formatEther, formatUnits } = require("ethers/lib/utils");
const { ethers } = require("hardhat");
const { getTokens } = require("./utils");

// ~~~~~~~~~~~ HELPERS ~~~~~~~~~~~ 
provider = ethers.provider;
parseUsdc = (args) => parseUnits(args, 18);
parseUst = (args) => parseUnits(args, 18);
parseUniform = (args) => parseUnits(args, 18);
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ 

describe("Test rebalance functions", function () {


  it("Snapshot evm", async function () {
    snapshotId = await provider.send("evm_snapshot");
  });

  after(async function () {
    await provider.send("evm_revert", [snapshotId]);
  });

  it("Define globals", async function () {

    [owner, joe, bob] = await ethers.getSigners();
    // ~~~~~~~~~~~ GET EXCHANGE ROUTER ~~~~~~~~~~~ 
    uniswapRouter = await ethers.getContractAt(
      "IUniswapV2Router02",
      "0x10ED43C718714eb63d5aA57B78B54704E256024E"
    );

    // ~~~~~~~~~~~ GET BUSD ON MAINNET ~~~~~~~~~~~ 

    BUSD = "0xe9e7cea3dedca5984780bafc599bd69add087d56";
    busdHolder = "0x8894e0a0c962cb723c1976a4421c95949be2d4e3";
    busd = await getTokens(BUSD, busdHolder, parseEther("500000"), owner.address);

    // ~~~~~~~~~~~ GET IAcryptoSPool ON MAINNET ~~~~~~~~~~~ 
    ACS4UST = "0x99c92765EfC472a9709Ced86310D64C4573c4b77";
    acsUst = await ethers.getContractAt("IAcryptoSPool", ACS4UST);

    // ~~~~~~~~~~~ GET UST TOKENS ON MAINNET ~~~~~~~~~~~ 
    UST = "0x23396cf899ca06c4472205fc903bdb4de249d6fc";
    ustHolder = "0x05faf555522fa3f93959f86b41a3808666093210";
    ust = await getTokens(UST, ustHolder, parseUst("500000"), owner.address);
    // ~~~~~~~~~~~ GET USDC TOKENS ON MAINNET ~~~~~~~~~~~ 
    USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
    usdcHolder = "0xf977814e90da44bfa03b6295a0616a897441acec";
    usdc = await getTokens(USDC, usdcHolder, parseUsdc("500000"), owner.address);
    // ~~~~~~~~~~~ GET BSW TOKENS ON MAINNET ~~~~~~~~~~~ 
    BSW = "0x965F527D9159dCe6288a2219DB51fc6Eef120dD1";
    bswHolder = "0x000000000000000000000000000000000000dead";
    bsw = await getTokens(BSW, bswHolder, parseEther("10000000"), owner.address);

  });

  it("Deploy StrategyRouter", async function () {

    // ~~~~~~~~~~~ DEPLOY Exchange ~~~~~~~~~~~ 
    exchange = await ethers.getContractFactory("Exchange");
    exchange = await exchange.deploy();
    await exchange.deployed();

    // ~~~~~~~~~~~ DEPLOY StrategyRouter ~~~~~~~~~~~ 
    const StrategyRouter = await ethers.getContractFactory("StrategyRouter");
    router = await StrategyRouter.deploy();
    await router.deployed();
    await router.setMinUsdPerCycle(parseUniform("1.0"));
    await router.setExchange(exchange.address);

    // ~~~~~~~~~~~ SETUP GLOBALS ~~~~~~~~~~~ 
    receiptContract = await ethers.getContractAt(
      "ReceiptNFT",
      await router.receiptContract()
    );
    sharesToken = await ethers.getContractAt(
      "SharesToken",
      await router.sharesToken()
    );
    exchange = await ethers.getContractAt(
      "Exchange",
      await router.exchange()
    );

    await router.setCycleDuration(1);
    CYCLE_DURATION = Number(await router.cycleDuration());
    INITIAL_SHARES = await router.INITIAL_SHARES();

    // console.log(await exchange.estimateGas.test(parseUst("10"), ust.address, usdc.address));
    // console.log(await exchange.test(parseUsdc("1000"), usdc.address, ust.address));
    // console.log(await exchange.test(parseUst("1000"), ust.address, usdc.address));
  });

  it("Approve router", async function () {
    await ust.approve(router.address, parseUst("1000000"));
    await busd.approve(router.address, parseEther("1000000"));
    await usdc.approve(router.address, parseUsdc("1000000"));
  });

  it("evm_snapshot", async function () {
    snapshotId = await provider.send("evm_snapshot");
  });

  describe("Test rebalanceBatching function", function () {
    beforeEach(async () => {
      // console.log("bef each");
      await provider.send("evm_revert", [snapshotId]);
      snapshotId = await provider.send("evm_snapshot");
    });

    it("ust strategy, router supports only ust, should revert", async function () {

      await router.setSupportedStablecoin(ust.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      await router.addStrategy(farm.address, ust.address, 5000);

      await expect(router.rebalanceBatching()).to.be.revertedWith("NothingToRebalance()");
    });

    it("ust strategy, router supports multiple arbitrary tokens", async function () {

      await router.setSupportedStablecoin(ust.address, true);
      await router.setSupportedStablecoin(busd.address, true);
      await router.setSupportedStablecoin(usdc.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      await router.addStrategy(farm.address, ust.address, 5000);

      await router.depositToBatch(ust.address, parseUst("1"));
      await router.depositToBatch(busd.address, parseUst("1"));
      await router.depositToBatch(usdc.address, parseUst("1"));

      await verifyTokensRatio([1, 1, 1]);

      let ret = await router.callStatic.rebalanceBatching();
      let gas = (await (await router.rebalanceBatching()).wait()).gasUsed;
      console.log("gasUsed", gas);
      // console.log("ret", ret);
      // console.log("getTokenBalances", await getTokenBalances());

      await verifyTokensRatio([1, 0, 0]);

    });

    it("two ust strategies, router supports only ust", async function () {

      await router.setSupportedStablecoin(ust.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      let farm2 = await createMockFarm(ust.address, 10000);
      await router.addStrategy(farm.address, ust.address, 5000);
      await router.addStrategy(farm2.address, ust.address, 5000);

      await router.depositToBatch(ust.address, parseUst("1"));

      let ret = await router.callStatic.rebalanceBatching();
      await verifyRatioOfReturnedData([1, 1], ret);

      let gas = (await (await router.rebalanceBatching()).wait()).gasUsed;
      console.log("gasUsed", gas);
      // console.log("ret", ret);
      // console.log("getTokenBalances", await getTokenBalances());


    });

    it("two ust strategies, router supports ust,busd,usdc", async function () {

      await router.setSupportedStablecoin(ust.address, true);
      await router.setSupportedStablecoin(busd.address, true);
      await router.setSupportedStablecoin(usdc.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      let farm2 = await createMockFarm(ust.address, 10000);
      await router.addStrategy(farm.address, ust.address, 5000);
      await router.addStrategy(farm2.address, ust.address, 5000);

      await router.depositToBatch(ust.address, parseUst("1"));
      await router.depositToBatch(busd.address, parseUst("1"));
      await router.depositToBatch(usdc.address, parseUst("1"));

      await verifyTokensRatio([1, 1, 1]);

      let ret = await router.callStatic.rebalanceBatching();
      console.log(ret);
      await verifyRatioOfReturnedData([1, 1], ret);

      let gas = (await (await router.rebalanceBatching()).wait()).gasUsed;
      console.log("gasUsed", gas);
      // console.log("ret", ret);
      // console.log("getTokenBalances", await getTokenBalances());

      await verifyTokensRatio([1, 0, 0]);

    });

    it("ust and busd strategies, router supports ust,busd", async function () {

      await router.setSupportedStablecoin(ust.address, true);
      await router.setSupportedStablecoin(busd.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      let farm2 = await createMockFarm(busd.address, 10000);
      await router.addStrategy(farm2.address, busd.address, 5000);
      await router.addStrategy(farm.address, ust.address, 5000);

      await router.depositToBatch(ust.address, parseUst("2"));
      await router.depositToBatch(busd.address, parseUst("1"));

      await verifyTokensRatio([2, 1]);

      let ret = await router.callStatic.rebalanceBatching();
      console.log(ret);
      await verifyRatioOfReturnedData([1, 1], ret);

      let gas = (await (await router.rebalanceBatching()).wait()).gasUsed;
      console.log("gasUsed", gas);
      // console.log("ret", ret);
      // console.log("getTokenBalances", await getTokenBalances());

      await verifyTokensRatio([1, 1]);

    });

    it("ust and busd strategies, router supports ust,busd,usdc", async function () {

      await router.setSupportedStablecoin(busd.address, true);
      await router.setSupportedStablecoin(usdc.address, true);
      await router.setSupportedStablecoin(ust.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      let farm2 = await createMockFarm(busd.address, 10000);
      await router.addStrategy(farm2.address, busd.address, 5000);
      await router.addStrategy(farm.address, ust.address, 5000);

      await router.depositToBatch(ust.address, parseUst("2"));
      await router.depositToBatch(busd.address, parseUst("1"));
      await router.depositToBatch(usdc.address, parseUst("5"));

      await verifyTokensRatio([1, 5, 2]);

      let ret = await router.callStatic.rebalanceBatching();
      console.log(ret);
      await verifyRatioOfReturnedData([1, 1], ret);

      let gas = (await (await router.rebalanceBatching()).wait()).gasUsed;
      console.log("gasUsed", gas);
      // console.log("ret", ret);
      // console.log("getTokenBalances", await getTokenBalances());

      await verifyTokensRatio([1, 0, 1]);

    });

    it("'dust' token balances should not be swapped on dexes", async function () {

      await router.setSupportedStablecoin(busd.address, true);
      await router.setSupportedStablecoin(usdc.address, true);
      await router.setSupportedStablecoin(ust.address, true);

      let farm = await createMockFarm(ust.address, 10000);
      await router.addStrategy(farm.address, ust.address, 5000);

      await router.depositToBatch(ust.address, 2);
      await router.depositToBatch(busd.address, 2);
      await router.depositToBatch(usdc.address, parseUsdc("1"));

      let ret = await router.callStatic.rebalanceBatching();
      // console.log(ret);
      await expect(ret.balances[0]).to.be.closeTo(
        parseUst("1"),
        parseUst("0.01")
      );

      let gas = (await (await router.rebalanceBatching()).wait()).gasUsed;
      console.log("gasUsed", gas);
      // console.log("ret", ret);
      // console.log("getTokenBalances", await getTokenBalances());

      await verifyTokensRatio([0, 0, 1]);

    });
  });
  // it("rebalanceStrategies", async function () {
  //     await router.depositToStrategies();

  //     let ret = await router.callStatic.rebalanceStrategies();
  //     let gas = (await (await router.rebalanceStrategies()).wait()).gasUsed;
  //     console.log("ret", ret);
  //     console.log("gasUsed %s", gas);
  //     console.log("viewStrategiesBalance", await router.viewStrategiesBalance());
  // });


  // it("User deposit", async function () {

  //   for (let i = 0; i < 2; i++) {

  //     await router.depositToBatch(ust.address, parseUst("2200"))
  //     await router.depositToBatch(ust.address, parseUst("2200"))
  //     await router.depositToBatch(ust.address, parseUst("700"))
  //     await router.depositToBatch(ust.address, parseUst("700"))

  //     await skipCycleTime();

  //     await router.depositToStrategies();
  //   }
  //   console.log(await receiptContract.walletOfOwner(owner.address));
  // });

});

async function verifyRatioOfReturnedData(weights, data) {
  assert(Number(await router.viewStrategiesCount()) == weights.length);
  const { totalInBatching, balances } = data;
  let totalWeight = weights.reduce((e, acc) => acc + e);
  const ERROR_THRESHOLD = 0.3;
  for (let i = 0; i < weights.length; i++) {
    const percentWeight = weights[i] * 100 / totalWeight;
    const percentBalance = balances[i] * 100 / totalInBatching;
    console.log(percentBalance, percentWeight);
    expect(percentBalance).to.be.closeTo(percentWeight, ERROR_THRESHOLD);
  }
}

// weights order should match 'stablecoins' order
async function verifyTokensRatio(weights) {
  assert((await router.viewStablecoins()).length == weights.length);
  const ERROR_THRESHOLD = 0.3;
  const { total, balances } = await getTokenBalances();
  let totalWeight = weights.reduce((e, acc) => acc + e);
  for (let i = 0; i < weights.length; i++) {
    const percentWeight = weights[i] * 100 / totalWeight;
    const percentBalance = balances[i] * 100 / total;
    // console.log(percentBalance, percentWeight);
    expect(percentBalance).to.be.closeTo(percentWeight, ERROR_THRESHOLD);
  }
}

async function getTokenBalances() {
  let stables = await router.viewStablecoins();
  let total = BigNumber.from(0);
  let balances = [];
  for (let i = 0; i < stables.length; i++) {
    const tokenAddr = stables[i];
    let token = await ethers.getContractAt("ERC20", tokenAddr);
    let balance = await token.balanceOf(router.address);
    total = total.add(BigNumber.from(balance));
    balances.push(balance)
  }
  return { total, balances };
}

async function createMockFarm(asset, profit_percent) {
  const Farm = await ethers.getContractFactory("MockFarm");
  let farm = await Farm.deploy(asset, profit_percent);
  await farm.deployed();
  return farm;
}