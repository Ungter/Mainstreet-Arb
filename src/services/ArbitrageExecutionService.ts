import { ethers } from 'ethers';
import { BlockchainService } from './BlockchainService';
import { TransactionSimulationService } from './TransactionSimulationService';
import { PermissionlessMainstreetMinter } from '../interfaces/PermissionlessMainstreetMinter';
import { SiloVault } from '../interfaces/SiloVault';
import { BalancerSwapService } from './BalancerSwapService';
import { Permit2, PermitSingle } from '../interfaces/Permit2';

import { 
  MintParams, 
  SwapParams, 
  RedeemParams, 
  BotConfig, 
  ArbitrageOpportunity 
} from '../types';

export interface ExecutionResult {
  success: boolean;
  transactionHash?: string;
  profit?: bigint;
  gasCost?: bigint;
  netProfit?: bigint;
  error?: string;
  executionTime: number;
  steps: {
    mint: { success: boolean; hash?: string; error?: string; gasUsed?: number };
    swap: { success: boolean; hash?: string; error?: string; gasUsed?: number };
    redeem: { success: boolean; hash?: string; error?: string; gasUsed?: number };
  };
}

export class ArbitrageExecutionService {
  private blockchainService: BlockchainService;
  private simulationService: TransactionSimulationService;
  private minterContract: PermissionlessMainstreetMinter;
  private vaultContract: SiloVault;
  private smsUsdVault: SiloVault;
  private swapService: BalancerSwapService;
  private config: BotConfig;
  private isExecuting: boolean = false;
  private executionCount: number = 0;
  private successfulExecutions: number = 0;

  constructor(
    blockchainService: BlockchainService,
    simulationService: TransactionSimulationService,
    config: BotConfig
  ) {
    this.blockchainService = blockchainService;
    this.simulationService = simulationService;
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

    // smsUSD is ERC4626 over msUSD
    this.smsUsdVault = new SiloVault(
      config.smsusdAddress,
      blockchainService.getSigner()
    );
    this.swapService = new BalancerSwapService(config);
  }

