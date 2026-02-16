// Main Worker Entry Point
// Routes requests to the Feature Flag Agent Durable Object

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';

// Re-export the Durable Object class
export { FeatureFlagAgent } from './agent';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for frontend
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'Feature Flag Impact Analyzer',
    version: '1.0.0',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      api: '/api/*',
      chat: '/api/chat',
      flags: '/api/flags',
      websocket: '/ws',
      ui: '/ui'
    }
  });
});

// Get or create agent instance
function getAgent(c: any, agentId: string = 'default') {
  const id = c.env.FEATURE_FLAG_AGENT.idFromName(agentId);
  return c.env.FEATURE_FLAG_AGENT.get(id);
}

// API Routes - proxy to Durable Object
app.all('/api/*', async (c) => {
  const agent = getAgent(c);
  const url = new URL(c.req.url);
  
  // Rewrite path: /api/flags -> /flags
  const newPath = url.pathname.replace('/api', '');
  const newUrl = new URL(newPath, url.origin);
  newUrl.search = url.search;

  // Create new request for the agent
  const agentRequest = new Request(newUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' 
      ? await c.req.raw.clone().arrayBuffer() 
      : undefined,
  });

  return agent.fetch(agentRequest);
});

// WebSocket endpoint
app.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426);
  }

  const agent = getAgent(c);
  return agent.fetch(c.req.raw);
});

// Serve static UI
app.get('/ui', (c) => {
  return c.html(getUIHTML());
});

app.get('/ui/*', (c) => {
  return c.html(getUIHTML());
});

