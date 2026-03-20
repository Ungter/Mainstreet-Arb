import { ethers } from 'ethers';
import { BlockchainService } from './BlockchainService';
import { PermissionlessMainstreetMinter } from '../interfaces/PermissionlessMainstreetMinter';
import { SiloVault } from '../interfaces/SiloVault';
import { BalancerSwapService } from './BalancerSwapService';
import { SimulationResult, MintParams, SwapParams, RedeemParams, BotConfig } from '../types';

export class TransactionSimulationService {
  private blockchainService: BlockchainService;
  private minterContract: PermissionlessMainstreetMinter;
  private vaultContract: SiloVault;
  private smsUsdVault: SiloVault;
  private config: BotConfig;
  private swapService: BalancerSwapService;

  constructor(blockchainService: BlockchainService, config: BotConfig) {
    this.blockchainService = blockchainService;
    this.config = config;
    
    // Initialize contracts
    this.minterContract = new PermissionlessMainstreetMinter(
      config.minterAddress,
      blockchainService.getSigner()
    );
    
    this.vaultContract = new SiloVault(
      config.vaultAddress,
      blockchainService.getSigner()
    );
    // smsUSD is an ERC4626 over msUSD; reuse SiloVault wrapper for ERC4626 methods
    this.smsUsdVault = new SiloVault(
      config.smsusdAddress,
      blockchainService.getSigner()
    );
    
    this.swapService = new BalancerSwapService(config);
  }

