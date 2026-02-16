// Feature Flag Impact Analyzer Agent - Durable Object
// Maintains state, handles WebSocket connections, and provides AI-powered analysis

import {
  FeatureFlag,
  FlagChange,
  ImpactMetrics,
  ImpactPrediction,
  Anomaly,
  ConversationMessage,
  Env,
  AiTextGenerationOutput,
} from './types';

export class FeatureFlagAgent implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<string, WebSocket> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    // Initialize SQLite tables
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Create tables for persistent storage
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER DEFAULT 0,
        rollout_percentage REAL DEFAULT 0,
        target_environment TEXT DEFAULT 'development',
        created_at TEXT,
        updated_at TEXT,
        tags TEXT,
        owner TEXT
      );

      CREATE TABLE IF NOT EXISTS flag_changes (
        id TEXT PRIMARY KEY,
        flag_id TEXT NOT NULL,
        flag_name TEXT,
        change_type TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        changed_by TEXT,
        changed_at TEXT,
        environment TEXT
      );

      CREATE TABLE IF NOT EXISTS impact_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        flag_id TEXT NOT NULL,
        timestamp TEXT,
        error_rate REAL,
        latency_p50 REAL,
        latency_p99 REAL,
        request_count INTEGER,
        conversion_rate REAL,
        user_satisfaction_score REAL
      );

      CREATE TABLE IF NOT EXISTS predictions (
        flag_id TEXT PRIMARY KEY,
        flag_name TEXT,
        risk_level TEXT,
        risk_score REAL,
        predicted_impact TEXT,
        recommendations TEXT,
        reasoning TEXT,
        confidence REAL,
        generated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS anomalies (
        id TEXT PRIMARY KEY,
        flag_id TEXT NOT NULL,
        flag_name TEXT,
        type TEXT,
        severity TEXT,
        detected_at TEXT,
        metrics TEXT,
        message TEXT,
        resolved INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_flag ON impact_metrics(flag_id);
      CREATE INDEX IF NOT EXISTS idx_changes_flag ON flag_changes(flag_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // REST API endpoints
    switch (url.pathname) {
      case '/flags':
        if (request.method === 'GET') return this.getFlags();
        if (request.method === 'POST') return this.createFlag(request);
        break;
      case '/flags/change':
        if (request.method === 'POST') return this.recordChange(request);
        break;
      case '/metrics':
        if (request.method === 'POST') return this.recordMetrics(request);
        break;
      case '/chat':
        if (request.method === 'POST') return this.handleChat(request);
        break;
      case '/analyze':
        if (request.method === 'POST') return this.analyzeFlag(request);
        break;
      case '/anomalies':
        if (request.method === 'GET') return this.getAnomalies();
        break;
      case '/predictions':
        if (request.method === 'GET') return this.getPredictions();
        break;
      case '/health':
        return new Response(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Not Found', { status: 404 });
  }

  // WebSocket handling for real-time updates
  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, server);

    server.accept();

    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        await this.handleWebSocketMessage(sessionId, server, data);
      } catch (error) {
        server.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    server.addEventListener('close', () => {
      this.sessions.delete(sessionId);
    });

    // Send welcome message
    server.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'Connected to Feature Flag Impact Analyzer'
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleWebSocketMessage(
    sessionId: string,
    socket: WebSocket,
    data: { type: string; payload?: any }
  ) {
    switch (data.type) {
      case 'chat':
        const response = await this.processChat(data.payload?.message || '', sessionId);
        socket.send(JSON.stringify({ type: 'chat_response', payload: response }));
        break;
      case 'subscribe_anomalies':
        // Client wants real-time anomaly updates
        socket.send(JSON.stringify({ 
          type: 'subscribed', 
          channel: 'anomalies',
          anomalies: this.getRecentAnomalies()
        }));
        break;
      case 'get_predictions':
        const predictions = this.getAllPredictions();
        socket.send(JSON.stringify({ type: 'predictions', payload: predictions }));
        break;
    }
  }

  // Broadcast to all connected clients
  private broadcast(message: object) {
    const payload = JSON.stringify(message);
    for (const socket of this.sessions.values()) {
      try {
        socket.send(payload);
      } catch (e) {
        // Socket may be closed
      }
    }
  }

  // Flag Management
  private async getFlags(): Promise<Response> {
    const flags = this.state.storage.sql.exec<FeatureFlag>(
      'SELECT * FROM feature_flags ORDER BY updated_at DESC'
    ).toArray();

    return new Response(JSON.stringify(flags), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async createFlag(request: Request): Promise<Response> {
    const flag: FeatureFlag = await request.json();
    flag.id = flag.id || crypto.randomUUID();
    flag.createdAt = new Date().toISOString();
    flag.updatedAt = flag.createdAt;

    this.state.storage.sql.exec(
      `INSERT INTO feature_flags (id, name, description, enabled, rollout_percentage, target_environment, created_at, updated_at, tags, owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      flag.id,
      flag.name,
      flag.description || '',
      flag.enabled ? 1 : 0,
      flag.rolloutPercentage || 0,
      flag.targetEnvironment || 'development',
      flag.createdAt,
      flag.updatedAt,
      JSON.stringify(flag.tags || []),
      flag.owner || 'system'
    );

    // Record the creation as a change
    await this.recordFlagChange({
      id: crypto.randomUUID(),
      flagId: flag.id,
      flagName: flag.name,
      changeType: 'created',
      previousValue: null,
      newValue: flag,
      changedBy: flag.owner || 'system',
      changedAt: flag.createdAt,
      environment: flag.targetEnvironment
    });

    this.broadcast({ type: 'flag_created', payload: flag });

    return new Response(JSON.stringify(flag), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async recordChange(request: Request): Promise<Response> {
    const change: FlagChange = await request.json();
    await this.recordFlagChange(change);

    // Trigger impact analysis
    const prediction = await this.generatePrediction(change);
    
    // Check for anomalies
    await this.detectAnomalies(change.flagId);

    this.broadcast({ 
      type: 'flag_changed', 
      payload: { change, prediction } 
    });

    return new Response(JSON.stringify({ change, prediction }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async recordFlagChange(change: FlagChange) {
    change.id = change.id || crypto.randomUUID();
    change.changedAt = change.changedAt || new Date().toISOString();

    this.state.storage.sql.exec(
      `INSERT INTO flag_changes (id, flag_id, flag_name, change_type, previous_value, new_value, changed_by, changed_at, environment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      change.id,
      change.flagId,
      change.flagName,
      change.changeType,
      JSON.stringify(change.previousValue),
      JSON.stringify(change.newValue),
      change.changedBy,
      change.changedAt,
      change.environment
    );
  }

  // Metrics Recording
  private async recordMetrics(request: Request): Promise<Response> {
    const metrics: ImpactMetrics = await request.json();
    metrics.timestamp = metrics.timestamp || new Date().toISOString();

    this.state.storage.sql.exec(
      `INSERT INTO impact_metrics (flag_id, timestamp, error_rate, latency_p50, latency_p99, request_count, conversion_rate, user_satisfaction_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      metrics.flagId,
      metrics.timestamp,
      metrics.errorRate,
      metrics.latencyP50,
      metrics.latencyP99,
      metrics.requestCount,
      metrics.conversionRate,
      metrics.userSatisfactionScore
    );

    // Check for anomalies after new metrics
    await this.detectAnomalies(metrics.flagId);

    return new Response(JSON.stringify({ success: true, metrics }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // AI-Powered Impact Prediction
  private async generatePrediction(change: FlagChange): Promise<ImpactPrediction> {
    // Get historical metrics for context
    const historicalMetrics = this.state.storage.sql.exec<ImpactMetrics>(
      `SELECT * FROM impact_metrics WHERE flag_id = ? ORDER BY timestamp DESC LIMIT 100`,
      change.flagId
    ).toArray();

    // Get recent changes for pattern analysis
    const recentChanges = this.state.storage.sql.exec<FlagChange>(
      `SELECT * FROM flag_changes WHERE flag_id = ? ORDER BY changed_at DESC LIMIT 20`,
      change.flagId
    ).toArray();

    const prompt = this.buildPredictionPrompt(change, historicalMetrics, recentChanges);

    try {
      const aiResponse = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          {
            role: 'system',
            content: `You are an expert feature flag impact analyzer. Analyze feature flag changes and predict their impact on system performance and user experience. 
            
            Respond in JSON format with this structure:
            {
              "riskLevel": "low" | "medium" | "high" | "critical",
              "riskScore": 0-100,
              "predictedImpact": {
                "errorRateChange": percentage change (can be negative),
                "latencyChange": percentage change in ms,
                "userImpactPercentage": percentage of users affected
              },
              "recommendations": ["recommendation 1", "recommendation 2"],
              "reasoning": "detailed explanation",
              "confidence": 0-1
            }`
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1024,
        temperature: 0.3
      }) as AiTextGenerationOutput;

      const responseText = aiResponse.response || '{}';
      
      // Parse AI response
      let parsedResponse;
      try {
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        parsedResponse = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch {
        parsedResponse = {
          riskLevel: 'medium',
          riskScore: 50,
          predictedImpact: { errorRateChange: 0, latencyChange: 0, userImpactPercentage: 0 },
          recommendations: ['Monitor closely after deployment'],
          reasoning: 'Unable to fully analyze - recommend manual review',
          confidence: 0.5
        };
      }

      const prediction: ImpactPrediction = {
        flagId: change.flagId,
        flagName: change.flagName,
        riskLevel: parsedResponse.riskLevel || 'medium',
        riskScore: parsedResponse.riskScore || 50,
        predictedImpact: parsedResponse.predictedImpact || {
          errorRateChange: 0,
          latencyChange: 0,
          userImpactPercentage: change.newValue?.rolloutPercentage || 0
        },
        recommendations: parsedResponse.recommendations || [],
        reasoning: parsedResponse.reasoning || '',
        confidence: parsedResponse.confidence || 0.7,
        generatedAt: new Date().toISOString()
      };

      // Store prediction
      this.state.storage.sql.exec(
        `INSERT OR REPLACE INTO predictions (flag_id, flag_name, risk_level, risk_score, predicted_impact, recommendations, reasoning, confidence, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        prediction.flagId,
        prediction.flagName,
        prediction.riskLevel,
        prediction.riskScore,
        JSON.stringify(prediction.predictedImpact),
        JSON.stringify(prediction.recommendations),
        prediction.reasoning,
        prediction.confidence,
        prediction.generatedAt
      );

      return prediction;
    } catch (error) {
      console.error('AI prediction error:', error);
      // Return default prediction on error
      return {
        flagId: change.flagId,
        flagName: change.flagName,
        riskLevel: 'medium',
        riskScore: 50,
        predictedImpact: {
          errorRateChange: 0,
          latencyChange: 0,
          userImpactPercentage: 0
        },
        recommendations: ['Manual review recommended due to analysis error'],
        reasoning: 'Automated analysis unavailable',
        confidence: 0.3,
        generatedAt: new Date().toISOString()
      };
    }
  }

  private buildPredictionPrompt(
    change: FlagChange,
    metrics: ImpactMetrics[],
    recentChanges: FlagChange[]
  ): string {
    const avgErrorRate = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.errorRate, 0) / metrics.length 
      : 0;
    const avgLatency = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.latencyP50, 0) / metrics.length 
      : 0;

    return `
Analyze this feature flag change and predict its impact:

## Flag Change Details
- Flag Name: ${change.flagName}
- Change Type: ${change.changeType}
- Previous Value: ${JSON.stringify(change.previousValue)}
- New Value: ${JSON.stringify(change.newValue)}
- Environment: ${change.environment}
- Changed By: ${change.changedBy}

## Historical Metrics (Last ${metrics.length} data points)
- Average Error Rate: ${avgErrorRate.toFixed(2)}%
- Average Latency (P50): ${avgLatency.toFixed(2)}ms
- Total Request Count: ${metrics.reduce((sum, m) => sum + m.requestCount, 0)}

## Recent Change History
${recentChanges.slice(0, 5).map(c => `- ${c.changeType} at ${c.changedAt}`).join('\n')}

Based on this information, predict the impact of this change on system performance and user experience.
Consider:
1. The type of change (enable/disable/rollout change)
2. Historical patterns and metrics
3. The target environment (${change.environment})
4. Rollout percentage impact

Provide your analysis in JSON format.
`;
  }

  // Anomaly Detection
  private async detectAnomalies(flagId: string) {
    const metrics = this.state.storage.sql.exec<ImpactMetrics>(
      `SELECT * FROM impact_metrics WHERE flag_id = ? ORDER BY timestamp DESC LIMIT 50`,
      flagId
    ).toArray();

    if (metrics.length < 5) return; // Need minimum data points

    const recent = metrics.slice(0, 5);
    const baseline = metrics.slice(5);

    if (baseline.length === 0) return;

    const avgBaselineError = baseline.reduce((sum, m) => sum + m.errorRate, 0) / baseline.length;
    const avgBaselineLatency = baseline.reduce((sum, m) => sum + m.latencyP50, 0) / baseline.length;
    const avgRecentError = recent.reduce((sum, m) => sum + m.errorRate, 0) / recent.length;
    const avgRecentLatency = recent.reduce((sum, m) => sum + m.latencyP50, 0) / recent.length;

    const flag = this.state.storage.sql.exec<FeatureFlag>(
      'SELECT * FROM feature_flags WHERE id = ?',
      flagId
    ).toArray()[0];

    const flagName = flag?.name || flagId;

    // Detect error spike (>50% increase)
    if (avgRecentError > avgBaselineError * 1.5 && avgRecentError > 1) {
      await this.createAnomaly({
        id: crypto.randomUUID(),
        flagId,
        flagName,
        type: 'error_spike',
        severity: avgRecentError > avgBaselineError * 2 ? 'critical' : 'warning',
        detectedAt: new Date().toISOString(),
        metrics: recent[0],
        message: `Error rate increased by ${((avgRecentError / avgBaselineError - 1) * 100).toFixed(1)}% since flag change`,
        resolved: false
      });
    }

    // Detect latency spike (>100% increase)
    if (avgRecentLatency > avgBaselineLatency * 2) {
      await this.createAnomaly({
        id: crypto.randomUUID(),
        flagId,
        flagName,
        type: 'latency_spike',
        severity: avgRecentLatency > avgBaselineLatency * 3 ? 'critical' : 'warning',
        detectedAt: new Date().toISOString(),
        metrics: recent[0],
        message: `P50 latency increased by ${((avgRecentLatency / avgBaselineLatency - 1) * 100).toFixed(1)}%`,
        resolved: false
      });
    }
  }

  private async createAnomaly(anomaly: Anomaly) {
    this.state.storage.sql.exec(
      `INSERT INTO anomalies (id, flag_id, flag_name, type, severity, detected_at, metrics, message, resolved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      anomaly.id,
      anomaly.flagId,
      anomaly.flagName,
      anomaly.type,
      anomaly.severity,
      anomaly.detectedAt,
      JSON.stringify(anomaly.metrics),
      anomaly.message,
      anomaly.resolved ? 1 : 0
    );

    // Broadcast anomaly to all connected clients
    this.broadcast({ type: 'anomaly_detected', payload: anomaly });
  }

  private getRecentAnomalies(): Anomaly[] {
    return this.state.storage.sql.exec<any>(
      'SELECT * FROM anomalies WHERE resolved = 0 ORDER BY detected_at DESC LIMIT 20'
    ).toArray().map(a => ({
      ...a,
      metrics: JSON.parse(a.metrics || '{}'),
      resolved: a.resolved === 1
    }));
  }

  private async getAnomalies(): Promise<Response> {
    const anomalies = this.getRecentAnomalies();
    return new Response(JSON.stringify(anomalies), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private getAllPredictions(): ImpactPrediction[] {
    return this.state.storage.sql.exec<any>(
      'SELECT * FROM predictions ORDER BY generated_at DESC'
    ).toArray().map(p => ({
      ...p,
      predictedImpact: JSON.parse(p.predicted_impact || '{}'),
      recommendations: JSON.parse(p.recommendations || '[]')
    }));
  }

  private async getPredictions(): Promise<Response> {
    const predictions = this.getAllPredictions();
    return new Response(JSON.stringify(predictions), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Chat Interface
  private async handleChat(request: Request): Promise<Response> {
    const { message, sessionId } = await request.json();
    const response = await this.processChat(message, sessionId || crypto.randomUUID());
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async processChat(message: string, sessionId: string): Promise<{
    message: string;
    sessionId: string;
    context?: any;
  }> {
    // Store user message
    const userMsgId = crypto.randomUUID();
    this.state.storage.sql.exec(
      `INSERT INTO conversations (id, session_id, role, content, timestamp, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userMsgId,
      sessionId,
      'user',
      message,
      new Date().toISOString(),
      '{}'
    );

    // Get conversation history for context
    const history = this.state.storage.sql.exec<ConversationMessage>(
      `SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp DESC LIMIT 10`,
      sessionId
    ).toArray().reverse();

    // Get current state for context
    const flags = this.state.storage.sql.exec<FeatureFlag>(
      'SELECT * FROM feature_flags'
    ).toArray();

    const predictions = this.getAllPredictions();
    const anomalies = this.getRecentAnomalies();

    const systemPrompt = `You are an AI assistant for Feature Flag Impact Analysis. You help users understand:
- Current feature flag states and their configurations
- Impact predictions for flag changes
- Active anomalies and recommended actions
- Historical patterns and insights

Current System State:
- Active Flags: ${flags.length}
- Flags: ${flags.map(f => `${f.name} (${f.enabled ? 'enabled' : 'disabled'}, ${f.rollout_percentage || f.rolloutPercentage || 0}% rollout)`).join(', ') || 'None'}
- Active Anomalies: ${anomalies.length}
- Recent Predictions: ${predictions.slice(0, 3).map(p => `${p.flag_name || p.flagName}: ${p.risk_level || p.riskLevel} risk`).join(', ') || 'None'}

${anomalies.length > 0 ? `\nActive Anomalies:\n${anomalies.map(a => `- ${a.flag_name || a.flagName}: ${a.message} (${a.severity})`).join('\n')}` : ''}

Be concise, helpful, and proactive in suggesting actions. If users ask about specific flags, provide detailed analysis.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content
      })),
      { role: 'user' as const, content: message }
    ];

    try {
      const aiResponse = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages,
        max_tokens: 512,
        temperature: 0.7
      }) as AiTextGenerationOutput;

      const assistantMessage = aiResponse.response || 'I apologize, but I encountered an issue processing your request. Please try again.';

      // Store assistant response
      const assistantMsgId = crypto.randomUUID();
      this.state.storage.sql.exec(
        `INSERT INTO conversations (id, session_id, role, content, timestamp, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        assistantMsgId,
        sessionId,
        'assistant',
        assistantMessage,
        new Date().toISOString(),
        JSON.stringify({ flagsDiscussed: flags.map(f => f.id) })
      );

      return {
        message: assistantMessage,
        sessionId,
        context: {
          flagCount: flags.length,
          anomalyCount: anomalies.length,
          predictionCount: predictions.length
        }
      };
    } catch (error) {
      console.error('Chat processing error:', error);
      return {
        message: 'I encountered an error processing your request. Please try again.',
        sessionId
      };
    }
  }

  // Manual Analysis Trigger
  private async analyzeFlag(request: Request): Promise<Response> {
    const { flagId } = await request.json();
    
    const flag = this.state.storage.sql.exec<FeatureFlag>(
      'SELECT * FROM feature_flags WHERE id = ?',
      flagId
    ).toArray()[0];

    if (!flag) {
      return new Response(JSON.stringify({ error: 'Flag not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create a synthetic change to trigger analysis
    const change: FlagChange = {
      id: crypto.randomUUID(),
      flagId: flag.id,
      flagName: flag.name,
      changeType: 'enabled',
      previousValue: null,
      newValue: flag,
      changedBy: 'manual_analysis',
      changedAt: new Date().toISOString(),
      environment: flag.target_environment || flag.targetEnvironment || 'development'
    };

    const prediction = await this.generatePrediction(change);
    await this.detectAnomalies(flagId);

    return new Response(JSON.stringify({ flag, prediction }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
