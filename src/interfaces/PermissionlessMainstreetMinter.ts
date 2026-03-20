import { ethers } from 'ethers';

export interface PermissionlessMainstreetMinterInterface {
  mint(asset: string, amountIn: ethers.BigNumberish, minAmountOut: ethers.BigNumberish): Promise<ethers.ContractTransaction>;
  requestTokens(asset: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction>;
  claimTokens(asset: string): Promise<ethers.ContractTransaction>;
  processClaims(asset: string, numIndexes: ethers.BigNumberish): Promise<ethers.ContractTransaction>;
  msUSD(): Promise<string>;
  mainstreetMinter(): Promise<string>;
  firstUnclaimedIndex(user: string, asset: string): Promise<ethers.BigNumber>;
  requestToUser(globalIndex: ethers.BigNumberish): Promise<string>;
  userPendingClaims(user: string, asset: string): Promise<ethers.BigNumber>;
}

// ABI for PermissionlessMainstreetMinter
export const PermissionlessMainstreetMinterABI = [
  "function mint(address asset, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut)",
  "function requestTokens(address asset, uint256 amount) external",
  "function claimTokens(address asset) external returns (uint256 amount)",
  "function processClaims(address asset, uint256 numIndexes) external",
  "function msUSD() external view returns (address)",
  "function mainstreetMinter() external view returns (address)",
  "function firstUnclaimedIndex(address user, address asset) external view returns (uint256)",
  "function requestToUser(uint256 globalIndex) external view returns (address)",
  "function userPendingClaims(address user, address asset) external view returns (uint256)",
  "event Mint(address indexed user, address indexed asset, uint256 amountIn, uint256 amountOut)",
  "event TokensRequested(address indexed user, address indexed asset, uint256 amount, uint256 amountAsset, uint48 claimableAfter)",
  "event TokensClaimed(address indexed user, address indexed asset, uint256 amount)"
];

export class PermissionlessMainstreetMinter implements PermissionlessMainstreetMinterInterface {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.providers.Provider) {
    this.contract = new ethers.Contract(address, PermissionlessMainstreetMinterABI, signerOrProvider);
  }

  async mint(asset: string, amountIn: ethers.BigNumberish, minAmountOut: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    return await this.contract.mint(asset, amountIn, minAmountOut);
  }

  async requestTokens(asset: string, amount: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    return await this.contract.requestTokens(asset, amount);
  }

  async claimTokens(asset: string): Promise<ethers.ContractTransaction> {
    return await this.contract.claimTokens(asset);
  }

  async processClaims(asset: string, numIndexes: ethers.BigNumberish): Promise<ethers.ContractTransaction> {
    return await this.contract.processClaims(asset, numIndexes);
  }

  async msUSD(): Promise<string> {
    return await this.contract.msUSD();
  }

  async mainstreetMinter(): Promise<string> {
    return await this.contract.mainstreetMinter();
  }


  async firstUnclaimedIndex(user: string, asset: string): Promise<ethers.BigNumber> {
    return await this.contract.firstUnclaimedIndex(user, asset);
  }

  async requestToUser(globalIndex: ethers.BigNumberish): Promise<string> {
    return await this.contract.requestToUser(globalIndex);
  }

  async userPendingClaims(user: string, asset: string): Promise<ethers.BigNumber> {
    return await this.contract.userPendingClaims(user, asset);
  }

  getContract(): ethers.Contract {
    return this.contract;
  }
}
