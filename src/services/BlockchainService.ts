import { ethers, providers } from 'ethers';
import { BotConfig, TransactionConfig, GasEstimate } from '../types';
import { ERC20 } from '../interfaces';

export class BlockchainService {
  private provider: providers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private signer: ethers.Signer;

  constructor(config: BotConfig) {
    this.provider = new providers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    this.signer = this.wallet.connect(this.provider);
  }

  getProvider(): providers.JsonRpcProvider {
    return this.provider;
  }

  getSigner(): ethers.Signer {
    return this.signer;
  }

  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  async getAddress(): Promise<string> {
    return await this.wallet.getAddress();
  }

  async getBalance(address?: string): Promise<ethers.BigNumber> {
    const targetAddress = address || await this.wallet.getAddress();
    return await this.provider.getBalance(targetAddress);
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getGasPrice(): Promise<ethers.BigNumber> {
    return await this.provider.getGasPrice();
  }

  async estimateGas(transaction: ethers.providers.TransactionRequest): Promise<ethers.BigNumber> {
    return await this.provider.estimateGas(transaction);
  }

  async getTransactionCount(address?: string, blockTag?: ethers.providers.BlockTag): Promise<number> {
    const targetAddress = address || await this.wallet.getAddress();
    return await this.provider.getTransactionCount(targetAddress, blockTag);
  }

  async sendTransaction(transaction: ethers.providers.TransactionRequest): Promise<ethers.providers.TransactionResponse> {
    return await this.wallet.sendTransaction(transaction);
  }

  async waitForTransaction(transactionHash: string, confirmations?: number): Promise<ethers.providers.TransactionReceipt> {
    return await this.provider.waitForTransaction(transactionHash, confirmations);
  }

  async getTransactionReceipt(transactionHash: string): Promise<ethers.providers.TransactionReceipt | null> {
    return await this.provider.getTransactionReceipt(transactionHash);
  }

  async getTokenBalance(tokenAddress: string, walletAddress?: string): Promise<ethers.BigNumber> {
    const targetAddress = walletAddress || await this.wallet.getAddress();
    const token = new ERC20(tokenAddress, this.provider);
    return await token.balanceOf(targetAddress);
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    const token = new ERC20(tokenAddress, this.provider);
    return await token.decimals();
  }

  async getTokenSymbol(tokenAddress: string): Promise<string> {
    const token = new ERC20(tokenAddress, this.provider);
    return await token.symbol();
  }

  async approveToken(tokenAddress: string, spenderAddress: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    const token = new ERC20(tokenAddress, this.signer);
    return await token.approve(spenderAddress, amount);
  }

  async checkAllowance(tokenAddress: string, ownerAddress: string, spenderAddress: string): Promise<ethers.BigNumber> {
    const token = new ERC20(tokenAddress, this.provider);
    return await token.allowance(ownerAddress, spenderAddress);
  }

  async buildTransactionConfig(
    transaction: ethers.providers.TransactionRequest,
    config?: Partial<TransactionConfig>
  ): Promise<TransactionConfig> {
    const gasPrice = config?.gasPrice || (await this.getGasPrice()).toBigInt();
    const gasLimit = config?.gasLimit || (await this.estimateGas(transaction)).toNumber();
    const nonce = config?.nonce || await this.getTransactionCount();

    const txConfig: TransactionConfig = {
      gasLimit,
      gasPrice,
      nonce,
      maxFeePerGas: config?.maxFeePerGas,
      maxPriorityFeePerGas: config?.maxPriorityFeePerGas,
    };

    return txConfig;
  }

  async estimateTransactionCost(transaction: ethers.providers.TransactionRequest): Promise<GasEstimate> {
    const gasUsed = await this.estimateGas(transaction);
    const gasPrice = await this.getGasPrice();
    const totalCost = gasUsed.mul(gasPrice);

    return {
      gasUsed: gasUsed.toNumber(),
      gasPrice,
      totalCost,
    };
  }

  async isContract(address: string): Promise<boolean> {
    const code = await this.provider.getCode(address);
    return code !== '0x';
  }

  async getNetwork(): Promise<ethers.providers.Network> {
    return await this.provider.getNetwork();
  }

  async getLatestBlock(): Promise<ethers.providers.Block> {
    return await this.provider.getBlock('latest');
  }

  async getBlock(blockHashOrBlockTag: ethers.providers.BlockTag | string): Promise<ethers.providers.Block> {
    return await this.provider.getBlock(blockHashOrBlockTag);
  }

  async getTransaction(transactionHash: string): Promise<ethers.providers.TransactionResponse> {
    return await this.provider.getTransaction(transactionHash);
  }

  // Utility methods for formatting
  formatEther(value: ethers.BigNumberish): string {
    return ethers.utils.formatEther(value);
  }

  parseEther(value: string): ethers.BigNumber {
    return ethers.utils.parseEther(value);
  }

  formatUnits(value: ethers.BigNumberish, unit: string | number): string {
    return ethers.utils.formatUnits(value, unit);
  }

  parseUnits(value: string, unit: string | number): ethers.BigNumber {
    return ethers.utils.parseUnits(value, unit);
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch (error) {
      console.error('Blockchain service health check failed:', error);
      return false;
    }
  }
}