  async simulateFullArbitrageCycle(
    usdcAmount: bigint
  ): Promise<SimulationResult> {
    try {
      console.log('Starting arbitrage simulation...');
      
      // Step 1: Simulate minting msUSD using USDC
      const mintResult = await this.simulateMint({
        asset: this.config.usdcAddress,
        amountIn: usdcAmount,
        minAmountOut: 0n // Will calculate based on slippage
      });
      
      if (!mintResult.success) {
        return { success: false, error: `Mint simulation failed: ${mintResult.error}` };
      }
      
      const msusdAmount = mintResult.amountOut!;
      console.log(`Mint simulation: ${usdcAmount} USDC -> ${msusdAmount} msUSD`);

      // Step 2: Simulate staking msUSD into smsUSD (ERC4626 deposit)
      const stakeResult = await this.simulateStakeMsusd(msusdAmount);
      if (!stakeResult.success) {
        return { success: false, error: `Stake simulation failed: ${stakeResult.error}` };
      }
      const smsusdShares = stakeResult.amountOut!;
      console.log(`Stake simulation: ${msusdAmount} msUSD -> ${smsusdShares} smsUSD shares`);
      
      // Step 3: Simulate swapping smsUSD to ghUSDC
      const swapResult = await this.simulateSwap({
        tokenIn: this.config.smsusdAddress,
        tokenOut: this.config.ghusdcAddress,
        amountIn: smsusdShares,
        minAmountOut: 0n, // Will calculate based on slippage
        poolAddress: this.config.poolAddress
      });
      
      if (!swapResult.success) {
        return { success: false, error: `Swap simulation failed: ${swapResult.error}` };
      }
      
      const ghusdcAmount = swapResult.amountOut!;
      console.log(`Swap simulation: ${smsusdShares} smsUSD -> ${ghusdcAmount} ghUSDC`);
      
      // Step 4: Simulate redeeming ghUSDC for USDC
      const redeemResult = await this.simulateRedeem({
        vaultAddress: this.config.vaultAddress,
        amount: ghusdcAmount,
        receiver: await this.blockchainService.getAddress()
      });
      
      if (!redeemResult.success) {
        return { success: false, error: `Redeem simulation failed: ${redeemResult.error}` };
      }
      
      const finalUsdcAmount = redeemResult.amountOut!;
      console.log(`Redeem simulation: ${ghusdcAmount} ghUSDC -> ${finalUsdcAmount} USDC`);
      
      // Calculate profit and costs
      const profit = finalUsdcAmount - usdcAmount;
      const totalGasEstimate = mintResult.gasUsed! + stakeResult.gasUsed! + swapResult.gasUsed! + redeemResult.gasUsed!;
      const gasPriceWei = await this.blockchainService.getGasPrice();
      const gasCostWei = gasPriceWei.mul(ethers.BigNumber.from(totalGasEstimate)).toBigInt();
      const priceScale = BigInt(Math.round(this.config.gasTokenPrice * 100_000_000)); // 1e8 precision
      const gasCostUsdcMinor = (gasCostWei * priceScale * 1_000_000n) / (10n ** 18n * 100_000_000n);

      const netProfit = profit - gasCostUsdcMinor;

      console.log(`Simulation results:`);
      console.log(`  Input USDC (units): ${usdcAmount}`);
      console.log(`  Output USDC (units): ${finalUsdcAmount}`);
      console.log(`  Gross Profit (USDC units): ${profit}`);
      console.log(`  Gas Cost (wei): ${gasCostWei.toString()}`);
      console.log(`  Gas Cost (USDC units): ${gasCostUsdcMinor}`);
      console.log(`  Net Profit (USDC units): ${netProfit}`);

      return {
        success: true,
        profit,
        gasCost: gasCostUsdcMinor,
        netProfit
      };
      
    } catch (error) {
      console.error('Arbitrage simulation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async simulateMint(params: MintParams): Promise<SimulationResult & {
    amountOut?: bigint;
    gasUsed?: number;
  }> {
    try {
      // Get current USDC balance
      const walletAddress = await this.blockchainService.getAddress();
      const usdcBalance = await this.blockchainService.getTokenBalance(params.asset, walletAddress);
      
      if (usdcBalance.lt(ethers.BigNumber.from(params.amountIn.toString()))) {
        return { success: false, error: 'Insufficient USDC balance for mint' };
      }
      
      // Estimate gas for mint operation
      const mintTransaction = {
        to: this.config.minterAddress,
        data: this.minterContract.getContract().interface.encodeFunctionData(
          'mint',
          [params.asset, params.amountIn.toString(), params.minAmountOut.toString()]
        ),
        from: walletAddress
      };
      
      let gasUsed: number;
      try {
        const gasEstimate = await this.blockchainService.estimateGas(mintTransaction);
        gasUsed = gasEstimate.toNumber();
      } catch (e) {
        // If allowance is missing, gas estimation will revert. Simulate with conservative defaults.
        const allowance = await this.blockchainService.checkAllowance(
          this.config.usdcAddress,
          walletAddress,
          this.config.minterAddress
        );
        const approveGas = allowance.gt(0) ? 0 : 50000; // rough approval cost
        const mintGas = 200000; // rough mint cost
        gasUsed = approveGas + mintGas;
      }
      
      // Simulate mint by estimating units conversion from USDC (likely 6 dec) -> msUSD (18 dec)
      const [decUsdc, decMsusd] = await Promise.all([
        this.blockchainService.getTokenDecimals(this.config.usdcAddress),
        this.blockchainService.getTokenDecimals(this.config.msusdAddress)
      ]);
      const expectedAmountOut =
        decMsusd >= decUsdc
          ? params.amountIn * (10n ** BigInt(decMsusd - decUsdc))
          : params.amountIn / (10n ** BigInt(decUsdc - decMsusd));
      
      return {
        success: true,
        amountOut: expectedAmountOut,
        gasUsed
      };
      
    } catch (error) {
      console.error('Mint simulation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async simulateStakeMsusd(amountMsusd: bigint): Promise<SimulationResult & {
    amountOut?: bigint; // smsUSD shares
    gasUsed?: number;
  }> {
    try {
      const walletAddress = await this.blockchainService.getAddress();
      // previewDeposit to get expected smsUSD shares
      const previewShares = await this.smsUsdVault.previewDeposit(amountMsusd.toString());

      // Build deposit tx for gas estimation
      const tx = {
        to: (this.smsUsdVault as any).getContract().address,
        data: this.smsUsdVault.getContract().interface.encodeFunctionData(
          'deposit',
          [amountMsusd.toString(), walletAddress]
        ),
        from: walletAddress
      };

      let gasUsed: number;
      try {
        const gasEstimate = await this.blockchainService.estimateGas(tx);
        gasUsed = gasEstimate.toNumber();
      } catch (e) {
        // If allowance missing or vault reverts on estimate, approximate gas conservatively.
        const allowance = await this.blockchainService.checkAllowance(
          this.config.msusdAddress,
          walletAddress,
          (this.smsUsdVault as any).getContract().address
        );
        const approveGas = allowance.gt(0) ? 0 : 50000; // approval rough cost
        const depositGas = 150000; // deposit rough cost
        gasUsed = approveGas + depositGas;
      }

      return {
        success: true,
        amountOut: previewShares.toBigInt(),
        gasUsed
      };
    } catch (error) {
      console.error('Stake (deposit msUSD -> smsUSD) simulation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async simulateSwap(params: SwapParams): Promise<SimulationResult & {
    amountOut?: bigint;
    gasUsed?: number;
  }> {
    try {
      const walletAddress = await this.blockchainService.getAddress();
      const [decIn, decOut] = await Promise.all([
        this.blockchainService.getTokenDecimals(params.tokenIn),
        this.blockchainService.getTokenDecimals(params.tokenOut)
      ]);

      const built = await this.swapService.buildExactInCustomPath(
        { address: params.tokenIn, decimals: decIn },
        { address: params.tokenOut, decimals: decOut },
        BigInt(params.amountIn.toString()),
        this.config.slippageTolerance,
        params.poolAddress
      );

      const tx = {
        to: built.to,
        data: built.callData,
        value: built.value,
        from: walletAddress
      };
      
      let gasUsed: number;
      try {
        const gasEstimate = await this.blockchainService.estimateGas(tx);
        gasUsed = gasEstimate.toNumber();
      } catch (e) {
        // If allowance is missing or router reverts on estimation, approximate gas conservatively.
        const allowance = await this.blockchainService.checkAllowance(
          params.tokenIn,
          walletAddress,
          built.to
        );
        const approveGas = allowance.gt(0) ? 0 : 700000; // approval rough cost
        const swapGas = 2200000; // swap rough cost for V3 router
        gasUsed = approveGas + swapGas;
      }
      
      return {
        success: true,
        amountOut: built.expectedAmountOut,
        gasUsed
      };
      
    } catch (error) {
      console.error('Swap simulation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async simulateRedeem(params: RedeemParams): Promise<SimulationResult & {
    amountOut?: bigint;
    gasUsed?: number;
  }> {
    try {

      const previewAmountOut = await this.vaultContract.convertToAssets(params.amount.toString());
      let expectedAssets = previewAmountOut.toBigInt();

      // If still zero, treat as dust
      if (expectedAssets === 0n) {
        return { success: false, error: 'Redeem preview is zero after fallback estimation (dust). Increase trade size.' };
      }
      
      // Estimate gas for redeem operation
      const walletAddress = await this.blockchainService.getAddress();
      const redeemTransaction = {
        to: this.config.vaultAddress,
        data: this.vaultContract.getContract().interface.encodeFunctionData(
          'redeem',
          [params.amount.toString(), params.receiver, walletAddress]
        ),
        from: walletAddress
      };
      
      let gasUsed: number;
      try {
        const gasEstimate = await this.blockchainService.estimateGas(redeemTransaction);
        gasUsed = gasEstimate.toNumber();
      } catch (e) {
        gasUsed = 2200000;
      }
      
      return {
        success: true,
        amountOut: expectedAssets,
        gasUsed
      };
      
    } catch (error) {
      console.error('Redeem simulation failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async checkTokenAllowances(): Promise<{
    usdcAllowed: boolean;
    msusdAllowed: boolean;
    ghusdcAllowed: boolean;
  }> {
    const walletAddress = await this.blockchainService.getAddress();
    
    const [usdcAllowance, smsusdAllowance] = await Promise.all([
      this.blockchainService.checkAllowance(this.config.usdcAddress, walletAddress, this.config.minterAddress),
      this.blockchainService.checkAllowance(this.config.smsusdAddress, walletAddress, this.config.balancerVaultAddress)
    ]);
    
    return {
      usdcAllowed: usdcAllowance.gt(0),
      msusdAllowed: smsusdAllowance.gt(0),
      ghusdcAllowed: true
    };
  }

  async estimateOptimalAmount(): Promise<bigint> {
    try {
      const defaultAmount = ethers.utils.parseUnits('100', 6).toBigInt(); 
      return defaultAmount;
    } catch (error) {
      console.error('Error estimating optimal amount:', error);
      return BigInt(100_000_000); 
    }
  }

  async getSimulationSummary(
    usdcAmount?: bigint
  ): Promise<{
    optimalAmount: bigint;
    allowances: { usdcAllowed: boolean; msusdAllowed: boolean; ghusdcAllowed: boolean };
    simulation: SimulationResult | null;
  }> {
    const optimalAmount = usdcAmount || await this.estimateOptimalAmount();
    const allowances = await this.checkTokenAllowances();
    const simulation = await this.simulateFullArbitrageCycle(optimalAmount);
    
    return {
      optimalAmount,
      allowances,
      simulation
    };
  }
}