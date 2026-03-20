import { BalancerApi, ChainId, Slippage, Swap, SwapBuildCallInput, SwapBuildOutputExactIn, SwapKind, Token, TokenAmount, ExactInQueryOutput } from '@balancer/sdk';
import { ethers } from 'ethers';
import { BotConfig } from '../types';

export interface BuiltSwapTx {
  to: string;
  callData: string;
  value: string; // hex string
  expectedAmountOut: bigint;
  minAmountOut: bigint;
  protocolVersion: 2 | 3;
}

export class BalancerSwapService {
  private api: BalancerApi;
  private chainId: number;
  private rpcUrl: string;

  constructor(config: BotConfig) {
    this.chainId = config.chainId;
    this.rpcUrl = config.rpcUrl;
    // Balancer V3 API endpoint covers SOR paths for v2+v3
    this.api = new BalancerApi('https://api-v3.balancer.fi/', this.chainId as ChainId);
  }

  // Build an exact-in swap transaction using the SDK/SOR for best path across Balancer
  async buildExactInSwap(
    tokenIn: { address: string; decimals: number; symbol?: string },
    tokenOut: { address: string; decimals: number; symbol?: string },
    amountIn: bigint,
    slippagePct: number
  ): Promise<BuiltSwapTx> {
    const swapKind = SwapKind.GivenIn;

    const tIn = new Token(this.chainId as ChainId, tokenIn.address as `0x${string}`, tokenIn.decimals, tokenIn.symbol || 'TKN_IN');
    const tOut = new Token(this.chainId as ChainId, tokenOut.address as `0x${string}`, tokenOut.decimals, tokenOut.symbol || 'TKN_OUT');

    const swapAmount = TokenAmount.fromRawAmount(tIn, amountIn);
    const sorPaths = await this.api.sorSwapPaths.fetchSorSwapPaths({
      chainId: this.chainId as ChainId,
      tokenIn: tIn.address,
      tokenOut: tOut.address,
      swapKind,
      swapAmount,
    });

    const swap = new Swap({
      chainId: this.chainId as ChainId,
      paths: sorPaths,
      swapKind,
    });

    // Query onchain for up-to-date expected amount out
    const updated = (await swap.query(this.rpcUrl)) as ExactInQueryOutput;
    const expectedAmountOut = BigInt(updated.expectedAmountOut.amount);

    // Build the call with slippage
    const slippage = Slippage.fromPercentage(((slippagePct * 100) as number).toString() as `${number}`); // e.g. 0.01 -> "1"
    const deadline = 9007199254740991n; // use router sentinel max deadline

    let buildInput: SwapBuildCallInput;
    if (swap.protocolVersion === 2) {
      // V2 needs sender/recipient, but SDK will accept omitted and default to msg.sender. Provide minimal set:
      buildInput = {
        slippage,
        deadline,
        queryOutput: updated,
        wethIsEth: false,
      };
    } else {
      // V3: msg.sender is always sender/recipient
      buildInput = {
        slippage,
        deadline,
        queryOutput: updated,
        wethIsEth: false,
      };
    }

    const callData = swap.buildCall(buildInput) as SwapBuildOutputExactIn;

    return {
      to: callData.to,
      callData: callData.callData,
      value: ethers.BigNumber.from(callData.value || '0').toHexString(),
      expectedAmountOut,
      minAmountOut: BigInt(callData.minAmountOut.amount),
      protocolVersion: swap.protocolVersion as 2 | 3,
    };
  }

  // Get an expected out quote only (no tx build)
  async estimateExactIn(
    tokenIn: { address: string; decimals: number; symbol?: string },
    tokenOut: { address: string; decimals: number; symbol?: string },
    amountIn: bigint
  ): Promise<bigint> {
    const swapKind = SwapKind.GivenIn;
    const tIn = new Token(this.chainId as ChainId, tokenIn.address as `0x${string}`, tokenIn.decimals, tokenIn.symbol || 'TKN_IN');
    const tOut = new Token(this.chainId as ChainId, tokenOut.address as `0x${string}`, tokenOut.decimals, tokenOut.symbol || 'TKN_OUT');
    const swapAmount = TokenAmount.fromRawAmount(tIn, amountIn);

    const sorPaths = await this.api.sorSwapPaths.fetchSorSwapPaths({
      chainId: this.chainId as ChainId,
      tokenIn: tIn.address,
      tokenOut: tOut.address,
      swapKind,
      swapAmount,
    });

    const swap = new Swap({
      chainId: this.chainId as ChainId,
      paths: sorPaths,
      swapKind,
    });

    const updated = (await swap.query(this.rpcUrl)) as ExactInQueryOutput;
    return BigInt(updated.expectedAmountOut.amount);
  }

  // Custom single-hop path quote (no SOR) per Balancer docs
  async quoteExactInCustomPath(
    tokenIn: { address: string; decimals: number; symbol?: string },
    tokenOut: { address: string; decimals: number; symbol?: string },
    amountIn: bigint,
    poolId: string
  ): Promise<bigint> {
    const swap = new Swap({
      chainId: this.chainId as ChainId,
      swapKind: SwapKind.GivenIn,
      paths: [
        {
          pools: [poolId as `0x${string}`],
          tokens: [
            { address: tokenIn.address as `0x${string}`, decimals: tokenIn.decimals },
            { address: tokenOut.address as `0x${string}`, decimals: tokenOut.decimals },
          ],
          protocolVersion: 3 as const,
          inputAmountRaw: amountIn,
          outputAmountRaw: 0n,
        },
      ],
    });

    const updated = (await swap.query(this.rpcUrl)) as ExactInQueryOutput;
    return BigInt(updated.expectedAmountOut.amount);
  }

  // Custom single-hop path build (no SOR) per Balancer docs
  async buildExactInCustomPath(
    tokenIn: { address: string; decimals: number; symbol?: string },
    tokenOut: { address: string; decimals: number; symbol?: string },
    amountIn: bigint,
    slippagePct: number,
    poolId: string
  ): Promise<BuiltSwapTx> {
    const swap = new Swap({
      chainId: this.chainId as ChainId,
      swapKind: SwapKind.GivenIn,
      paths: [
        {
          pools: [poolId as `0x${string}`],
          tokens: [
            { address: tokenIn.address as `0x${string}`, decimals: tokenIn.decimals },
            { address: tokenOut.address as `0x${string}`, decimals: tokenOut.decimals },
          ],
          protocolVersion: 3 as const,
          inputAmountRaw: amountIn,
          outputAmountRaw: 0n,
        },
      ],
    });

    const updated = (await swap.query(this.rpcUrl)) as ExactInQueryOutput;
    const expectedAmountOut = BigInt(updated.expectedAmountOut.amount);

    const slippage = Slippage.fromPercentage(((slippagePct * 100) as number).toString() as `${number}`);
    const deadline = 9007199254740991n; // use router sentinel max deadline

    const buildInput: SwapBuildCallInput = {
      slippage,
      deadline,
      queryOutput: updated,
      wethIsEth: false,
    };

    const callData = swap.buildCall(buildInput) as SwapBuildOutputExactIn;

    return {
      to: callData.to,
      callData: callData.callData,
      value: ethers.BigNumber.from(callData.value || '0').toHexString(),
      expectedAmountOut,
      minAmountOut: BigInt(callData.minAmountOut.amount),
      protocolVersion: swap.protocolVersion as 2 | 3,
    };
  }
}
