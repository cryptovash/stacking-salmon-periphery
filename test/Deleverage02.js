const {
  expectEqual,
  expectEvent,
  expectRevert,
  expectAlmostEqualMantissa,
  bnMantissa,
  BN,
} = require("./Utils/JS");
const { address, increaseTime, encode } = require("./Utils/Ethereum");
const {
  getAmounts,
  leverage,
  deleverage,
  permitGenerator,
} = require("./Utils/StackingSalmonPeriphery");
const { keccak256, toUtf8Bytes } = require("ethers").utils;

const MAX_UINT_256 = new BN(2).pow(new BN(256)).sub(new BN(1));
const DEADLINE = MAX_UINT_256;

const MockERC20 = artifacts.require("MockERC20");
const UniswapV2Factory = artifacts.require(
  "test/Contracts/spooky/UniswapV2Factory.sol:UniswapV2Factory"
);
const UniswapV2Router02 = artifacts.require(
  "test/Contracts/spooky/UniswapV2Router02.sol:UniswapV2Router02"
);
const UniswapV2Pair = artifacts.require(
  "test/Contracts/uniswap-v2-core/UniswapV2Pair.sol:UniswapV2Pair"
);
const StackingSalmonPriceOracle = artifacts.require("StackingSalmonPriceOracle");
const Factory = artifacts.require("Factory");
const BDeployer = artifacts.require("BDeployer");
const CDeployer = artifacts.require("CDeployer");
const Collateral = artifacts.require("Collateral");
const Borrowable = artifacts.require("Borrowable");
const Router02 = artifacts.require("Router02");
const WETH9 = artifacts.require("WETH9");

const oneMantissa = new BN(10).pow(new BN(18));
const UNI_LP_AMOUNT = oneMantissa;
const ETH_LP_AMOUNT = oneMantissa.div(new BN(100));
const UNI_LEND_AMOUNT = oneMantissa.mul(new BN(10));
const ETH_LEND_AMOUNT = oneMantissa.div(new BN(10));
const UNI_BORROW_AMOUNT = UNI_LP_AMOUNT.div(new BN(2));
const ETH_BORROW_AMOUNT = ETH_LP_AMOUNT.div(new BN(2));
const UNI_LEVERAGE_AMOUNT = oneMantissa.mul(new BN(6));
const ETH_LEVERAGE_AMOUNT = oneMantissa.mul(new BN(6)).div(new BN(100));
const LEVERAGE = new BN(7);
const DLVRG = new BN(5);
const UNI_DLVRG_AMOUNT = oneMantissa.mul(new BN(5));
const ETH_DLVRG_AMOUNT = oneMantissa.mul(new BN(5)).div(new BN(100));
const DLVRG_REFUND_NUM = new BN(13);
const DLVRG_REFUND_DEN = new BN(2);

let LP_AMOUNT;
let LP_TOKENS;
let ETH_IS_A;
const INITIAL_EXCHANGE_RATE = oneMantissa;
const MINIMUM_LIQUIDITY = new BN(1000);

