import { ethers } from 'ethers';
import { BlockchainService } from './BlockchainService';
import { BalancerSwapService } from './BalancerSwapService';
import { ERC20 } from '../interfaces/ERC20';
import { PoolInfo, ArbitrageOpportunity, TokenInfo } from '../types';
import { getConfig } from '../config';

export class PoolMonitoringService {
  private blockchainService: BlockchainService;
  private poolAddress: string;
  private swapService: BalancerSwapService;
  private tokenInfo: Map<string, TokenInfo> = new Map();
  private lastCheckTime: number = 0;
  private monitoringInterval: NodeJS.Timeout | null = null;

  // Sonic-specific tokens: monitor smsUSD <-> ghUSDC pricing on Balancer V3
  private smsusdAddress: string;
  private ghusdcAddress: string;

  constructor(blockchainService: BlockchainService, poolAddress: string) {
    this.blockchainService = blockchainService;
    this.poolAddress = poolAddress;
    const cfg = getConfig();
    this.smsusdAddress = cfg.smsusdAddress.toLowerCase();
    this.ghusdcAddress = cfg.ghusdcAddress.toLowerCase();
    this.swapService = new BalancerSwapService(cfg);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.tokenInfo.get(this.smsusdAddress) || !this.tokenInfo.get(this.ghusdcAddress)) {
      await this.fetchTokenMetadata();
    }
  }

  async initialize(): Promise<void> {
    await this.fetchTokenMetadata();
    console.log('Pool monitoring service initialized (price-based) for pool:', this.poolAddress);
  }

  // In Balancer V3 we avoid relying on pool contract storage directly and infer imbalance via price quotes.
  private async fetchTokenMetadata(): Promise<void> {
    const cfg = getConfig();
    const provider = this.blockchainService.getProvider();

    const loadOne = async (address: string): Promise<void> => {
      const token = new ERC20(address, provider);
      const [symbol, name, decimals] = await Promise.all([
        token.symbol(),
        token.name(),
        token.decimals(),
      ]);
      this.tokenInfo.set(address.toLowerCase(), { symbol, name, address, decimals });
    };

    await Promise.all([loadOne(cfg.smsusdAddress), loadOne(cfg.ghusdcAddress)]);

    console.log('Tracked tokens:', Array.from(this.tokenInfo.values()));
  }

  // Maintains legacy shape but does not return live reserves for V3
  async getCurrentPoolState(): Promise<PoolInfo> {
    await this.ensureInitialized();
    const tokens = [this.tokenInfo.get(this.smsusdAddress)!, this.tokenInfo.get(this.ghusdcAddress)!];

    // Placeholders for reserves/weights/fee
    const reserves: { [tokenAddress: string]: bigint } = {};
    const weights: { [tokenAddress: string]: number } = {};
    for (const t of tokens) {
      reserves[t.address.toLowerCase()] = 0n;
      weights[t.address.toLowerCase()] = 0.5; // assume equal target for stable pair
    }

    return {
      address: this.poolAddress,
      tokens,
      reserves,
      weights,
      fee: 0,
    };
  }

  async checkForArbitrageOpportunity(minImbalanceThreshold: number = 0.5): Promise<ArbitrageOpportunity | null> {
    try {
      const imbalance = await this.computePriceImbalancePct();

      if (imbalance >= minImbalanceThreshold) {
        const estimatedGas = await this.estimateArbitrageGasCost();
        const opportunity: ArbitrageOpportunity = {
          poolAddress: this.poolAddress,
          imbalance,
          expectedProfit: 0n, // profit evaluation is performed later via full simulation
          estimatedGas,
          timestamp: Date.now(),
        };

        console.log('Arbitrage opportunity detected (price-based):', opportunity);
        return opportunity;
      }

      return null;
    } catch (error) {
      console.error('Error checking for arbitrage opportunity:', error);
      return null;
    }
  }

  // Price-based imbalance: check msUSD->ghUSDC and ghUSDC->msUSD spot quotes for a nominal size.
  private async computePriceImbalancePct(): Promise<number> {
    await this.ensureInitialized();

    const msusd = this.tokenInfo.get(this.smsusdAddress)!;
    const ghusdc = this.tokenInfo.get(this.ghusdcAddress)!;

    // Use small nominal trade sizes to approximate spot price and minimize slippage impact
    const pow10 = (d: number) => 10n ** BigInt(d);
    const nominalUnits = (dec: number) => {
      const exp = Math.max(0, dec - 3);
      return 10n ** BigInt(exp);
    };

    const amountMsusd = nominalUnits(msusd.decimals);
    const amountGhusdc = nominalUnits(ghusdc.decimals);

    // Use custom 1-hop path via target pool
    const poolId = this.poolAddress;
    const [outMsusdToGhusdc, outGhusdcToMsusd] = await Promise.all([
      this.swapService.quoteExactInCustomPath(
        { address: msusd.address, decimals: msusd.decimals, symbol: msusd.symbol },
        { address: ghusdc.address, decimals: ghusdc.decimals, symbol: ghusdc.symbol },
        amountMsusd,
        poolId
      ),
      this.swapService.quoteExactInCustomPath(
        { address: ghusdc.address, decimals: ghusdc.decimals, symbol: ghusdc.symbol },
        { address: msusd.address, decimals: msusd.decimals, symbol: msusd.symbol },
        amountGhusdc,
        poolId
      )
    ]);

    if (outMsusdToGhusdc === 0n || outGhusdcToMsusd === 0n) {
      console.warn(
        `Received zero quote from SOR; treating imbalance as 0 to avoid false positives. Details: ` +
        `in ${msusd.symbol}->${ghusdc.symbol} amount=${amountMsusd.toString()} out=${outMsusdToGhusdc.toString()}, ` +
        `in ${ghusdc.symbol}->${msusd.symbol} amount=${amountGhusdc.toString()} out=${outGhusdcToMsusd.toString()}`
      );
      return 0;
    }

    // Fixed-point scale for price ratios
    const SCALE = 1_000_000_000n; // 1e9

    // ghUSDC is a wrapper; adjust any ghUSDC amount using ERC4626 rate provider (18 decimals)
    // rateProvider: 0x672551Cef9F032f29970AebA94E2dD7A962c1083
    const rateProvider = new ethers.Contract(
      '0x672551Cef9F032f29970AebA94E2dD7A962c1083',
      ['function getRate() view returns (uint256)'],
      this.blockchainService.getProvider()
    );
    const rateRaw: ethers.BigNumber = await rateProvider.getRate();
    const rate18 = BigInt(rateRaw.toString()); // 18-decimal scaled

    // Adjust: ghUSDC shares -> underlying units with 18 decimals by multiplying by rate and dividing by 1e18
    const outAAdj = (outMsusdToGhusdc * rate18) / (10n ** 18n); // msUSD -> ghUSDC (adjust out)
    const inBAdj = (amountGhusdc * rate18) / (10n ** 18n);      // ghUSDC -> msUSD (adjust in)

    // Compute rates using adjusted amounts and 18-decimals for adjusted ghUSDC side
    // rateAB: msUSD -> ghUSDC(adjusted)
    const numAB = outAAdj * pow10(msusd.decimals) * SCALE;
    const denAB = amountMsusd * pow10(18);
    const rateAB = denAB === 0n ? 0n : numAB / denAB;

    // rateBA: ghUSDC(adjusted) -> msUSD
    const numBA = outGhusdcToMsusd * pow10(18) * SCALE;
    const denBA = inBAdj * pow10(msusd.decimals);
    const rateBA = denBA === 0n ? 0n : numBA / denBA;

    // Sanity guards for stable pair
    if (rateAB === 0n || rateBA === 0n || rateAB > 10n * SCALE || rateBA > 10n * SCALE) {
      const rateABFloat = Number(rateAB) / Number(SCALE);
      const rateBAFloat = Number(rateBA) / Number(SCALE);
      console.warn(
        `Abnormal spot rates detected; treating imbalance as 0. ` +
        `Rates: ${msusd.symbol}->${ghusdc.symbol}(adj)=${rateABFloat.toFixed(6)}, ` +
        `${ghusdc.symbol}(adj)->${msusd.symbol}=${rateBAFloat.toFixed(6)}. ` +
        `Amounts: inA=${amountMsusd.toString()} outA(raw)=${outMsusdToGhusdc.toString()} outA(adj)=${outAAdj.toString()}, ` +
        `inB(raw)=${amountGhusdc.toString()} inB(adj)=${inBAdj.toString()} outB=${outGhusdcToMsusd.toString()}`
      );
      return 0;
    }

    const one = SCALE;
    const abs = (x: bigint) => (x < 0n ? -x : x);

    const devAB_pct_times100 = (abs(rateAB - one) * 10000n) / one; // percent with 2 decimals
    const devBA_pct_times100 = (abs(rateBA - one) * 10000n) / one;
    const product = (rateAB * rateBA) / SCALE;
    const recipMismatch_pct_times100 = (abs(product - one) * 10000n) / one;

    const maxPctTimes100 = [devAB_pct_times100, devBA_pct_times100, recipMismatch_pct_times100].reduce(
      (m, v) => (v > m ? v : m),
      0n
    );

    // Clamp to 100%
    const clampedPctTimes100 = maxPctTimes100 > 10000n ? 10000n : maxPctTimes100;
    const imbalance = Number(clampedPctTimes100) / 100;

    const toFloat = (fp: bigint) => Number(fp) / Number(SCALE);
    console.log(
      `Price-based imbalance (with ghUSDC adj): smsUSD->ghUSDC=${toFloat(rateAB).toFixed(6)}, ghUSDC->smsUSD=${toFloat(
        rateBA
      ).toFixed(6)}, deviation=${imbalance.toFixed(3)}%`
    );

    return imbalance;
  }

  private async estimateArbitrageGasCost(): Promise<number> {
    // Rough estimates; execution service/simulation provide refined gas estimates
    const mintGas = 200000;
    const swapGas = 200000; // V3 router
    const redeemGas = 180000;
    const totalGas = mintGas + swapGas + redeemGas;
    return Math.floor(totalGas * 1.2); // add buffer
    }

  async startMonitoring(
    checkInterval: number = 5000,
    minImbalanceThreshold: number = 0.5,
    onOpportunity?: (opportunity: ArbitrageOpportunity) => void
  ): Promise<void> {
    console.log(`Starting pool monitoring with ${checkInterval}ms interval`);
    
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }
    
    this.monitoringInterval = setInterval(async () => {
      try {
        const opportunity = await this.checkForArbitrageOpportunity(minImbalanceThreshold);
        
        if (opportunity && onOpportunity) {
          onOpportunity(opportunity);
        }
        
        this.lastCheckTime = Date.now();
        
      } catch (error) {
        console.error('Error during pool monitoring:', error);
      }
    }, checkInterval);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('Pool monitoring stopped');
    }
  }

  isMonitoring(): boolean {
    return this.monitoringInterval !== null;
  }

  getLastCheckTime(): number {
    return this.lastCheckTime;
  }

  getTokenInfo(tokenAddress: string): TokenInfo | undefined {
    return this.tokenInfo.get(tokenAddress.toLowerCase());
  }

  async getPoolHealth(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      // Try a small quote to ensure Balancer SDK + chain are responsive
      const msusd = this.tokenInfo.get(this.smsusdAddress)!;
      const ghusdc = this.tokenInfo.get(this.ghusdcAddress)!;
      const nominal = ethers.utils.parseUnits('1', msusd.decimals).toBigInt();
      await this.swapService.quoteExactInCustomPath(
        { address: msusd.address, decimals: msusd.decimals, symbol: msusd.symbol },
        { address: ghusdc.address, decimals: ghusdc.decimals, symbol: ghusdc.symbol },
        nominal,
        this.poolAddress
      );
      return true;
    } catch (error) {
      console.error('Pool health check failed:', error);
      return false;
    }
  }

  // Get basic analytics (price-based imbalance)
  async getPoolAnalytics(): Promise<{
    totalValueLocked: bigint;
    currentWeights: { [tokenAddress: string]: number };
    imbalance: number;
    fee: number;
    lastUpdated: number;
  }> {
    await this.ensureInitialized();
    const tokens = [this.tokenInfo.get(this.smsusdAddress)!, this.tokenInfo.get(this.ghusdcAddress)!];
    const imbalance = await this.computePriceImbalancePct();

    const currentWeights: { [tokenAddress: string]: number } = {};
    for (const t of tokens) {
      currentWeights[t.address.toLowerCase()] = 0.5; // assume equal target in absence of explicit weights
    }

    return {
      totalValueLocked: 0n, // not derived from quotes
      currentWeights,
      imbalance,
      fee: 0,
      lastUpdated: Date.now(),
    };
  }
}
