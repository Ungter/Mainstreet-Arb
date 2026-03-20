import { ethers } from 'ethers';
import { BlockchainService } from './services/BlockchainService';
import { PoolMonitoringService } from './services/PoolMonitoringService';
import { TransactionSimulationService } from './services/TransactionSimulationService';
import { ArbitrageExecutionService } from './services/ArbitrageExecutionService';
import { RiskManagementService } from './services/RiskManagementService';
import { MonitoringService } from './services/MonitoringService';
import { getConfig, validateConfig, getConfigSummary } from './config';
import { ArbitrageOpportunity } from './types';

export class ArbitrageBot {
  private blockchainService: BlockchainService;
  private poolMonitoringService: PoolMonitoringService;
  private simulationService: TransactionSimulationService;
  private executionService: ArbitrageExecutionService;
  private riskService: RiskManagementService;
  private monitoringService: MonitoringService;
  private config = getConfig();

  private isRunning: boolean = false;
  private monitoringActive: boolean = false;
  private executionInProgress: boolean = false;

  constructor() {
    console.log('🤖 Initializing Arbitrage Bot...');
    
    // Initialize all services
    this.blockchainService = new BlockchainService(this.config);
    this.poolMonitoringService = new PoolMonitoringService(
      this.blockchainService,
      this.config.poolAddress
    );
    this.simulationService = new TransactionSimulationService(
      this.blockchainService,
      this.config
    );
    this.executionService = new ArbitrageExecutionService(
      this.blockchainService,
      this.simulationService,
      this.config
    );
    this.riskService = new RiskManagementService(
    );
    this.monitoringService = new MonitoringService(
      this.blockchainService,
      this.poolMonitoringService,
      this.executionService,
      this.riskService
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Bot is already running');
      return;
    }

    try {
      console.log('🚀 Starting Arbitrage Bot...');
      
      // Validate configuration
      const validation = validateConfig();
      if (!validation.isValid) {
        throw new Error(`Configuration validation failed:\n${validation.errors.join('\n')}`);
      }

      // Display configuration summary
      const configSummary = getConfigSummary();
      console.log('📋 Configuration Summary:');
      console.log(`   Network: ${configSummary.network}`);
      console.log(`   Pool: ${configSummary.contracts.pool}`);
      console.log(`   Minter: ${configSummary.contracts.minter}`);
      console.log(`   Vault: ${configSummary.contracts.vault}`);
      console.log(`   Check Interval: ${configSummary.settings.checkInterval}ms`);
      console.log(`   Min Profit Threshold: ${configSummary.settings.minProfitThreshold} wei`);
      console.log(`   Max Gas Price: ${configSummary.settings.maxGasPrice} wei`);

      // Initialize services
      console.log('🔧 Initializing services...');
      
      // Initialize pool monitoring first
      await this.poolMonitoringService.initialize();
      this.monitoringService.logInfo('BOT', 'Pool monitoring service initialized');

      // Start monitoring service after pool is ready
      await this.monitoringService.start();
      this.monitoringService.logInfo('BOT', 'Monitoring service started');

      // Test blockchain connection
      const blockchainHealthy = await this.blockchainService.isHealthy();
      if (!blockchainHealthy) {
        throw new Error('Blockchain connection failed');
      }

      const walletAddress = await this.blockchainService.getAddress();
      console.log(`👛 Wallet Address: ${walletAddress}`);

      const nativeBalance = await this.blockchainService.getBalance();
      const usdcTokenBalance = await this.blockchainService.getTokenBalance(this.config.usdcAddress, walletAddress);
      console.log(`💰 Native Balance: ${ethers.utils.formatEther(nativeBalance)} S`);
      console.log(`💵 USDC Balance: ${ethers.utils.formatUnits(usdcTokenBalance, 6)} USDC`);

      this.isRunning = true;
      console.log('✅ Arbitrage Bot started successfully');

      // Start the main monitoring loop
      this.startMonitoringLoop();

    } catch (error) {
      console.error('❌ Failed to start Arbitrage Bot:', error);
      this.monitoringService.logError('BOT', `Failed to start bot: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️  Bot is not running');
      return;
    }

    try {
      console.log('🛑 Stopping Arbitrage Bot...');

      this.isRunning = false;
      this.monitoringActive = false;

      // Stop monitoring
      this.poolMonitoringService.stopMonitoring();
      this.monitoringService.logInfo('BOT', 'Pool monitoring stopped');

      // Stop monitoring service
      this.monitoringService.stop();
      this.monitoringService.logInfo('BOT', 'Monitoring service stopped');

      // Wait for any in-progress execution to complete
      if (this.executionInProgress) {
        console.log('⏳ Waiting for current execution to complete...');
        await this.waitForExecutionCompletion();
      }

      console.log('✅ Arbitrage Bot stopped successfully');

    } catch (error) {
      console.error('❌ Error stopping bot:', error);
      this.monitoringService.logError('BOT', `Error stopping bot: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private startMonitoringLoop(): void {
    if (!this.isRunning) return;

    this.monitoringActive = true;
    console.log(`🔍 Starting monitoring loop (checking every ${this.config.checkInterval}ms)...`);

    const monitor = async () => {
      if (!this.isRunning || !this.monitoringActive) {
        return;
      }

      try {
        await this.checkForArbitrageOpportunity();
      } catch (error) {
        console.error('Error in monitoring loop:', error);
        this.monitoringService.logError('BOT', `Monitoring loop error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Schedule next check
      if (this.isRunning && this.monitoringActive) {
        setTimeout(monitor, this.config.checkInterval);
      }
    };

    // Start the monitoring loop
    setTimeout(monitor, this.config.checkInterval);
  }

  private async checkForArbitrageOpportunity(): Promise<void> {
    if (this.executionInProgress) {
      this.monitoringService.logDebug('BOT', 'Skipping check - execution in progress');
      return;
    }

    try {
      // Check for arbitrage opportunity
      const opportunity = await this.poolMonitoringService.checkForArbitrageOpportunity(0.5); // 0.5% threshold

      if (opportunity) {
        this.monitoringService.trackOpportunity(opportunity);
        console.log('🎯 Arbitrage opportunity detected!');
        console.log(`   Pool: ${opportunity.poolAddress}`);
        console.log(`   Imbalance: ${opportunity.imbalance.toFixed(2)}%`);
        console.log(`   Expected Profit: ${opportunity.expectedProfit.toString()} wei`);
        console.log(`   Estimated Gas: ${opportunity.estimatedGas}`);

        // Process the opportunity
        await this.processArbitrageOpportunity(opportunity);
      } else {
        this.monitoringService.logDebug('BOT', 'No arbitrage opportunity detected');
      }

    } catch (error) {
      console.error('Error checking for arbitrage opportunity:', error);
      this.monitoringService.logError('BOT', `Error checking opportunity: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async processArbitrageOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
    if (this.executionInProgress) {
      this.monitoringService.logWarn('BOT', 'Execution already in progress - skipping opportunity');
      return;
    }

    this.executionInProgress = true;
    const startTime = Date.now();

    try {
      this.monitoringService.logInfo('BOT', 'Processing arbitrage opportunity');

      // Step 1: Simulate the arbitrage
      this.monitoringService.logDebug('BOT', 'Running transaction simulation...');
      const walletAddressSim = await this.blockchainService.getAddress();
      const usdcBalBN = await this.blockchainService.getTokenBalance(this.config.usdcAddress, walletAddressSim);
      const usdcAmount = usdcBalBN.toBigInt();
      if (usdcAmount < ethers.utils.parseUnits('10', 6).toBigInt()) {
        throw new Error('Insufficient USDC balance for simulation (min 10 USDC)');
      }
      const simulationResult = await this.simulationService.simulateFullArbitrageCycle(usdcAmount);

      this.monitoringService.trackSimulation(simulationResult);

      if (!simulationResult.success) {
        throw new Error(`Simulation failed: ${simulationResult.error}`);
      }

      console.log('📊 Simulation Results:');
      console.log(`   Profit: ${simulationResult.profit?.toString() || 'N/A'} USDC units`);
      console.log(`   Gas Cost: ${simulationResult.gasCost?.toString() || 'N/A'} USDC units`);
      console.log(`   Net Profit: ${simulationResult.netProfit?.toString() || 'N/A'} USDC units`);

      // Step 2: Execute if gross profit is positive (risk assessment disabled)
      if (simulationResult.success && simulationResult.profit && simulationResult.profit > 0n) {
        console.log('💰 Executing arbitrage (gross profit positive)...');

        const executionAmount = usdcAmount;

        const executionResult = await this.executionService.executeArbitrage(
          opportunity,
          executionAmount
        );

        // Track execution with monitoring service
        this.monitoringService.trackExecution(executionResult);

        if (executionResult.success) {
          console.log('✅ Arbitrage executed successfully!');
          console.log(`   Transaction Hash: ${executionResult.transactionHash}`);
          console.log(`   Execution Time: ${executionResult.executionTime}ms`);
          console.log(`   Profit: ${executionResult.profit?.toString() || 'N/A'} wei`);
          console.log(`   Net Profit: ${executionResult.netProfit?.toString() || 'N/A'} wei`);
        } else {
          console.log('❌ Arbitrage execution failed!');
          console.log(`   Error: ${executionResult.error}`);
        }
      } else {
        console.log('⏭️  Skipping arbitrage - gross profit not positive');
      }

    } catch (error) {
      console.error('❌ Error processing arbitrage opportunity:', error);
      this.monitoringService.logError('BOT', `Error processing opportunity: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.executionInProgress = false;
      const executionTime = Date.now() - startTime;
      this.monitoringService.logDebug('BOT', `Opportunity processing completed in ${executionTime}ms`);
    }
  }

  private async waitForExecutionCompletion(): Promise<void> {
    const maxWaitTime = 300000; // 5 minutes
    const waitInterval = 1000; // 1 second
    const startTime = Date.now();

    while (this.executionInProgress && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, waitInterval));
    }

    if (this.executionInProgress) {
      console.warn('⚠️  Execution did not complete within timeout period');
      this.monitoringService.logWarn('BOT', 'Execution timeout - forcing stop');
    }
  }

  // Public methods for bot control and status
  isBotRunning(): boolean {
    return this.isRunning;
  }

  isExecutionInProgress(): boolean {
    return this.executionInProgress;
  }

  async getStatus(): Promise<{
    running: boolean;
    executionInProgress: boolean;
    config: any;
    health: any;
    metrics: any;
  }> {
    const statusReport = await this.monitoringService.getStatusReport();
    const configSummary = getConfigSummary();

    return {
      running: this.isRunning,
      executionInProgress: this.executionInProgress,
      config: configSummary,
      health: statusReport.healthy,
      metrics: statusReport.metrics
    };
  }

  async emergencyStop(): Promise<void> {
    console.log('🚨 EMERGENCY STOP ACTIVATED!');
    
    this.riskService.activateEmergencyStop();
    this.monitoringService.logWarn('BOT', 'Emergency stop activated manually');

    // Stop monitoring but allow current execution to complete
    this.monitoringActive = false;
    this.poolMonitoringService.stopMonitoring();

    console.log('🛑 Emergency stop completed - monitoring halted');
  }

  async resume(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Bot is not running');
    }

    console.log('▶️  Resuming bot operations...');

    this.riskService.deactivateEmergencyStop();
    this.monitoringService.resolveAlert('SYSTEM-CRITICAL-Emergency Stop Activated');

    // Restart monitoring
    this.startMonitoringLoop();

    console.log('✅ Bot operations resumed');
  }
}

// Main execution function
async function main() {
  const bot = new ArbitrageBot();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n📡 Received ${signal} - Shutting down gracefully...`);
    try {
      await bot.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Set up signal handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
  });

  // Start the bot
  try {
    await bot.start();
    
    // Keep the process running
    console.log('🤖 Bot is running. Press Ctrl+C to stop.');
    
    // Set up a simple status check interval
    setInterval(async () => {
      if (bot.isBotRunning()) {
        const status = await bot.getStatus();
        console.log(`📊 Status - Running: ${status.running}, Healthy: ${status.health}, Executions: ${status.metrics.performance.totalExecutions}, Success Rate: ${(status.metrics.performance.successRate * 100).toFixed(1)}%`);
      }
    }, 60000); // Every minute

  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch(console.error);
}
