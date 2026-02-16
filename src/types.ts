// Type definitions for Feature Flag Impact Analyzer

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetEnvironment: 'development' | 'staging' | 'production';
  createdAt: string;
  updatedAt: string;
  tags: string[];
  owner: string;
}

export interface FlagChange {
  id: string;
  flagId: string;
  flagName: string;
  changeType: 'created' | 'enabled' | 'disabled' | 'rollout_changed' | 'deleted';
  previousValue: any;
  newValue: any;
  changedBy: string;
  changedAt: string;
  environment: string;
}

export interface ImpactMetrics {
  flagId: string;
  timestamp: string;
  errorRate: number;
  latencyP50: number;
  latencyP99: number;
  requestCount: number;
  conversionRate: number;
  userSatisfactionScore: number;
}

export interface ImpactPrediction {
  flagId: string;
  flagName: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  predictedImpact: {
    errorRateChange: number;
    latencyChange: number;
    userImpactPercentage: number;
  };
  recommendations: string[];
  reasoning: string;
  confidence: number;
  generatedAt: string;
}

export interface Anomaly {
  id: string;
  flagId: string;
  flagName: string;
  type: 'error_spike' | 'latency_spike' | 'conversion_drop' | 'rollback_recommended';
  severity: 'warning' | 'critical';
  detectedAt: string;
  metrics: ImpactMetrics;
  message: string;
  resolved: boolean;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    flagsDiscussed?: string[];
    predictionsReferenced?: string[];
    anomaliesReferenced?: string[];
  };
}

export interface AgentState {
  flags: Map<string, FeatureFlag>;
  changes: FlagChange[];
  metrics: Map<string, ImpactMetrics[]>;
  predictions: Map<string, ImpactPrediction>;
  anomalies: Anomaly[];
  conversations: ConversationMessage[];
  lastUpdated: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
}

export interface ChatResponse {
  message: string;
  sessionId: string;
  flagsAnalyzed?: string[];
  predictions?: ImpactPrediction[];
  anomalies?: Anomaly[];
}

export interface Env {
  FEATURE_FLAG_AGENT: DurableObjectNamespace;
  AI: Ai;
  FLAG_CACHE: KVNamespace;
  ENVIRONMENT: string;
}

// Workers AI types
export interface AiTextGenerationOutput {
  response?: string;
  tool_calls?: Array<{
    name: string;
    arguments: Record<string, any>;
  }>;
}