  async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    usdcAmount?: bigint
  ): Promise<ExecutionResult> {
    if (this.isExecuting) {
      return {
        success: false,
        error: 'Already executing an arbitrage operation',
        executionTime: 0,
        steps: { mint: { success: false }, swap: { success: false }, redeem: { success: false } }
      };
    }

    this.isExecuting = true;
    const startTime = Date.now();
    this.executionCount++;

    try {
      console.log('Starting arbitrage execution...');
      console.log('Opportunity:', opportunity);

      // Determine amount to use
      const amountToUse = usdcAmount || await this.simulationService.estimateOptimalAmount();
      console.log(`Using amount: ${amountToUse} USDC`);

      // Pre-execution checks
      const preCheckResult = await this.performPreExecutionChecks(amountToUse);
      if (!preCheckResult.success) {
        return {
          success: false,
          error: preCheckResult.error,
          executionTime: Date.now() - startTime,
          steps: { mint: { success: false }, swap: { success: false }, redeem: { success: false } }
        };
      }

      // Execute the arbitrage sequence
      const executionResult = await this.executeArbitrageSequence(amountToUse);
      
      const executionTime = Date.now() - startTime;
      
      if (executionResult.success) {
        this.successfulExecutions++;
        console.log(`Arbitrage executed successfully in ${executionTime}ms`);
      } else {
        console.log(`Arbitrage failed after ${executionTime}ms: ${executionResult.error}`);
      }

      return {
        ...executionResult,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error('Arbitrage execution failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
        steps: { mint: { success: false }, swap: { success: false }, redeem: { success: false } }
      };
    } finally {
      this.isExecuting = false;
    }
  }

  private async performPreExecutionChecks(amountToUse: bigint): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if amount meets minimum threshold
      if (amountToUse < ethers.utils.parseUnits('10', 6).toBigInt()) {
        return { success: false, error: 'Amount below minimum threshold of 10 USDC' };
      }

      // Check gas price
      const gasPrice = await this.blockchainService.getGasPrice();
      if (gasPrice.gt(ethers.BigNumber.from(this.config.maxGasPrice.toString()))) {
        return { success: false, error: 'Gas price too high' };
      }

      // Check token balances
      const walletAddress = await this.blockchainService.getAddress();
      const usdcBalance = await this.blockchainService.getTokenBalance(this.config.usdcAddress, walletAddress);
      
      if (usdcBalance.lt(ethers.BigNumber.from(amountToUse.toString()))) {
        return { success: false, error: 'Insufficient USDC balance' };
      }

      // Ensure token allowances (auto-approve if needed)
      await this.ensureAllowances(amountToUse);
      const allowances = await this.simulationService.checkTokenAllowances();
      if (!allowances.usdcAllowed || !allowances.msusdAllowed) {
        return { success: false, error: 'Failed to set token allowances' };
      }

      // Check contract health
      const [minterHealthy, vaultHealthy, poolHealthy] = await Promise.all([
        this.checkContractHealth(this.config.minterAddress),
        this.checkContractHealth(this.config.vaultAddress),
        this.checkContractHealth(this.config.poolAddress)
      ]);

      if (!minterHealthy) {
        return { success: false, error: 'Minter contract not healthy' };
      }
      
      if (!vaultHealthy) {
        return { success: false, error: 'Vault contract not healthy' };
      }
      
      if (!poolHealthy) {
        return { success: false, error: 'Pool contract not healthy' };
      }

      return { success: true };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Pre-execution check failed' 
      };
    }
  }

  private async executeArbitrageSequence(
    amountToUse: bigint
  ): Promise<Omit<ExecutionResult, 'executionTime'>> {
    const steps: ExecutionResult['steps'] = {
      mint: { success: false },
      swap: { success: false },
      redeem: { success: false }
    };

    try {
      // Step 1: Mint msUSD using USDC
      console.log('Step 1: Minting msUSD...');
      const mintResult = await this.executeMint({
        asset: this.config.usdcAddress,
        amountIn: amountToUse,
        minAmountOut: 0n
      });

      steps.mint = { success: mintResult.success, hash: mintResult.hash, error: mintResult.error, gasUsed: mintResult.gasUsed ?? 0 };
      if (!mintResult.success) {
        return {
          success: false,
          error: `Mint failed: ${mintResult.error}`,
          steps
        };
      }

      const msusdAmount = mintResult.amountOut!;
      console.log(`Mint successful: ${amountToUse} USDC -> ${msusdAmount} msUSD`);

      // Step 2: Stake msUSD into smsUSD (ERC4626 deposit)
      console.log('Step 2: Staking msUSD into smsUSD...');
      const stakeResult = await this.executeStake(msusdAmount);
      if (!stakeResult.success) {
        return {
          success: false,
          error: `Stake failed: ${stakeResult.error}`,
          steps
        };
      }
      const smsusdShares = stakeResult.amountOut!;
      // Record stake gas into "mint" step to keep shape unchanged
      steps.mint.gasUsed = (steps.mint.gasUsed || 0) + (stakeResult.gasUsed || 0);
      console.log(`Stake successful: ${msusdAmount} msUSD -> ${smsusdShares} smsUSD`);

      // Step 3: Swap smsUSD to ghUSDC
      console.log('Step 3: Swapping smsUSD to ghUSDC...');
      const swapResult = await this.executeSwap({
        tokenIn: this.config.smsusdAddress,
        tokenOut: this.config.ghusdcAddress,
        amountIn: smsusdShares,
        minAmountOut: 0n,
        poolAddress: this.config.poolAddress
      });

      steps.swap = { success: swapResult.success, hash: swapResult.hash, error: swapResult.error, gasUsed: swapResult.gasUsed ?? 0 };
      if (!swapResult.success) {
        return {
          success: false,
          error: `Swap failed: ${swapResult.error}`,
          steps
        };
      }

      const ghusdcExpected = swapResult.amountOut!;
      const walletAfterSwap = await this.blockchainService.getAddress();
      const ghusdcBalanceBn = await this.blockchainService.getTokenBalance(this.config.ghusdcAddress, walletAfterSwap);
      const ghusdcAmount = ghusdcBalanceBn.toBigInt();
      console.log(`Swap successful: ${smsusdShares} smsUSD -> expected ${ghusdcExpected} ghUSDC, actual balance ${ghusdcAmount} ghUSDC`);

      // Step 4: Redeem ghUSDC for USDC
      console.log('Step 4: Redeeming ghUSDC for USDC...');
      const redeemResult = await this.executeRedeem({
        vaultAddress: this.config.vaultAddress,
        amount: ghusdcAmount,
        receiver: await this.blockchainService.getAddress()
      });

      steps.redeem = { success: redeemResult.success, hash: redeemResult.hash, error: redeemResult.error, gasUsed: redeemResult.gasUsed ?? 0 };
      if (!redeemResult.success) {
        return {
          success: false,
          error: `Redeem failed: ${redeemResult.error}`,
          steps
        };
      }

      const usdcBalanceBn = await this.blockchainService.getTokenBalance(this.config.usdcAddress, await this.blockchainService.getAddress());
      const finalUsdcAmount = usdcBalanceBn.toBigInt();
      console.log(`Redeem successful: ${ghusdcAmount} ghUSDC -> ${finalUsdcAmount} USDC (raw minor units)`);

      // Calculate profit based on wallet USDC balance and 6-decimal units
      const profit = finalUsdcAmount - amountToUse;
      const totalGasEstimate = (steps.mint.gasUsed || 0) + (steps.swap.gasUsed || 0) + (steps.redeem.gasUsed || 0);
      const gasPriceWei = await this.blockchainService.getGasPrice();
      const gasCostWei = gasPriceWei.mul(ethers.BigNumber.from(totalGasEstimate)).toBigInt();

      // Convert gas to USDC minor units using gas token USD price (fixed-point 1e8)
      const priceScale = BigInt(Math.round(this.config.gasTokenPrice * 100_000_000)); // 1e8 precision
      const gasCostUsdcMinor = (gasCostWei * priceScale * 1_000_000n) / (10n ** 18n * 100_000_000n);

      const netProfit = profit - gasCostUsdcMinor;

      // Helper to format 6-decimal USDC values for logs
      const format6 = (x: bigint) => {
        const sign = x < 0n ? '-' : '';
        const abs = x < 0n ? -x : x;
        const whole = abs / 1_000_000n;
        const frac = abs % 1_000_000n;
        return `${sign}${whole}.${frac.toString().padStart(6, '0')}`;
      };

      console.log(`Arbitrage results (USDC in 6 decimals):`);
      console.log(`  Input (USDC): ${format6(amountToUse)}`);
      console.log(`  Output (USDC): ${format6(finalUsdcAmount)}`);
      console.log(`  Gross Profit (USDC): ${format6(profit)}`);
      console.log(`  Gas Cost (wei): ${gasCostWei.toString()}`);
      console.log(`  Gas Cost (USDC): ${format6(gasCostUsdcMinor)}`);
      console.log(`  Net Profit (USDC): ${format6(netProfit)}`);

      return {
        success: true,
        profit,
        gasCost: gasCostUsdcMinor,
        netProfit,
        steps
      };

    } catch (error) {
      console.error('Arbitrage sequence execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Sequence execution failed',
        steps
      };
    }
  }

  private async executeMint(params: MintParams): Promise<{
    success: boolean;
    amountOut?: bigint;
    gasUsed?: number;
    hash?: string;
    error?: string;
  }> {
    try {
      const walletAddress = await this.blockchainService.getAddress();
      
      // Build transaction
      const transaction = {
        to: this.config.minterAddress,
        data: this.minterContract.getContract().interface.encodeFunctionData(
          'mint',
          [params.asset, params.amountIn.toString(), params.minAmountOut.toString()]
        ),
        from: walletAddress
      };

      
      // Execute transaction
      const txResponse = await this.blockchainService.sendTransaction({
        ...transaction,
        gasLimit: 8000000, // 4 milion, do NOT change
        gasPrice: (await this.blockchainService.getGasPrice()).toString()
      });

      console.log(`Mint transaction sent: ${txResponse.hash}`);

      // Wait for confirmation
      const receipt = await this.blockchainService.waitForTransaction(txResponse.hash, 1);
      
      if (receipt.status === 1) {
        // Scale USDC (likely 6 decimals) -> msUSD (18 decimals) using on-chain decimals
        const [decUsdc, decMsusd] = await Promise.all([
          this.blockchainService.getTokenDecimals(this.config.usdcAddress),
          this.blockchainService.getTokenDecimals(this.config.msusdAddress)
        ]);
        const amountOut =
          decMsusd >= decUsdc
            ? params.amountIn * (10n ** BigInt(decMsusd - decUsdc))
            : params.amountIn / (10n ** BigInt(decUsdc - decMsusd));
        
        return {
          success: true,
          amountOut,
          gasUsed: receipt.gasUsed?.toNumber(),
          hash: txResponse.hash
        };
      } else {
        return {
          success: false,
          error: 'Mint transaction failed',
          hash: txResponse.hash
        };
      }

    } catch (error) {
      console.error('Mint execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Mint execution failed'
      };
    }
  }

  private async executeStake(msusdAmount: bigint): Promise<{
    success: boolean;
    amountOut?: bigint; // smsUSD shares
    gasUsed?: number;
    hash?: string;
    error?: string;
  }> {
    try {
      const walletAddress = await this.blockchainService.getAddress();

      // Ensure msUSD approval to smsUSD vault for deposit
      const msusdAllowanceToVault = await this.blockchainService.checkAllowance(
        this.config.msusdAddress,
        walletAddress,
        (this.smsUsdVault as any).getContract().address
      );
      if (msusdAllowanceToVault.lt(ethers.BigNumber.from(msusdAmount.toString()))) {
        console.log('Approving msUSD for smsUSD vault...');
        const tx = await this.blockchainService.approveToken(
          this.config.msusdAddress,
          (this.smsUsdVault as any).getContract().address,
          ethers.constants.MaxUint256
        );
        await tx.wait(1);
      }

      // Preview shares and build deposit
      const previewShares = await this.smsUsdVault.previewDeposit(msusdAmount.toString());
      const transaction = {
        to: (this.smsUsdVault as any).getContract().address,
        data: this.smsUsdVault.getContract().interface.encodeFunctionData(
          'deposit',
          [msusdAmount.toString(), walletAddress]
        ),
        from: walletAddress
      };

      const gasEstimate = await this.blockchainService.estimateGas(transaction);
      const txResponse = await this.blockchainService.sendTransaction({
        ...transaction,
        gasLimit: gasEstimate.toNumber(),
        gasPrice: (await this.blockchainService.getGasPrice()).toString()
      });

      console.log(`Stake (deposit) transaction sent: ${txResponse.hash}`);
      const receipt = await this.blockchainService.waitForTransaction(txResponse.hash, 1);

      if (receipt.status === 1) {
        return {
          success: true,
          amountOut: previewShares.toBigInt(),
          gasUsed: receipt.gasUsed?.toNumber(),
          hash: txResponse.hash
        };
      } else {
        return { success: false, error: 'Stake transaction failed', hash: txResponse.hash };
      }
    } catch (error) {
      console.error('Stake execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stake execution failed'
      };
    }
  }

  private async executeSwap(params: SwapParams): Promise<{
    success: boolean;
    amountOut?: bigint;
    gasUsed?: number;
    hash?: string;
    error?: string;
  }> {
    try {
      const walletAddress = await this.blockchainService.getAddress();
      const [decIn, decOut] = await Promise.all([
        this.blockchainService.getTokenDecimals(params.tokenIn),
        this.blockchainService.getTokenDecimals(params.tokenOut)
      ]);
      console.log('Token decimals', { decIn, decOut });

      // Build Balancer V3 swap via custom single-hop path (force target pool)
      const built = await this.swapService.buildExactInCustomPath(
        { address: params.tokenIn, decimals: decIn },
        { address: params.tokenOut, decimals: decOut },
        BigInt(params.amountIn.toString()),
        this.config.slippageTolerance,
        params.poolAddress
      );

      console.log('Swap build summary:', {
        poolId: params.poolAddress,
        router: built.to,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        expectedAmountOut: built.expectedAmountOut.toString(),
        minAmountOut: built.minAmountOut.toString(),
        value: built.value
      });
      console.log('Swap amount digits:', {
        amountInDigits: params.amountIn.toString().length,
        expectedAmountOutDigits: built.expectedAmountOut.toString().length,
        minAmountOutDigits: built.minAmountOut.toString().length
      });

      // Compute minAmountOut in tokenOut units using expectedAmountOut and slippage
      const slippageBps = Math.floor(this.config.slippageTolerance * 10000); // 0.012, 10000 represents 100% amp
      const minAmountOut = (built.expectedAmountOut * BigInt(10000 - slippageBps)) / 10000n;
      console.log('Manual minAmountOut (tokenOut units):', minAmountOut.toString(), 'digits:', minAmountOut.toString().length);


      // Permit2 flow: authorize spender to pull smsUSD (tokenIn) via signature if needed
      try {
        const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
        const PERMIT2_SPENDER = built.to; // align spender with router that will receive the swap
        const permit2 = new Permit2(PERMIT2_ADDRESS, this.blockchainService.getSigner());
        const owner = walletAddress;
        const allowance = await permit2.readAllowance(owner, params.tokenIn, PERMIT2_SPENDER);
        const now = Math.floor(Date.now() / 1000);

        // Configure Permit2 like your working example:
        // - amount: MaxUint160 (effectively infinite)
        // - nonce: 0 always
        // - sigDeadline: MaxUint256
        // - expiration: far future (default 1 year)
        const MAX_UINT160 = (1n << 160n) - 1n;
        const MAX_UINT256 = (1n << 256n) - 1n;
        const expiration = now + 365 * 24 * 60 * 60; // ~1 year

        console.log('Permit2 pre-check:', {
          owner,
          token: params.tokenIn,
          spender: PERMIT2_SPENDER,
          currentAmount: allowance.amount.toString(),
          currentExpiration: allowance.expiration,
          currentNonce: allowance.nonce
        });

        // If Permit2 allowance is zero or expired, submit new infinite-amount permit
        if (allowance.amount === 0n || allowance.expiration <= now) {
          const permit: PermitSingle = {
            details: {
              token: params.tokenIn,
              amount: MAX_UINT160,
              expiration,
              nonce: 0
            },
            spender: PERMIT2_SPENDER,
            sigDeadline: MAX_UINT256
          };
          const signature = await permit2.signPermitSingle(
            this.blockchainService.getWallet(),
            this.config.chainId,
            PERMIT2_ADDRESS,
            permit
          );
          console.log('Submitting Permit2 (owner, details, spender, deadline)...');
          const permitTx = await permit2.submitPermit(owner, permit, signature);
          await permitTx.wait(1);
          console.log(`Permit2 set. Tx: ${permitTx.hash}`);
        }
      } catch (e) {
        console.warn('Permit2 flow failed or unavailable, proceeding without it:', e instanceof Error ? e.message : e);
      }

      // Just-in-time rebuild and preflight before sending
      const rebuilt = await this.swapService.buildExactInCustomPath(
        { address: params.tokenIn, decimals: decIn },
        { address: params.tokenOut, decimals: decOut },
        BigInt(params.amountIn.toString()),
        this.config.slippageTolerance,
        params.poolAddress
      );
      let finalBuilt = rebuilt;

      // Abort if updated expectedOut cannot satisfy the previous minAmountOut
      let needRetryJIT = false;
      if (rebuilt.expectedAmountOut < built.minAmountOut) {
        console.warn('JIT slippage check failed:', {
          prevMinOut: built.minAmountOut.toString(),
          newExpectedOut: rebuilt.expectedAmountOut.toString()
        });
        needRetryJIT = true;
      }
      if (needRetryJIT) {
        const retryBuilt = await this.swapService.buildExactInCustomPath(
          { address: params.tokenIn, decimals: decIn },
          { address: params.tokenOut, decimals: decOut },
          BigInt(params.amountIn.toString()),
          this.config.slippageTolerance,
          params.poolAddress
        );
        if (retryBuilt.expectedAmountOut < built.minAmountOut) {
          return {
            success: false,
            error: 'JIT slippage check failed after retry (pool moved unfavorably)'
          };
        }
        finalBuilt = retryBuilt;
      }

      // Preflight staticcall to catch reverts without paying gas (with one retry)
      try {
        await this.blockchainService.getProvider().call({
          to: finalBuilt.to,
          data: finalBuilt.callData,
          from: walletAddress,
          value: finalBuilt.value
        } as any);
      } catch (preErr) {
        console.warn('Preflight staticcall reverted, attempting immediate rebuild...', preErr);
        const retryBuilt2 = await this.swapService.buildExactInCustomPath(
          { address: params.tokenIn, decimals: decIn },
          { address: params.tokenOut, decimals: decOut },
          BigInt(params.amountIn.toString()),
          this.config.slippageTolerance,
          params.poolAddress
        );
        try {
          await this.blockchainService.getProvider().call({
            to: retryBuilt2.to,
            data: retryBuilt2.callData,
            from: walletAddress,
            value: retryBuilt2.value
          } as any);
          finalBuilt = retryBuilt2;
        } catch (preErr2) {
          console.error('Preflight staticcall reverted again after retry:', preErr2);
          return {
            success: false,
            error: 'Preflight staticcall reverted after retry'
          };
        }
      }

      // Send the swap transaction using the rebuilt call data
      const transaction = {
        to: finalBuilt.to,
        data: finalBuilt.callData,
        value: finalBuilt.value,
        from: walletAddress
      };

      let gasLimit: number;
      try {
        const gasEstimate = await this.blockchainService.estimateGas(transaction);
        gasLimit = gasEstimate.toNumber() ;
      } catch (e) {
        console.warn('Swap estimateGas failed, using fallback gas limit. Error:', e instanceof Error ? e.message : e);
        gasLimit = 2000000;
      }
      const txResponse = await this.blockchainService.sendTransaction({
        ...transaction,
        gasLimit,
        gasPrice: (await this.blockchainService.getGasPrice()).toString()
      });

      console.log(`Swap transaction sent: ${txResponse.hash}`);

      const receipt = await this.blockchainService.waitForTransaction(txResponse.hash, 1);
      if (receipt.status === 1) {
        return {
          success: true,
          amountOut: finalBuilt.expectedAmountOut,
          gasUsed: receipt.gasUsed?.toNumber(),
          hash: txResponse.hash
        };
      } else {
        return {
          success: false,
          error: 'Swap transaction failed',
          hash: txResponse.hash
        };
      }
    } catch (error) {
      console.error('Swap execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Swap execution failed'
      };
    }
  }

  private async executeRedeem(params: RedeemParams): Promise<{
    success: boolean;
    amountOut?: bigint;
    gasUsed?: number;
    hash?: string;
    error?: string;
  }> {
    try {
      const walletAddress = await this.blockchainService.getAddress();
      
      // Build transaction
      const transaction = {
        to: this.config.vaultAddress,
        data: this.vaultContract.getContract().interface.encodeFunctionData(
          'redeem',
          [params.amount.toString(), walletAddress, walletAddress]
        ),
        from: walletAddress
      };

      let gasEstimate = await this.blockchainService.estimateGas(transaction);

      const txResponse = await this.blockchainService.sendTransaction({
        ...transaction,
        gasLimit: gasEstimate.toNumber() * 1.5,
        gasPrice: (await this.blockchainService.getGasPrice()).toString()
      });

      console.log(`Redeem transaction sent: ${txResponse.hash}`);

      // Wait for confirmation
      const receipt = await this.blockchainService.waitForTransaction(txResponse.hash, 1);
      
      if (receipt.status === 1) {
        // Simplified: output equal to shares converted; preview was done in simulation
        const amountOut = params.amount;
        
        return {
          success: true,
          amountOut,
          gasUsed: receipt.gasUsed?.toNumber(),
          hash: txResponse.hash
        };
      } else {
        return {
          success: false,
          error: 'Redeem transaction failed',
          hash: txResponse.hash
        };
      }

    } catch (error) {
      console.error('Redeem execution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Redeem execution failed'
      };
    }
  }

  private async checkContractHealth(contractAddress: string): Promise<boolean> {
    try {
      const code = await this.blockchainService.getProvider().getCode(contractAddress);
      return code !== '0x' && code.length > 2;
    } catch (error) {
      console.error(`Contract health check failed for ${contractAddress}:`, error);
      return false;
    }
  }

  isCurrentlyExecuting(): boolean {
    return this.isExecuting;
  }

  getExecutionStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    successRate: number;
  } {
    const successRate = this.executionCount > 0 ? (this.successfulExecutions / this.executionCount) * 100 : 0;
    
    return {
      totalExecutions: this.executionCount,
      successfulExecutions: this.successfulExecutions,
      successRate
    };
  }

  private async ensureAllowances(amountToUse: bigint): Promise<void> {
    const walletAddress = await this.blockchainService.getAddress();

    // USDC -> Minter
    const usdcAllowance = await this.blockchainService.checkAllowance(
      this.config.usdcAddress,
      walletAddress,
      this.config.minterAddress
    );
    if (usdcAllowance.lt(ethers.BigNumber.from(amountToUse.toString()))) {
      console.log('Approving USDC for minter...');
      const tx = await this.blockchainService.approveToken(
        this.config.usdcAddress,
        this.config.minterAddress,
        ethers.constants.MaxUint256
      );
      await tx.wait(1);
    }

    // msUSD -> smsUSD vault (for deposit)
    const msusdToSmsAllowance = await this.blockchainService.checkAllowance(
      this.config.msusdAddress,
      walletAddress,
      (this.smsUsdVault as any).getContract().address
    );
    if (msusdToSmsAllowance.lt(ethers.BigNumber.from(1))) {
      console.log('Approving msUSD for smsUSD vault...');
      const tx = await this.blockchainService.approveToken(
        this.config.msusdAddress,
        (this.smsUsdVault as any).getContract().address,
        ethers.constants.MaxUint256
      );
      await tx.wait(1);
    }

    // Optional: pre-approve smsUSD to Balancer Vault (exact router approval ensured in executeSwap)
    const smsAllowance = await this.blockchainService.checkAllowance(
      this.config.smsusdAddress,
      walletAddress,
      this.config.balancerVaultAddress
    );
    if (smsAllowance.lt(ethers.BigNumber.from(1))) {
      console.log('Pre-approving smsUSD for Balancer Vault...');
      const tx = await this.blockchainService.approveToken(
        this.config.smsusdAddress,
        this.config.balancerVaultAddress,
        ethers.constants.MaxUint256
      );
      await tx.wait(1);
    }
  }

  async emergencyStop(): Promise<void> {
    if (this.isExecuting) {
      console.log('Emergency stop requested. Current execution will be allowed to complete to avoid inconsistent state.');
    }
  }
}
