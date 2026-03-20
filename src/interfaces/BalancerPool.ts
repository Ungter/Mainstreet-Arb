import { ethers } from 'ethers';

export interface BalancerPoolInterface {
  swap(
    singleSwap: {
      poolId: string;
      kind: number; // 0 for GIVAN, 1 for GIVEN_IN
      assetIn: string;
      assetOut: string;
      amount: ethers.BigNumberish;
      userData: string;
    },
    limits: string[],
    deadline: ethers.BigNumberish,
    value: ethers.BigNumberish
  ): Promise<ethers.ContractTransaction>;

  getPoolId(): Promise<string>;
  getTokens(): Promise<string[]>;
  getNormalizedWeights(): Promise<ethers.BigNumber[]>;
  getSwapFee(): Promise<ethers.BigNumber>;
  getBalance(token: string): Promise<ethers.BigNumber>;
  totalSupply(): Promise<ethers.BigNumber>;
  getRate(): Promise<ethers.BigNumber>;
}

// Simplified Balancer Pool ABI
export const BalancerPoolABI = [
  "function swap(tuple(uint256 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, uint256[] limits, uint256 deadline, uint256 value) external payable returns (uint256)",
  "function getPoolId() external view returns (bytes32)",
  "function getTokens() external view returns (address[])",
  "function getNormalizedWeights() external view returns (uint256[])",
  "function getSwapFee() external view returns (uint256)",
  "function getBalance(address token) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function getRate() external view returns (uint256)",
  "event Swap(bytes32 indexed poolId, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)"
];

export class BalancerPool implements BalancerPoolInterface {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.providers.Provider) {
    this.contract = new ethers.Contract(address, BalancerPoolABI, signerOrProvider);
  }

  async swap(
    singleSwap: {
      poolId: string;
      kind: number;
      assetIn: string;
      assetOut: string;
      amount: ethers.BigNumberish;
      userData: string;
    },
    limits: string[],
    deadline: ethers.BigNumberish,
    value: ethers.BigNumberish = 0
  ): Promise<ethers.ContractTransaction> {
    return await this.contract.swap(singleSwap, limits, deadline, { value });
  }

  async getPoolId(): Promise<string> {
    return await this.contract.getPoolId();
  }

  async getTokens(): Promise<string[]> {
    return await this.contract.getTokens();
  }

  async getNormalizedWeights(): Promise<ethers.BigNumber[]> {
    return await this.contract.getNormalizedWeights();
  }

  async getSwapFee(): Promise<ethers.BigNumber> {
    return await this.contract.getSwapFee();
  }

  async getBalance(token: string): Promise<ethers.BigNumber> {
    return await this.contract.getBalance(token);
  }

  async totalSupply(): Promise<ethers.BigNumber> {
    return await this.contract.totalSupply();
  }

  async getRate(): Promise<ethers.BigNumber> {
    return await this.contract.getRate();
  }

  getContract(): ethers.Contract {
    return this.contract;
  }
}

// Helper function to calculate pool imbalance
export function calculatePoolImbalance(
  reserves: { [tokenAddress: string]: any },
  weights: { [tokenAddress: string]: number },
  tokenAddresses: string[]
): number {
  let maxDeviation = 0;
  
  for (const tokenAddress of tokenAddresses) {
    const reserve = reserves[tokenAddress];
    const weight = weights[tokenAddress];
    
    if (reserve && weight) {
      const totalValue = tokenAddresses.reduce((sum, addr) => {
        return sum + parseFloat(ethers.utils.formatEther(reserves[addr]));
      }, 0);
      
      const currentWeight = (parseFloat(ethers.utils.formatEther(reserve)) / totalValue) * 100;
      const targetWeight = weight * 100; // Convert to percentage
      const deviation = Math.abs(currentWeight - targetWeight);
      
      maxDeviation = Math.max(maxDeviation, deviation);
    }
  }
  
  return maxDeviation;
}

// Helper function to estimate swap amount out
export function estimateSwapAmountOut(
  amountIn: ethers.BigNumber,
  reserveIn: ethers.BigNumber,
  reserveOut: ethers.BigNumber,
  swapFee: ethers.BigNumber
): ethers.BigNumber {
  // Simplified constant product formula with fee
  const feeAmount = amountIn.mul(swapFee).div(ethers.BigNumber.from(10).pow(18));
  const amountInAfterFee = amountIn.sub(feeAmount);
  
  const amountOut = reserveOut.mul(amountInAfterFee).div(reserveIn.add(amountInAfterFee));
  
  return amountOut;
}