// UI HTML
function getUIHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Feature Flag Impact Analyzer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .animate-pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
    .chat-container { height: calc(100vh - 200px); }
    .scrollbar-thin::-webkit-scrollbar { width: 6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #4B5563; border-radius: 3px; }
  </style>
</head>
<body class="bg-gray-900 text-gray-100 min-h-screen">
  <div id="app" class="flex h-screen">
    <!-- Sidebar -->
    <aside class="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div class="p-4 border-b border-gray-700">
        <h1 class="text-xl font-bold text-blue-400 flex items-center gap-2">
          <i data-lucide="flag" class="w-6 h-6"></i>
          Flag Analyzer
        </h1>
        <p class="text-xs text-gray-400 mt-1">AI-Powered Impact Analysis</p>
      </div>
      
      <nav class="flex-1 p-4 space-y-2">
        <button onclick="showSection('dashboard')" class="nav-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition">
          <i data-lucide="layout-dashboard" class="w-4 h-4"></i>
          Dashboard
        </button>
        <button onclick="showSection('flags')" class="nav-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700 transition">
          <i data-lucide="toggle-right" class="w-4 h-4"></i>
          Feature Flags
        </button>
        <button onclick="showSection('chat')" class="nav-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700 transition">
          <i data-lucide="message-square" class="w-4 h-4"></i>
          AI Chat
        </button>
        <button onclick="showSection('anomalies')" class="nav-btn w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700 transition">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i>
          Anomalies
          <span id="anomaly-badge" class="ml-auto bg-red-500 text-xs px-2 py-0.5 rounded-full hidden">0</span>
        </button>
      </nav>
      
      <div class="p-4 border-t border-gray-700">
        <div id="connection-status" class="flex items-center gap-2 text-sm">
          <span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse-dot"></span>
          <span class="text-gray-400">Connecting...</span>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-hidden flex flex-col">
      <!-- Dashboard Section -->
      <section id="dashboard-section" class="flex-1 p-6 overflow-auto">
        <h2 class="text-2xl font-bold mb-6">Dashboard</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div class="flex items-center justify-between">
              <span class="text-gray-400">Active Flags</span>
              <i data-lucide="flag" class="w-5 h-5 text-blue-400"></i>
            </div>
            <p id="stat-flags" class="text-3xl font-bold mt-2">0</p>
          </div>
          <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div class="flex items-center justify-between">
              <span class="text-gray-400">Active Anomalies</span>
              <i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>
            </div>
            <p id="stat-anomalies" class="text-3xl font-bold mt-2">0</p>
          </div>
          <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div class="flex items-center justify-between">
              <span class="text-gray-400">Predictions</span>
              <i data-lucide="brain" class="w-5 h-5 text-purple-400"></i>
            </div>
            <p id="stat-predictions" class="text-3xl font-bold mt-2">0</p>
          </div>
        </div>
        
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <h3 class="font-semibold mb-4 flex items-center gap-2">
              <i data-lucide="activity" class="w-4 h-4 text-green-400"></i>
              Recent Predictions
            </h3>
            <div id="recent-predictions" class="space-y-3">
              <p class="text-gray-500 text-sm">No predictions yet</p>
            </div>
          </div>
          
          <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <h3 class="font-semibold mb-4 flex items-center gap-2">
              <i data-lucide="alert-triangle" class="w-4 h-4 text-yellow-400"></i>
              Recent Anomalies
            </h3>
            <div id="recent-anomalies" class="space-y-3">
              <p class="text-gray-500 text-sm">No anomalies detected</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Flags Section -->
      <section id="flags-section" class="flex-1 p-6 overflow-auto hidden">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Feature Flags</h2>
          <button onclick="showCreateFlagModal()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg flex items-center gap-2 transition">
            <i data-lucide="plus" class="w-4 h-4"></i>
            Create Flag
          </button>
        </div>
        
        <div id="flags-list" class="space-y-4">
          <p class="text-gray-500">No flags created yet</p>
        </div>
      </section>

      <!-- Chat Section -->
      <section id="chat-section" class="flex-1 flex flex-col hidden">
        <div class="p-4 border-b border-gray-700">
          <h2 class="text-xl font-bold flex items-center gap-2">
            <i data-lucide="bot" class="w-5 h-5 text-purple-400"></i>
            AI Assistant
          </h2>
          <p class="text-sm text-gray-400">Ask about flags, predictions, and anomalies</p>
        </div>
        
        <div id="chat-messages" class="flex-1 p-4 overflow-auto scrollbar-thin space-y-4">
          <div class="flex gap-3">
            <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
              <i data-lucide="bot" class="w-4 h-4"></i>
            </div>
            <div class="bg-gray-800 rounded-lg p-3 max-w-[80%]">
              <p>Hello! I'm your Feature Flag Impact Analyzer assistant. I can help you understand your feature flags, predict the impact of changes, and alert you to anomalies. How can I help you today?</p>
            </div>
          </div>
        </div>
        
        <div class="p-4 border-t border-gray-700">
          <form id="chat-form" class="flex gap-2">
            <input type="text" id="chat-input" 
              class="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              placeholder="Ask about your feature flags..."
            >
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition">
              <i data-lucide="send" class="w-4 h-4"></i>
            </button>
          </form>
        </div>
      </section>

      <!-- Anomalies Section -->
      <section id="anomalies-section" class="flex-1 p-6 overflow-auto hidden">
        <h2 class="text-2xl font-bold mb-6">Active Anomalies</h2>
        <div id="anomalies-list" class="space-y-4">
          <p class="text-gray-500">No anomalies detected</p>
        </div>
      </section>
    </main>
  </div>

  <!-- Create Flag Modal -->
  <div id="create-flag-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center hidden z-50">
    <div class="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700">
      <h3 class="text-xl font-bold mb-4">Create Feature Flag</h3>
      <form id="create-flag-form" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Name</label>
          <input type="text" name="name" required 
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Description</label>
          <textarea name="description" rows="2"
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Environment</label>
            <select name="environment" 
              class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Rollout %</label>
            <input type="number" name="rollout" value="0" min="0" max="100"
              class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
          </div>
        </div>
        <div class="flex items-center gap-2">
          <input type="checkbox" name="enabled" id="flag-enabled" class="rounded">
          <label for="flag-enabled" class="text-sm">Enable flag</label>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button type="button" onclick="hideCreateFlagModal()" 
            class="px-4 py-2 rounded-lg border border-gray-600 hover:bg-gray-700 transition">
            Cancel
          </button>
          <button type="submit" 
            class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition">
            Create Flag
          </button>
        </div>
      </form>
    </div>
  </div>

  <script>
    // Initialize Lucide icons
    lucide.createIcons();

    // State
    let ws = null;
    let sessionId = null;
    let flags = [];
    let anomalies = [];
    let predictions = [];

    // WebSocket connection
    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host + '/ws');
      
      ws.onopen = () => {
        updateConnectionStatus(true);
        console.log('WebSocket connected');
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      };
      
      ws.onclose = () => {
        updateConnectionStatus(false);
        setTimeout(connectWebSocket, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    }

    function handleWebSocketMessage(data) {
      switch (data.type) {
        case 'connected':
          sessionId = data.sessionId;
          break;
        case 'chat_response':
          addChatMessage('assistant', data.payload.message);
          break;
        case 'flag_created':
        case 'flag_changed':
          loadFlags();
          loadPredictions();
          break;
        case 'anomaly_detected':
          anomalies.unshift(data.payload);
          updateAnomalyBadge();
          renderAnomalies();
          showNotification('Anomaly Detected', data.payload.message, 'warning');
          break;
        case 'predictions':
          predictions = data.payload;
          renderPredictions();
          break;
      }
    }

    function updateConnectionStatus(connected) {
      const status = document.getElementById('connection-status');
      status.innerHTML = connected 
        ? '<span class="w-2 h-2 rounded-full bg-green-500"></span><span class="text-gray-400">Connected</span>'
        : '<span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse-dot"></span><span class="text-gray-400">Connecting...</span>';
    }

    // Navigation
    function showSection(section) {
      document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
      document.getElementById(section + '-section').classList.remove('hidden');
      
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('bg-gray-700'));
      event.currentTarget.classList.add('bg-gray-700');
    }

    // API calls
    async function loadFlags() {
      try {
        const response = await fetch('/api/flags');
        flags = await response.json();
        renderFlags();
        document.getElementById('stat-flags').textContent = flags.length;
      } catch (error) {
        console.error('Error loading flags:', error);
      }
    }

    async function loadAnomalies() {
      try {
        const response = await fetch('/api/anomalies');
        anomalies = await response.json();
        renderAnomalies();
        updateAnomalyBadge();
        document.getElementById('stat-anomalies').textContent = anomalies.length;
      } catch (error) {
        console.error('Error loading anomalies:', error);
      }
    }

    async function loadPredictions() {
      try {
        const response = await fetch('/api/predictions');
        predictions = await response.json();
        renderPredictions();
        document.getElementById('stat-predictions').textContent = predictions.length;
      } catch (error) {
        console.error('Error loading predictions:', error);
      }
    }

    async function createFlag(flagData) {
      try {
        const response = await fetch('/api/flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(flagData)
        });
        const flag = await response.json();
        await loadFlags();
        hideCreateFlagModal();
        showNotification('Success', 'Flag created: ' + flag.name, 'success');
      } catch (error) {
        console.error('Error creating flag:', error);
        showNotification('Error', 'Failed to create flag', 'error');
      }
    }

    async function simulateFlagChange(flagId, changeType, newValue) {
      try {
        const flag = flags.find(f => f.id === flagId);
        await fetch('/api/flags/change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flagId,
            flagName: flag.name,
            changeType,
            previousValue: flag,
            newValue: { ...flag, ...newValue },
            changedBy: 'user',
            environment: flag.target_environment || flag.targetEnvironment
          })
        });
        await loadFlags();
        await loadPredictions();
      } catch (error) {
        console.error('Error updating flag:', error);
      }
    }

    async function simulateMetrics(flagId) {
      // Simulate some metrics for demo
      const metrics = {
        flagId,
        errorRate: Math.random() * 5,
        latencyP50: 50 + Math.random() * 100,
        latencyP99: 200 + Math.random() * 300,
        requestCount: Math.floor(Math.random() * 10000),
        conversionRate: 2 + Math.random() * 3,
        userSatisfactionScore: 3.5 + Math.random() * 1.5
      };
      
      await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metrics)
      });
    }

    // Render functions
    function renderFlags() {
      const container = document.getElementById('flags-list');
      if (flags.length === 0) {
        container.innerHTML = '<p class="text-gray-500">No flags created yet</p>';
        return;
      }
      
      container.innerHTML = flags.map(flag => \`
        <div class="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-3 h-3 rounded-full \${flag.enabled ? 'bg-green-500' : 'bg-gray-500'}"></span>
              <h3 class="font-semibold">\${flag.name}</h3>
              <span class="text-xs px-2 py-0.5 rounded bg-gray-700">\${flag.target_environment || flag.targetEnvironment || 'development'}</span>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="simulateMetrics('\${flag.id}')" 
                class="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition">
                Simulate Metrics
              </button>
              <button onclick="simulateFlagChange('\${flag.id}', '\${flag.enabled ? 'disabled' : 'enabled'}', { enabled: \${!flag.enabled} })" 
                class="text-xs px-2 py-1 rounded \${flag.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} transition">
                \${flag.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
          <p class="text-sm text-gray-400 mb-3">\${flag.description || 'No description'}</p>
          <div class="flex items-center gap-4 text-sm">
            <span class="text-gray-400">Rollout: <span class="text-white">\${flag.rollout_percentage || flag.rolloutPercentage || 0}%</span></span>
            <span class="text-gray-400">Owner: <span class="text-white">\${flag.owner || 'system'}</span></span>
          </div>
        </div>
      \`).join('');
    }

    function renderAnomalies() {
      const listContainer = document.getElementById('anomalies-list');
      const recentContainer = document.getElementById('recent-anomalies');
      
      if (anomalies.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500">No anomalies detected</p>';
        recentContainer.innerHTML = '<p class="text-gray-500 text-sm">No anomalies detected</p>';
        return;
      }
      
      const renderAnomaly = (a) => \`
        <div class="bg-gray-700/50 rounded-lg p-3 border-l-4 \${a.severity === 'critical' ? 'border-red-500' : 'border-yellow-500'}">
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium">\${a.flag_name || a.flagName}</span>
            <span class="text-xs px-2 py-0.5 rounded \${a.severity === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}">\${a.severity}</span>
          </div>
          <p class="text-sm text-gray-300">\${a.message}</p>
          <p class="text-xs text-gray-500 mt-1">\${new Date(a.detected_at || a.detectedAt).toLocaleString()}</p>
        </div>
      \`;
      
      listContainer.innerHTML = anomalies.map(renderAnomaly).join('');
      recentContainer.innerHTML = anomalies.slice(0, 3).map(renderAnomaly).join('');
    }

    function renderPredictions() {
      const container = document.getElementById('recent-predictions');
      
      if (predictions.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-sm">No predictions yet</p>';
        return;
      }
      
      const riskColors = {
        low: 'bg-green-500/20 text-green-400 border-green-500',
        medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500',
        high: 'bg-orange-500/20 text-orange-400 border-orange-500',
        critical: 'bg-red-500/20 text-red-400 border-red-500'
      };
      
      container.innerHTML = predictions.slice(0, 5).map(p => {
        const risk = p.risk_level || p.riskLevel || 'medium';
        return \`
          <div class="bg-gray-700/50 rounded-lg p-3 border-l-4 \${riskColors[risk].split(' ')[2]}">
            <div class="flex items-center justify-between mb-1">
              <span class="font-medium">\${p.flag_name || p.flagName}</span>
              <span class="text-xs px-2 py-0.5 rounded \${riskColors[risk].split(' ').slice(0, 2).join(' ')}">\${risk} risk</span>
            </div>
            <p class="text-sm text-gray-300">\${(p.reasoning || '').substring(0, 100)}...</p>
            <p class="text-xs text-gray-500 mt-1">Confidence: \${Math.round((p.confidence || 0.7) * 100)}%</p>
          </div>
        \`;
      }).join('');
    }

    function updateAnomalyBadge() {
      const badge = document.getElementById('anomaly-badge');
      if (anomalies.length > 0) {
        badge.textContent = anomalies.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    // Chat functions
    function addChatMessage(role, content) {
      const container = document.getElementById('chat-messages');
      const isUser = role === 'user';
      
      const messageHTML = \`
        <div class="flex gap-3 \${isUser ? 'flex-row-reverse' : ''}">
          <div class="w-8 h-8 rounded-full \${isUser ? 'bg-blue-600' : 'bg-purple-600'} flex items-center justify-center flex-shrink-0">
            <i data-lucide="\${isUser ? 'user' : 'bot'}" class="w-4 h-4"></i>
          </div>
          <div class="\${isUser ? 'bg-blue-600' : 'bg-gray-800'} rounded-lg p-3 max-w-[80%]">
            <p>\${content}</p>
          </div>
        </div>
      \`;
      
      container.insertAdjacentHTML('beforeend', messageHTML);
      container.scrollTop = container.scrollHeight;
      lucide.createIcons();
    }

    async function sendChatMessage(message) {
      addChatMessage('user', message);
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', payload: { message } }));
      } else {
        // Fallback to REST API
        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId })
          });
          const data = await response.json();
          sessionId = data.sessionId;
          addChatMessage('assistant', data.message);
        } catch (error) {
          addChatMessage('assistant', 'Sorry, I encountered an error. Please try again.');
        }
      }
    }

    // Modal functions
    function showCreateFlagModal() {
      document.getElementById('create-flag-modal').classList.remove('hidden');
    }

    function hideCreateFlagModal() {
      document.getElementById('create-flag-modal').classList.add('hidden');
      document.getElementById('create-flag-form').reset();
    }

    // Notification
    function showNotification(title, message, type = 'info') {
      // Simple console notification for now
      console.log(\`[\${type.toUpperCase()}] \${title}: \${message}\`);
    }

    // Event listeners
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const message = input.value.trim();
      if (message) {
        sendChatMessage(message);
        input.value = '';
      }
    });

    document.getElementById('create-flag-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      createFlag({
        name: formData.get('name'),
        description: formData.get('description'),
        targetEnvironment: formData.get('environment'),
        rolloutPercentage: parseInt(formData.get('rollout')) || 0,
        enabled: formData.get('enabled') === 'on',
        owner: 'user',
        tags: []
      });
    });

    // Close modal on outside click
    document.getElementById('create-flag-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideCreateFlagModal();
    });

    // Initialize
    connectWebSocket();
    loadFlags();
    loadAnomalies();
    loadPredictions();
  </script>
</body>
</html>`;
}

export default app;
