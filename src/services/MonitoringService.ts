import { ethers } from 'ethers';
import { BlockchainService } from './BlockchainService';
import { PoolMonitoringService } from './PoolMonitoringService';
import { ArbitrageExecutionService, ExecutionResult } from './ArbitrageExecutionService';
import { RiskManagementService } from './RiskManagementService';
import { ArbitrageOpportunity, SimulationResult } from '../types';

export interface Metrics {
  timestamp: number;
  systemHealth: {
    blockchain: boolean;
    contracts: boolean;
    network: boolean;
    overall: boolean;
  };
  performance: {
    uptime: number;
    totalExecutions: number;
    successfulExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    totalProfit: bigint;
    totalGasCost: bigint;
    netProfit: bigint;
  };
  pool: {
    imbalance: number;
    totalValueLocked: bigint;
    lastUpdated: number;
  };
  risk: {
    exposure: bigint;
    emergencyStop: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    safetyChecksPassed: number;
    safetyChecksFailed: number;
  };
}

export interface LogEntry {
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  component: string;
  message: string;
  data?: any;
}

export interface Alert {
  id: string;
  timestamp: number;
  type: 'SYSTEM' | 'PERFORMANCE' | 'RISK' | 'EXECUTION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  resolved: boolean;
  resolvedAt?: number;
}

export class MonitoringService {
  private blockchainService: BlockchainService;
  private poolMonitoringService: PoolMonitoringService;
  private executionService: ArbitrageExecutionService;
  private riskService: RiskManagementService;

  // Metrics tracking
  private startTime: number;
  private executionTimes: number[] = [];
  private totalProfit: bigint = 0n;
  private totalGasCost: bigint = 0n;
  private alerts: Map<string, Alert> = new Map();
  private logs: LogEntry[] = [];