contract("Deleverage02", function (accounts) {
  let root = accounts[0];
  let borrower = accounts[1];
  let lender = accounts[2];
  let liquidator = accounts[3];

  let uniswapV2Factory;
  let stackingSalmonPriceOracle;
  let stackingSalmonFactory;
  let WETH;
  let UNI;
  let uniswapV2Pair;
  let collateral;
  let borrowableWETH;
  let borrowableUNI;
  let router;

  beforeEach(async () => {
    uniswapV2Factory = await UniswapV2Factory.new(address(0));
    stackingSalmonPriceOracle = await StackingSalmonPriceOracle.new();
    const bDeployer = await BDeployer.new();
    const cDeployer = await CDeployer.new();
    stackingSalmonFactory = await Factory.new(
      address(0),
      address(0),
      bDeployer.address,
      cDeployer.address,
      stackingSalmonPriceOracle.address
    );
    WETH = await WETH9.new();
    UNI = await MockERC20.new("Uniswap", "UNI");
    const uniswapV2PairAddress = await uniswapV2Factory.createPair.call(
      WETH.address,
      UNI.address
    );
    await uniswapV2Factory.createPair(WETH.address, UNI.address);
    uniswapV2Pair = await UniswapV2Pair.at(uniswapV2PairAddress);
    await UNI.mint(borrower, UNI_LP_AMOUNT);
    await UNI.mint(lender, UNI_LEND_AMOUNT);
    await WETH.deposit({ value: ETH_LP_AMOUNT, from: borrower });
    await UNI.transfer(uniswapV2PairAddress, UNI_LP_AMOUNT, { from: borrower });
    await WETH.transfer(uniswapV2PairAddress, ETH_LP_AMOUNT, {
      from: borrower,
    });
    await uniswapV2Pair.mint(borrower);
    LP_AMOUNT = await uniswapV2Pair.balanceOf(borrower);
    await stackingSalmonPriceOracle.initialize(uniswapV2PairAddress);
    collateralAddress = await stackingSalmonFactory.createCollateral.call(
      uniswapV2PairAddress
    );
    borrowable0Address = await stackingSalmonFactory.createBorrowable0.call(
      uniswapV2PairAddress
    );
    borrowable1Address = await stackingSalmonFactory.createBorrowable1.call(
      uniswapV2PairAddress
    );
    await stackingSalmonFactory.createCollateral(uniswapV2PairAddress);
    await stackingSalmonFactory.createBorrowable0(uniswapV2PairAddress);
    await stackingSalmonFactory.createBorrowable1(uniswapV2PairAddress);
    await stackingSalmonFactory.initializeLendingPool(uniswapV2PairAddress);
    collateral = await Collateral.at(collateralAddress);
    const borrowable0 = await Borrowable.at(borrowable0Address);
    const borrowable1 = await Borrowable.at(borrowable1Address);
    ETH_IS_A = (await borrowable0.underlying()) == WETH.address;
    if (ETH_IS_A) [borrowableWETH, borrowableUNI] = [borrowable0, borrowable1];
    else [borrowableWETH, borrowableUNI] = [borrowable1, borrowable0];
    router = await Router02.new(
      stackingSalmonFactory.address,
      bDeployer.address,
      cDeployer.address,
      WETH.address
    );
    await increaseTime(3700); // wait for oracle to be ready
    await permitGenerator.initialize();

    //Mint UNI
    await UNI.approve(router.address, UNI_LEND_AMOUNT, { from: lender });
    await router.mint(
      borrowableUNI.address,
      UNI_LEND_AMOUNT,
      lender,
      DEADLINE,
      { from: lender }
    );
    //Mint ETH
    await router.mintETH(borrowableWETH.address, lender, DEADLINE, {
      value: ETH_LEND_AMOUNT,
      from: lender,
    });
    //Mint LP
    const permitData = await permitGenerator.permit(
      uniswapV2Pair,
      borrower,
      router.address,
      LP_AMOUNT,
      DEADLINE
    );
    LP_TOKENS = await router.mintCollateral.call(
      collateral.address,
      LP_AMOUNT,
      borrower,
      DEADLINE,
      permitData,
      { from: borrower }
    );
    await router.mintCollateral(
      collateral.address,
      LP_AMOUNT,
      borrower,
      DEADLINE,
      permitData,
      { from: borrower }
    );
    //Leverage
    const permitBorrowUNI = await permitGenerator.borrowPermit(
      borrowableUNI,
      borrower,
      router.address,
      UNI_LEVERAGE_AMOUNT,
      DEADLINE
    );
    const permitBorrowETH = await permitGenerator.borrowPermit(
      borrowableWETH,
      borrower,
      router.address,
      ETH_LEVERAGE_AMOUNT,
      DEADLINE
    );
    await leverage(
      router,
      uniswapV2Pair,
      borrower,
      ETH_LEVERAGE_AMOUNT,
      UNI_LEVERAGE_AMOUNT,
      "0",
      "0",
      permitBorrowETH,
      permitBorrowUNI,
      ETH_IS_A
    );
  });

  it("deleverage", async () => {
    const LP_DLVRG_TOKENS = DLVRG.mul(LP_TOKENS);
    const ETH_DLVRG_MIN = ETH_DLVRG_AMOUNT.mul(new BN(9999)).div(new BN(10000));
    const ETH_DLVRG_HIGH = ETH_DLVRG_AMOUNT.mul(new BN(10001)).div(
      new BN(10000)
    );
    const UNI_DLVRG_MIN = UNI_DLVRG_AMOUNT.mul(new BN(9999)).div(new BN(10000));
    const UNI_DLVRG_HIGH = UNI_DLVRG_AMOUNT.mul(new BN(10001)).div(
      new BN(10000)
    );
    await expectRevert(
      deleverage(
        router,
        uniswapV2Pair,
        borrower,
        LP_DLVRG_TOKENS,
        ETH_DLVRG_MIN,
        UNI_DLVRG_MIN,
        "0x",
        ETH_IS_A
      ),
      "Stacking Salmon: TRANSFER_NOT_ALLOWED"
    );
    const permit = await permitGenerator.permit(
      collateral,
      borrower,
      router.address,
      LP_DLVRG_TOKENS,
      DEADLINE
    );
    await expectRevert(
      deleverage(
        router,
        uniswapV2Pair,
        borrower,
        "0",
        ETH_DLVRG_MIN,
        UNI_DLVRG_MIN,
        permit,
        ETH_IS_A
      ),
      "StackingSalmonRouter: REDEEM_ZERO"
    );
    await expectRevert(
      deleverage(
        router,
        uniswapV2Pair,
        borrower,
        LP_DLVRG_TOKENS,
        ETH_DLVRG_HIGH,
        UNI_DLVRG_MIN,
        permit,
        ETH_IS_A
      ),
      ETH_IS_A
        ? "StackingSalmonRouter: INSUFFICIENT_A_AMOUNT"
        : "StackingSalmonRouter: INSUFFICIENT_B_AMOUNT"
    );
    await expectRevert(
      deleverage(
        router,
        uniswapV2Pair,
        borrower,
        LP_DLVRG_TOKENS,
        ETH_DLVRG_MIN,
        UNI_DLVRG_HIGH,
        permit,
        ETH_IS_A
      ),
      ETH_IS_A
        ? "StackingSalmonRouter: INSUFFICIENT_B_AMOUNT"
        : "StackingSalmonRouter: INSUFFICIENT_A_AMOUNT"
    );

    const balancePrior = await collateral.balanceOf(borrower);
    const borrowBalanceUNIPrior = await borrowableUNI.borrowBalance(borrower);
    const borrowBalanceETHPrior = await borrowableWETH.borrowBalance(borrower);
    const receipt = await deleverage(
      router,
      uniswapV2Pair,
      borrower,
      LP_DLVRG_TOKENS,
      ETH_DLVRG_MIN,
      UNI_DLVRG_MIN,
      permit,
      ETH_IS_A
    );
    const balanceAfter = await collateral.balanceOf(borrower);
    const borrowBalanceUNIAfter = await borrowableUNI.borrowBalance(borrower);
    const borrowBalanceETHAfter = await borrowableWETH.borrowBalance(borrower);
    //console.log(balancePrior / 1e18, balanceAfter / 1e18);
    //console.log(borrowBalanceUNIPrior / 1e18, borrowBalanceUNIAfter / 1e18);
    //console.log(borrowBalanceETHPrior / 1e18, borrowBalanceETHAfter / 1e18);
    //console.log(receipt.receipt.gasUsed);
    expectAlmostEqualMantissa(balancePrior.sub(balanceAfter), LP_DLVRG_TOKENS);
    expectAlmostEqualMantissa(
      borrowBalanceUNIPrior.sub(borrowBalanceUNIAfter),
      UNI_DLVRG_AMOUNT
    );
    expectAlmostEqualMantissa(
      borrowBalanceETHPrior.sub(borrowBalanceETHAfter),
      ETH_DLVRG_AMOUNT
    );
  });

  it("deleverage with refund UNI", async () => {
    const LP_DLVRG_TOKENS =
      DLVRG_REFUND_NUM.mul(LP_TOKENS).div(DLVRG_REFUND_DEN);
    const permit = await permitGenerator.permit(
      collateral,
      borrower,
      router.address,
      LP_DLVRG_TOKENS,
      DEADLINE
    );

    const ETHBalancePrior = await web3.eth.getBalance(borrower);
    const UNIBalancePrior = await UNI.balanceOf(borrower);
    const receipt = await deleverage(
      router,
      uniswapV2Pair,
      borrower,
      LP_DLVRG_TOKENS,
      "0",
      "0",
      permit,
      ETH_IS_A
    );
    const ETHBalanceAfter = await web3.eth.getBalance(borrower);
    const UNIBalanceAfter = await UNI.balanceOf(borrower);
    expect((await borrowableWETH.borrowBalance(borrower)) * 1).to.eq(0);
    expect((await borrowableUNI.borrowBalance(borrower)) * 1).to.eq(0);
    expect(ETHBalanceAfter - ETHBalancePrior).to.gt(0);
    expect(UNIBalanceAfter.sub(UNIBalancePrior) * 1).to.gt(0);
  });
});
