import { ethers } from 'ethers';

export interface ERC20Interface {
  balanceOf(account: string): Promise<ethers.BigNumber>;
  totalSupply(): Promise<ethers.BigNumber>;
  decimals(): Promise<number>;
  symbol(): Promise<string>;
  name(): Promise<string>;
  approve(spender: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction>;
  allowance(owner: string, spender: string): Promise<ethers.BigNumber>;
  transfer(to: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction>;
  transferFrom(from: string, to: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction>;
}

// Standard ERC20 ABI
export const ERC20ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

export class ERC20 implements ERC20Interface {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.providers.Provider) {
    this.contract = new ethers.Contract(address, ERC20ABI, signerOrProvider);
  }

  async balanceOf(account: string): Promise<ethers.BigNumber> {
    return await this.contract.balanceOf(account);
  }

  async totalSupply(): Promise<ethers.BigNumber> {
    return await this.contract.totalSupply();
  }

  async decimals(): Promise<number> {
    return await this.contract.decimals();
  }

  async symbol(): Promise<string> {
    return await this.contract.symbol();
  }

  async name(): Promise<string> {
    return await this.contract.name();
  }

  async approve(spender: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    return await this.contract.approve(spender, amount);
  }

  async allowance(owner: string, spender: string): Promise<ethers.BigNumber> {
    return await this.contract.allowance(owner, spender);
  }

  async transfer(to: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    return await this.contract.transfer(to, amount);
  }

  async transferFrom(from: string, to: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    return await this.contract.transferFrom(from, to, amount);
  }

  getContract(): ethers.Contract {
    return this.contract;
  }
}
