import { ethers } from 'ethers';

export interface SiloVaultInterface {
  deposit(assets: ethers.BigNumberish, receiver: string): Promise<ethers.ContractTransaction>;
  mint(shares: ethers.BigNumberish, receiver: string): Promise<ethers.ContractTransaction>;
  withdraw(assets: ethers.BigNumberish, receiver: string, owner: string): Promise<ethers.ContractTransaction>;
  redeem(shares: ethers.BigNumberish, receiver: string, owner: string): Promise<ethers.ContractTransaction>;
  totalAssets(): Promise<ethers.BigNumber>;
  maxDeposit(owner: string): Promise<ethers.BigNumber>;
  maxMint(owner: string): Promise<ethers.BigNumber>;
  maxWithdraw(owner: string): Promise<ethers.BigNumber>;
  maxRedeem(owner: string): Promise<ethers.BigNumber>;
  previewDeposit(assets: ethers.BigNumberish): Promise<ethers.BigNumber>;
  previewMint(shares: ethers.BigNumberish): Promise<ethers.BigNumber>;
  previewWithdraw(assets: ethers.BigNumberish): Promise<ethers.BigNumber>;
  previewRedeem(shares: ethers.BigNumberish): Promise<ethers.BigNumber>;
  convertToAssets(shares: ethers.BigNumberish): Promise<ethers.BigNumber>;
  asset(): Promise<string>;
  totalSupply(): Promise<ethers.BigNumber>;
  balanceOf(account: string): Promise<ethers.BigNumber>;
  decimals(): Promise<number>;
  symbol(): Promise<string>;
  name(): Promise<string>;
  claimRewards(): Promise<ethers.ContractTransaction>;
}

// ABI for SiloVault (ERC4626 compliant)
export const SiloVaultABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256 shares)",
  "function mint(uint256 shares, address receiver) external returns (uint256 assets)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets)",
  "function totalAssets() external view returns (uint256)",
  "function maxDeposit(address owner) external view returns (uint256)",
  "function maxMint(address owner) external view returns (uint256)",
  "function maxWithdraw(address owner) external view returns (uint256)",
  "function maxRedeem(address owner) external view returns (uint256)",
  "function previewDeposit(uint256 assets) external view returns (uint256 shares)",
  "function previewMint(uint256 shares) external view returns (uint256 assets)",
  "function previewWithdraw(uint256 assets) external view returns (uint256 shares)",
  "function previewRedeem(uint256 shares) external view returns (uint256 assets)",
  "function convertToAssets(uint256 shares) external view returns (uint256 assets)",
  "function asset() external view returns (address)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function claimRewards() external",
  "event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

export class SiloVault implements SiloVaultInterface {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.providers.Provider) {
    this.contract = new ethers.Contract(address, SiloVaultABI, signerOrProvider);
  }

  async deposit(assets: ethers.BigNumberish, receiver: string): Promise<ethers.ContractTransaction> {
    return await this.contract.deposit(assets, receiver);
  }

  async mint(shares: ethers.BigNumberish, receiver: string): Promise<ethers.ContractTransaction> {
    return await this.contract.mint(shares, receiver);
  }

  async withdraw(assets: ethers.BigNumberish, receiver: string, owner: string): Promise<ethers.ContractTransaction> {
    return await this.contract.withdraw(assets, receiver, owner);
  }

  async redeem(shares: ethers.BigNumberish, receiver: string, owner: string): Promise<ethers.ContractTransaction> {
    return await this.contract.redeem(shares, receiver, owner);
  }

  async totalAssets(): Promise<ethers.BigNumber> {
    return await this.contract.totalAssets();
  }

  async maxDeposit(owner: string): Promise<ethers.BigNumber> {
    return await this.contract.maxDeposit(owner);
  }

  async maxMint(owner: string): Promise<ethers.BigNumber> {
    return await this.contract.maxMint(owner);
  }

  async maxWithdraw(owner: string): Promise<ethers.BigNumber> {
    return await this.contract.maxWithdraw(owner);
  }

  async maxRedeem(owner: string): Promise<ethers.BigNumber> {
    return await this.contract.maxRedeem(owner);
  }

  async previewDeposit(assets: ethers.BigNumberish): Promise<ethers.BigNumber> {
    return await this.contract.previewDeposit(assets);
  }

  async previewMint(shares: ethers.BigNumberish): Promise<ethers.BigNumber> {
    return await this.contract.previewMint(shares);
  }

  async previewWithdraw(assets: ethers.BigNumberish): Promise<ethers.BigNumber> {
    return await this.contract.previewWithdraw(assets);
  }

  async previewRedeem(shares: ethers.BigNumberish): Promise<ethers.BigNumber> {
    return await this.contract.previewRedeem(shares);
  }

  async convertToAssets(shares: ethers.BigNumberish): Promise<ethers.BigNumber> {
    return await this.contract.convertToAssets(shares);
  }

  async asset(): Promise<string> {
    return await this.contract.asset();
  }

  async totalSupply(): Promise<ethers.BigNumber> {
    return await this.contract.totalSupply();
  }

  async balanceOf(account: string): Promise<ethers.BigNumber> {
    return await this.contract.balanceOf(account);
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

  async claimRewards(): Promise<ethers.ContractTransaction> {
    return await this.contract.claimRewards();
  }

  getContract(): ethers.Contract {
    return this.contract;
  }
}
