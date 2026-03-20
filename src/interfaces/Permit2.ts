import { ethers } from 'ethers';

// Minimal Uniswap Permit2 ABI surface for PermitSingle
export const PERMIT2_ABI = [
  // Read allowance (amount, expiration, nonce)
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  // PermitSingle per Uniswap Permit2: permit(address owner, PermitSingle permitSingle, bytes signature)
  'function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature) external',
];

export type Permit2Allowance = {
  amount: bigint;     // uint160
  expiration: number; // uint48
  nonce: number;      // uint48
};

export type PermitDetails = {
  token: string;
  amount: bigint;     // uint160
  expiration: number; // uint48 (unix seconds)
  nonce: number;      // uint48
};

export type PermitSingle = {
  details: PermitDetails;
  spender: string;
  sigDeadline: bigint; // uint256
};

export class Permit2 {
  private contract: ethers.Contract;

  constructor(address: string, signerOrProvider: ethers.Signer | ethers.providers.Provider) {
    this.contract = new ethers.Contract(address, PERMIT2_ABI, signerOrProvider as any);
  }

  connectSigner(signer: ethers.Signer) {
    this.contract = this.contract.connect(signer);
  }

  getContract(): ethers.Contract {
    return this.contract;
  }

  async readAllowance(owner: string, token: string, spender: string): Promise<Permit2Allowance> {
    const [amount, expiration, nonce] = await this.contract.allowance(owner, token, spender);
    return {
      amount: BigInt(amount.toString()),
      expiration: Number(expiration.toString()),
      nonce: Number(nonce.toString()),
    };
  }

  // EIP-712 typed data for PermitSingle (Uniswap Permit2)
  static buildTypedData(
    chainId: number,
    verifyingContract: string,
    permit: PermitSingle
  ): { domain: Record<string, any>; types: Record<string, any>; message: Record<string, any> } {
    // Uniswap Permit2 domain typically uses only name, chainId, verifyingContract
    const domain = {
      name: 'Permit2',
      chainId,
      verifyingContract,
    };

    const types = {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    };

    const message = {
      details: {
        token: permit.details.token,
        amount: permit.details.amount,
        expiration: permit.details.expiration,
        nonce: permit.details.nonce,
      },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
    };

    return { domain, types, message };
  }

  // Sign typed data with ethers v5 (_signTypedData)
  async signPermitSingle(
    ownerSigner: ethers.Wallet | ethers.Signer,
    chainId: number,
    verifyingContract: string,
    permit: PermitSingle
  ): Promise<string> {
    const { domain, types, message } = Permit2.buildTypedData(chainId, verifyingContract, permit);
    // ethers v5 Signer
    // @ts-ignore
    const signature: string = await (ownerSigner as any)._signTypedData(domain, types, message);
    return signature;
  }

  // Submit PermitSingle onchain
  async submitPermit(
    owner: string,
    permit: PermitSingle,
    signature: string
  ): Promise<ethers.providers.TransactionResponse> {
    // Contract expects: permit(owner, PermitSingle{details, spender, sigDeadline}, signature)
    const permitSingleArg = [
      [permit.details.token, permit.details.amount, permit.details.expiration, permit.details.nonce],
      permit.spender,
      permit.sigDeadline,
    ];
    const tx = await this.contract.permit(owner, permitSingleArg, signature);
    return tx;
  }
}
