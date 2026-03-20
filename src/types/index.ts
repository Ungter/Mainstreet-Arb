export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export interface PoolInfo {
  address: string;
  tokens: TokenInfo[];
  reserves: { [tokenAddress: string]: any };
  weights: { [tokenAddress: string]: number };
  fee: number;
}

export interface ArbitrageOpportunity {
  poolAddress: string;
  imbalance: number; 
  expectedProfit: bigint;
  estimatedGas: number;
  timestamp: number;
}

export interface MintParams {
  asset: string;
  amountIn: bigint;
  minAmountOut: bigint;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  poolAddress: string;
}

export interface RedeemParams {
  vaultAddress: string;
  amount: bigint;
  receiver: string;
}

export interface TransactionConfig {
  gasLimit: number;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
}

export interface BotConfig {
  rpcUrl: string;
  privateKey: string;
  chainId: number;
  poolAddress: string;
  minterAddress: string;
  vaultAddress: string;
  usdcAddress: string;
  msusdAddress: string;
  smsusdAddress: string;
  ghusdcAddress: string;
  balancerVaultAddress: string;
  minProfitThreshold: bigint;
  maxGasPrice: bigint;
  checkInterval: number;
  slippageTolerance: number;
  gasTokenPrice: number;
}

export interface GasEstimate {
  gasUsed: number;
  gasPrice: any;
  totalCost: any;
}

export interface SimulationResult {
  success: boolean;
  profit?: bigint;
  gasCost?: bigint;
  netProfit?: bigint;
  error?: string;
}