  // Monitoring intervals
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private logCleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    blockchainService: BlockchainService,
    poolMonitoringService: PoolMonitoringService,
    executionService: ArbitrageExecutionService,
    riskService: RiskManagementService
  ) {
    this.blockchainService = blockchainService;
    this.poolMonitoringService = poolMonitoringService;
    this.executionService = executionService;
    this.riskService = riskService;
    this.startTime = Date.now();
  }

  async start(): Promise<void> {
    console.log('Starting monitoring service...');

    // Start health checks
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      30000 // Every 30 seconds
    );

    // Start metrics collection
    this.metricsInterval = setInterval(
      () => this.collectMetrics(),
      60000 // Every minute
    );

    // Start log cleanup
    this.logCleanupInterval = setInterval(
      () => this.cleanupOldLogs(),
      3600000 // Every hour
    );

    // Initial health check
    await this.performHealthChecks();
    
    // Initial metrics collection
    await this.collectMetrics();

    this.log('INFO', 'MONITORING', 'Monitoring service started successfully');
  }

  stop(): void {
    console.log('Stopping monitoring service...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.logCleanupInterval) {
      clearInterval(this.logCleanupInterval);
      this.logCleanupInterval = null;
    }

    this.log('INFO', 'MONITORING', 'Monitoring service stopped');
  }

  private async performHealthChecks(): Promise<void> {
    try {
      const [blockchainHealthy, poolHealthy, systemHealth] = await Promise.all([
        this.blockchainService.isHealthy(),
        this.poolMonitoringService.getPoolHealth(),
        this.riskService.getSystemHealth()
      ]);

      const overallHealth = blockchainHealthy && poolHealthy && systemHealth.healthy;

      // Check for health issues and create alerts
      if (!blockchainHealthy) {
        this.createAlert(
          'SYSTEM',
          'HIGH',
          'Blockchain Connection Issue',
          'Unable to connect to blockchain network'
        );
      }

      if (!poolHealthy) {
        this.createAlert(
          'SYSTEM',
          'HIGH',
          'Pool Health Issue',
          'Balancer pool is not responding properly'
        );
      }

      if (!systemHealth.healthy) {
        this.createAlert(
          'SYSTEM',
          'MEDIUM',
          'System Health Issues',
          `System health check failed: ${systemHealth.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`
        );
      }

      if (this.riskService.isEmergencyStopActive()) {
        this.createAlert(
          'RISK',
          'CRITICAL',
          'Emergency Stop Activated',
          'Emergency stop has been activated - no arbitrage executions will occur'
        );
      }

      this.log('DEBUG', 'HEALTH', `Health check completed - Overall: ${overallHealth ? 'HEALTHY' : 'UNHEALTHY'}`);

    } catch (error) {
      this.log('ERROR', 'HEALTH', `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.createAlert(
        'SYSTEM',
        'HIGH',
        'Health Check Failure',
        'Unable to perform system health checks'
      );
    }
  }

  private async collectMetrics(): Promise<void> {
    try {
      const metrics = await this.getCurrentMetrics();
      
      // Log metrics
      this.log('DEBUG', 'METRICS', 'Metrics collected', { metrics });

      // Check for performance issues
      if (metrics.performance.successRate < 0.8 && metrics.performance.totalExecutions > 5) {
        this.createAlert(
          'PERFORMANCE',
          'MEDIUM',
          'Low Success Rate',
          `Success rate is ${(metrics.performance.successRate * 100).toFixed(1)}%`
        );
      }

      if (metrics.performance.averageExecutionTime > 60000) { // Over 1 minute
        this.createAlert(
          'PERFORMANCE',
          'LOW',
          'Slow Execution Time',
          `Average execution time is ${(metrics.performance.averageExecutionTime / 1000).toFixed(1)}s`
        );
      }

      if (metrics.pool.imbalance > 3.0) {
        this.createAlert(
          'PERFORMANCE',
          'MEDIUM',
          'High Pool Imbalance',
          `Pool imbalance is ${metrics.pool.imbalance.toFixed(2)}%`
        );
      }

      if (metrics.risk.exposure > ethers.utils.parseEther('5').toBigInt()) {
        this.createAlert(
          'RISK',
          'HIGH',
          'High Exposure',
          `Current exposure is ${ethers.utils.formatEther(metrics.risk.exposure)} ETH`
        );
      }

    } catch (error) {
      this.log('ERROR', 'METRICS', `Metrics collection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getCurrentMetrics(): Promise<Metrics> {
    const [systemHealth, poolAnalytics, executionStats, riskLimits] = await Promise.all([
      this.getSystemHealth(),
      this.poolMonitoringService.getPoolAnalytics(),
      this.executionService.getExecutionStats(),
      this.riskService.getSystemHealth()
    ]);

    const uptime = Date.now() - this.startTime;
    const averageExecutionTime = this.executionTimes.length > 0 
      ? this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length 
      : 0;

    return {
      timestamp: Date.now(),
      systemHealth,
      performance: {
        uptime,
        totalExecutions: executionStats.totalExecutions,
        successfulExecutions: executionStats.successfulExecutions,
        successRate: executionStats.successRate / 100,
        averageExecutionTime,
        totalProfit: this.totalProfit,
        totalGasCost: this.totalGasCost,
        netProfit: this.totalProfit - this.totalGasCost
      },
      pool: {
        imbalance: poolAnalytics.imbalance,
        totalValueLocked: poolAnalytics.totalValueLocked,
        lastUpdated: poolAnalytics.lastUpdated
      },
      risk: {
        exposure: riskLimits.exposure,
        emergencyStop: riskLimits.emergencyStop,
        riskLevel: this.getCurrentRiskLevel(riskLimits),
        safetyChecksPassed: riskLimits.checks.filter(c => c.passed).length,
        safetyChecksFailed: riskLimits.checks.filter(c => !c.passed).length
      }
    };
  }

  private async getSystemHealth(): Promise<Metrics['systemHealth']> {
    const [blockchainHealthy, poolHealthy] = await Promise.all([
      this.blockchainService.isHealthy(),
      this.poolMonitoringService.getPoolHealth()
    ]);

    return {
      blockchain: blockchainHealthy,
      contracts: poolHealthy,
      network: blockchainHealthy, // Simplified - in practice would check network conditions
      overall: blockchainHealthy && poolHealthy
    };
  }

  private getCurrentRiskLevel(systemHealth: any): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (systemHealth.emergencyStop) return 'CRITICAL';
    if (!systemHealth.healthy) return 'HIGH';
    if (systemHealth.exposure > ethers.utils.parseEther('3').toBigInt()) return 'MEDIUM';
    return 'LOW';
  }

  // Event tracking methods
  trackExecution(result: ExecutionResult): void {
    if (result.success) {
      this.executionTimes.push(result.executionTime);
      this.totalProfit += result.profit || 0n;
      this.totalGasCost += result.gasCost || 0n;

      this.log('INFO', 'EXECUTION', 'Arbitrage executed successfully', {
        profit: result.profit?.toString(),
        gasCost: result.gasCost?.toString(),
        executionTime: result.executionTime,
        transactionHash: result.transactionHash
      });

      // Keep only last 100 execution times for average calculation
      if (this.executionTimes.length > 100) {
        this.executionTimes = this.executionTimes.slice(-100);
      }
    } else {
      this.log('ERROR', 'EXECUTION', 'Arbitrage execution failed', {
        error: result.error,
        executionTime: result.executionTime
      });

      this.createAlert(
        'EXECUTION',
        'MEDIUM',
        'Execution Failed',
        `Arbitrage execution failed: ${result.error}`
      );
    }
  }

  trackOpportunity(opportunity: ArbitrageOpportunity): void {
    this.log('INFO', 'OPPORTUNITY', 'Arbitrage opportunity detected', {
      poolAddress: opportunity.poolAddress,
      imbalance: opportunity.imbalance,
      expectedProfit: opportunity.expectedProfit.toString(),
      estimatedGas: opportunity.estimatedGas
    });
  }

  trackSimulation(result: SimulationResult): void {
    this.log('DEBUG', 'SIMULATION', 'Transaction simulation completed', {
      success: result.success,
      profit: result.profit?.toString(),
      gasCost: result.gasCost?.toString(),
      netProfit: result.netProfit?.toString(),
      error: result.error
    });
  }

  // Logging methods
  private log(level: LogEntry['level'], component: LogEntry['component'], message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      message,
      data
    };

    this.logs.push(entry);

    // Also log to console
    const timestamp = new Date(entry.timestamp).toISOString();
    const logMessage = `[${timestamp}] [${level}] [${component}] ${message}`;
    
    switch (level) {
      case 'ERROR':
        console.error(logMessage, data || '');
        break;
      case 'WARN':
        console.warn(logMessage, data || '');
        break;
      case 'DEBUG':
        console.debug(logMessage, data || '');
        break;
      default:
        console.log(logMessage, data || '');
    }
  }

  public logInfo(component: string, message: string, data?: any): void {
    this.log('INFO', component, message, data);
  }

  public logWarn(component: string, message: string, data?: any): void {
    this.log('WARN', component, message, data);
  }

  public logError(component: string, message: string, data?: any): void {
    this.log('ERROR', component, message, data);
  }

  public logDebug(component: string, message: string, data?: any): void {
    this.log('DEBUG', component, message, data);
  }

  // Alert management
  private createAlert(
    type: Alert['type'],
    severity: Alert['severity'],
    title: string,
    message: string
  ): void {
    const id = `${type}-${severity}-${Date.now()}`;
    const alert: Alert = {
      id,
      timestamp: Date.now(),
      type,
      severity,
      title,
      message,
      resolved: false
    };

    this.alerts.set(id, alert);
    this.log('WARN', 'ALERT', `Alert created: ${title}`, { alert });

    // In a real implementation, you might send notifications here
    // e.g., email, Slack, Discord, etc.
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      this.log('INFO', 'ALERT', `Alert resolved: ${alert.title}`, { alert });
    }
  }

  // Data retrieval methods
  getRecentLogs(limit: number = 100): LogEntry[] {
    return this.logs.slice(-limit);
  }

  getAlerts(includeResolved: boolean = false): Alert[] {
    const alerts = Array.from(this.alerts.values());
    return includeResolved ? alerts : alerts.filter(alert => !alert.resolved);
  }

  private cleanupOldLogs(): void {
    // Keep logs from last 7 days
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    this.logs = this.logs.filter(log => log.timestamp > oneWeekAgo);

    // Clean up resolved alerts older than 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [id, alert] of this.alerts) {
      if (alert.resolved && alert.resolvedAt && alert.resolvedAt < oneDayAgo) {
        this.alerts.delete(id);
      }
    }

    this.logDebug('MONITORING', 'Cleaned up old logs and alerts');
  }

  // Status reporting
  async getStatusReport(): Promise<{
    healthy: boolean;
    uptime: number;
    metrics: Metrics;
    recentAlerts: Alert[];
    recentLogs: LogEntry[];
  }> {
    const metrics = await this.getCurrentMetrics();
    const recentAlerts = this.getAlerts(false).slice(-10);
    const recentLogs = this.getRecentLogs(50);

    return {
      healthy: metrics.systemHealth.overall,
      uptime: metrics.performance.uptime,
      metrics,
      recentAlerts,
      recentLogs
    };
  }
}
