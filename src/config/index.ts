import dotenv from 'dotenv';
import { BotConfig } from '../types';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export class ConfigService {
  private static instance: ConfigService;
  private config: BotConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private loadConfig(): BotConfig {
    const requiredEnvVars = [
      'RPC_URL',
      'PRIVATE_KEY',
      'CHAIN_ID',
      'POOL_ADDRESS',
      'MINTER_ADDRESS',
      'VAULT_ADDRESS',
      'USDC_ADDRESS',
      'MSUSD_ADDRESS',
      'SMSUSD_ADDRESS',
      'GHUSDC_ADDRESS',
      'BALANCER_VAULT_ADDRESS',
      'GAS_TOKEN_PRICE'
    ];

    // Check for required environment variables
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    return {
      rpcUrl: process.env.RPC_URL!,
      privateKey: process.env.PRIVATE_KEY!,
      chainId: parseInt(process.env.CHAIN_ID || '146'),
      poolAddress: process.env.POOL_ADDRESS!,
      minterAddress: process.env.MINTER_ADDRESS!,
      vaultAddress: process.env.VAULT_ADDRESS!,
      usdcAddress: process.env.USDC_ADDRESS!,
      msusdAddress: process.env.MSUSD_ADDRESS!,
      smsusdAddress: process.env.SMSUSD_ADDRESS!,
      ghusdcAddress: process.env.GHUSDC_ADDRESS!,
      balancerVaultAddress: process.env.BALANCER_VAULT_ADDRESS!,
      minProfitThreshold: BigInt(process.env.MIN_PROFIT_THRESHOLD || '1000000000000000000'), // 1 ETH default
      maxGasPrice: BigInt(process.env.MAX_GAS_PRICE || '50000000000'), // 50 gwei default
      checkInterval: parseInt(process.env.CHECK_INTERVAL || '5000'), // 5 seconds default
      slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.01'), // 1% default
      gasTokenPrice: parseFloat(process.env.GAS_TOKEN_PRICE || '0.25') // $0.25 default
    };
  }

  public getConfig(): BotConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<BotConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate RPC URL
    if (!this.config.rpcUrl.startsWith('http')) {
      errors.push('RPC_URL must start with http:// or https://');
    }

    // Validate private key
    if (!this.config.privateKey.startsWith('0x') || this.config.privateKey.length !== 66) {
      errors.push('PRIVATE_KEY must be a valid 32-byte hex string with 0x prefix');
    }
    // Validate chain id
    if (!Number.isInteger(this.config.chainId) || this.config.chainId <= 0) {
      errors.push('CHAIN_ID must be a positive integer');
    }

    // Validate contract addresses
    const addressFields = [
      'poolAddress',
      'minterAddress', 
      'vaultAddress',
      'usdcAddress',
      'msusdAddress',
      'smsusdAddress',
      'ghusdcAddress',
      'balancerVaultAddress'
    ] as const;

    for (const field of addressFields) {
      const address = this.config[field];
      if (!address.startsWith('0x') || address.length !== 42) {
        errors.push(`${field} must be a valid 20-byte hex address with 0x prefix`);
      }
    }

    // Validate numeric values
    if (this.config.minProfitThreshold <= 0n) {
      errors.push('MIN_PROFIT_THRESHOLD must be greater than 0');
    }

    if (this.config.maxGasPrice <= 0n) {
      errors.push('MAX_GAS_PRICE must be greater than 0');
    }

    if (this.config.checkInterval <= 0) {
      errors.push('CHECK_INTERVAL must be greater than 0');
    }

    if (this.config.slippageTolerance <= 0 || this.config.slippageTolerance >= 1) {
      errors.push('SLIPPAGE_TOLERANCE must be between 0 and 1');
    }

    if (this.config.gasTokenPrice <= 0) {
      errors.push('GAS_TOKEN_PRICE must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  public getConfigSummary(): {
    network: string;
    chainId: number;
    contracts: {
      pool: string;
      minter: string;
      vault: string;
      balancerVault: string;
      tokens: {
        usdc: string;
        msusd: string;
        smsusd: string;
        ghusdc: string;
      };
    };
    settings: {
      minProfitThreshold: string;
      maxGasPrice: string;
      checkInterval: number;
      slippageTolerance: number;
      gasTokenPrice: number;
    };
  } {
    // Extract network from RPC URL (simplified)
    const network = this.config.rpcUrl.includes('mainnet') ? 'mainnet' : 
                   this.config.rpcUrl.includes('goerli') ? 'goerli' : 
                   this.config.rpcUrl.includes('sepolia') ? 'sepolia' : 'unknown';

    return {
      network,
      chainId: this.config.chainId,
      contracts: {
        pool: this.config.poolAddress,
        minter: this.config.minterAddress,
        vault: this.config.vaultAddress,
        balancerVault: this.config.balancerVaultAddress,
        tokens: {
          usdc: this.config.usdcAddress,
        msusd: this.config.msusdAddress,
        smsusd: this.config.smsusdAddress,
        ghusdc: this.config.ghusdcAddress
        }
      },
      settings: {
        minProfitThreshold: this.config.minProfitThreshold.toString(),
        maxGasPrice: this.config.maxGasPrice.toString(),
        checkInterval: this.config.checkInterval,
        slippageTolerance: this.config.slippageTolerance,
        gasTokenPrice: this.config.gasTokenPrice
      }
    };
  }

  public maskSensitiveData(): BotConfig {
    return {
      ...this.config,
      privateKey: '0x' + '*'.repeat(64)
    };
  }
}

// Export convenience functions
export const getConfig = () => ConfigService.getInstance().getConfig();
export const updateConfig = (newConfig: Partial<BotConfig>) => 
  ConfigService.getInstance().updateConfig(newConfig);
export const validateConfig = () => ConfigService.getInstance().validateConfig();
export const getConfigSummary = () => ConfigService.getInstance().getConfigSummary();
export const maskSensitiveData = () => ConfigService.getInstance().maskSensitiveData();

// Default export
export default ConfigService;
