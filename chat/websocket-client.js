/**
 * WebSocket Client for Python Backend
 * Replaces the JavaScript agent-orchestrator with Python backend communication
 */

class WebSocketClient {
  constructor(backendUrl = 'https://web-production-9aaba7.up.railway.app') {
    this.backendUrl = backendUrl;
    this.ws = null;
    this.courseId = null;
    this.messageQueue = [];
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
    this.reconnectTimeout = null;
    this.pendingMessages = new Map(); // Track pending requests
    this.pendingQueries = []; // Queue for queries when disconnected - auto-replay on reconnect

    // Heartbeat/keepalive settings
    // Railway WebSocket timeout is ~55-60s, so ping every 20s to stay well within limit
    this.pingInterval = null;
    this.pingTimeout = null;
    this.lastPongReceived = null;
    this.lastMessageReceived = null;
    this.PING_INTERVAL_MS = 20000; // Send ping every 20 seconds (was 30s, too long for Railway)
    this.PONG_TIMEOUT_MS = 10000; // Expect pong within 10 seconds
    this.STALE_CONNECTION_MS = 35000; // Consider connection stale after 35s of no activity

    // Connection monitoring
    this.connectionMonitorInterval = null;
    this.onConnectionStateChange = null; // Callback for connection state changes
  }

  /**
   * Connect to WebSocket server
   */
  connect(courseId) {
    return new Promise((resolve, reject) => {
      this.courseId = courseId;
      const wsUrl = `${this.backendUrl}/ws/chat/${courseId}`;

      console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

      // Use wss:// for secure connection
      const secureWsUrl = wsUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

      this.ws = new WebSocket(secureWsUrl);

      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0; // Reset reconnect counter
        this.reconnectDelay = 1000; // Reset delay
        this.lastMessageReceived = Date.now();
        this.lastPongReceived = Date.now();

        // Start heartbeat and monitoring
        this.startHeartbeat();
        this.startConnectionMonitor();
        this.notifyConnectionState('connected');

        // Auto-replay any queued queries (invisible reconnection)
        if (this.pendingQueries.length > 0) {
          console.log(`📤 Replaying ${this.pendingQueries.length} queued queries...`);
          const queries = [...this.pendingQueries];
          this.pendingQueries = [];

          for (const query of queries) {
            this.sendQuery(
              query.message, query.conversationHistory, query.selectedDocs,
              query.syllabusId, query.sessionId, query.apiKey, query.enableWebSearch,
              query.useSmartSelection, query.onChunk, query.onComplete, query.onError
            ).then(query.resolve).catch(query.reject);
          }
        }

        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        this.isConnected = false;
        reject(error);
      };

      this.ws.onclose = (event) => {
        console.log(`🔌 WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'unknown'})`);
        this.isConnected = false;

        // Stop heartbeat and monitoring
        this.stopHeartbeat();
        this.stopConnectionMonitor();

        // Attempt to reconnect if not manually closed OR if queries pending (invisible retry)
        if ((event.code !== 1000 || this.pendingQueries.length > 0) && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('❌ Max reconnection attempts reached');
          this.notifyConnectionState('offline');
        }
      };
    });
  }

  /**
   * Start heartbeat/ping mechanism
   *
   * Sends pings to keep Railway connection alive (prevents idle timeout).
   * Does NOT expect pongs - Railway proxy may not forward them reliably.
   * Connection errors will be detected naturally when real messages fail.
   */
  startHeartbeat() {
    // Clear any existing intervals
    this.stopHeartbeat();

    console.log(`💓 Starting heartbeat (ping every ${this.PING_INTERVAL_MS / 1000}s to prevent Railway timeout)`);

    // Send ping regularly to prevent idle timeout
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        // Double-check WebSocket state before sending ping
        if (this.ws.readyState !== WebSocket.OPEN) {
          console.warn('⚠️ WebSocket not OPEN during ping - closing to trigger reconnect');
          this.isConnected = false;
          this.ws.close();
          return;
        }

        console.log('📤 Sending ping...');
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
          // Note: We don't wait for pong - Railway proxy may not forward it
          // Connection health will be detected when actual messages fail
        } catch (error) {
          console.error('❌ Error sending ping:', error);
          // If ping send fails, connection is truly dead
          this.isConnected = false;
          this.ws.close();
        }
      }
    }, this.PING_INTERVAL_MS);
  }

  /**
   * Stop heartbeat mechanism
   */
  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  /**
   * Start connection monitoring (checks for stale connections)
   */
  startConnectionMonitor() {
    this.stopConnectionMonitor();

    this.connectionMonitorInterval = setInterval(() => {
      if (!this.isConnected) return;

      const now = Date.now();
      const timeSinceLastMessage = now - (this.lastMessageReceived || now);

      // If no messages received for 45s, connection might be stale
      if (timeSinceLastMessage > this.STALE_CONNECTION_MS) {
        console.warn(`⚠️ No messages received for ${timeSinceLastMessage}ms, connection may be stale`);
        this.notifyConnectionState('stale');
      }
    }, 15000); // Check every 15 seconds
  }

  /**
   * Stop connection monitoring
   */
  stopConnectionMonitor() {
    if (this.connectionMonitorInterval) {
      clearInterval(this.connectionMonitorInterval);
      this.connectionMonitorInterval = null;
    }
  }

  /**
   * Notify connection state change to UI
   */
  notifyConnectionState(state) {
    if (this.onConnectionStateChange) {
      this.onConnectionStateChange(state);
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
    this.notifyConnectionState('reconnecting');

    this.reconnectTimeout = setTimeout(() => {
      if (this.courseId) {
        this.connect(this.courseId).catch(error => {
          console.error('Reconnection failed:', error);
          this.notifyConnectionState('offline');
        });
      }
    }, delay);
  }

  /**
   * Force immediate reconnection (resets retry counter)
   */
  forceReconnect() {
    console.log('🔄 Force reconnecting...');
    this.reconnectAttempts = 0;  // Reset attempts counter

    // Clear any pending reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Close existing connection if open
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
      this.ws.close();  // onclose handler will trigger attemptReconnect
    } else {
      // Connection already closed, manually trigger reconnect
      this.attemptReconnect();
    }
  }

  /**
   * Stop current streaming
   */
  stopStreaming() {
    if (this.ws && this.isConnected) {
      console.log('Sending stop signal to backend...');
      try {
        this.ws.send(JSON.stringify({ type: 'stop' }));
      } catch (error) {
        console.error('Error sending stop signal:', error);
      }
    }
  }

  /**
   * Send query and receive streaming response
   */
  async sendQuery(message, conversationHistory, selectedDocs, syllabusId, sessionId, apiKey, enableWebSearch, useSmartSelection, onChunk, onComplete, onError) {
    // Check if connected - if not, queue and reconnect invisibly
    if (!this.isReady()) {
      console.log('⚠️ Query submitted but backend disconnected - queuing and reconnecting...');

      // Return promise that will resolve after reconnect and replay
      return new Promise((resolve, reject) => {
        // Queue this query for replay after reconnection
        this.pendingQueries.push({
          message, conversationHistory, selectedDocs, syllabusId, sessionId,
          apiKey, enableWebSearch, useSmartSelection, onChunk, onComplete, onError,
          resolve, reject
        });

        // Trigger immediate reconnection
        this.forceReconnect();
      });
    }

    // Get canvas user ID before creating the promise
    const canvasUserId = await this.getCanvasUserId();

    // Connection is good - send query normally
    return new Promise((resolve, reject) => {
      let closeHandler = null;
      let isComplete = false;

      // Handle connection close during query - queue for auto-retry
      closeHandler = (event) => {
        if (!isComplete) {
          isComplete = true;
          console.log('⚠️ Connection closed during query - will reconnect and retry invisibly');

          // Queue this query for automatic retry after reconnection
          this.pendingQueries.push({
            message, conversationHistory, selectedDocs, syllabusId, sessionId,
            apiKey, enableWebSearch, useSmartSelection, onChunk, onComplete, onError,
            resolve, reject
          });

          // Trigger reconnection (will replay queued queries)
          this.forceReconnect();
        }
      };
      this.ws.addEventListener('close', closeHandler);

      // Prepare message
      const payload = {
        message: message,
        history: conversationHistory,
        selected_docs: selectedDocs || [],
        syllabus_id: syllabusId || null,
        session_id: sessionId || null,  // For chat history saving
        api_key: apiKey || null,  // User's Gemini API key
        enable_web_search: enableWebSearch || false,  // Web search toggle
        use_smart_selection: useSmartSelection || false,  // Smart file selection toggle
        canvas_user_id: canvasUserId || null  // Canvas user ID for user-specific tracking
      };

      // Handle incoming messages
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Update last message received timestamp (for global connection monitoring)
          this.lastMessageReceived = Date.now();

          if (data.type === 'pong') {
            // Received pong response (may or may not arrive due to Railway proxy)
            console.log('📥 Received pong (connection healthy)');
            this.lastPongReceived = Date.now();
            // Don't process pong as a regular message
            return;
          } else if (data.type === 'chunk') {
            if (onChunk) {
              onChunk(data.content);
            }
          } else if (data.type === 'done') {
            isComplete = true;
            this.ws.removeEventListener('close', closeHandler);
            if (onComplete) onComplete();
            resolve();
          } else if (data.type === 'stopped') {
            isComplete = true;
            this.ws.removeEventListener('close', closeHandler);
            console.log('🛑 Stream stopped by user');
            if (onComplete) onComplete();
            resolve();
          } else if (data.type === 'error') {
            isComplete = true;
            this.ws.removeEventListener('close', closeHandler);
            const error = new Error(data.message);
            if (onError) onError(error);
            reject(error);
          }
        } catch (error) {
          isComplete = true;
          this.ws.removeEventListener('close', closeHandler);
          console.error('❌ WebSocket message parsing error:', error);
          if (onError) onError(error);
          reject(error);
        }
      };

      // Send query
      try {
        this.ws.send(JSON.stringify(payload));
        console.log('📤 Query sent, waiting for response...');
      } catch (error) {
        isComplete = true;
        this.ws.removeEventListener('close', closeHandler);
        console.error('❌ Failed to send query:', error);
        if (onError) onError(error);
        reject(error);
      }
    });
  }

  /**
   * Clear all pending queries from the queue
   */
  clearQueue() {
    const queueLength = this.pendingQueries.length;
    this.pendingQueries = [];
    if (queueLength > 0) {
      console.log(`🧹 Cleared ${queueLength} pending queries from queue`);
    }
    return queueLength;
  }

  /**
   * Close WebSocket connection
   */
  disconnect() {
    // Stop heartbeat and monitoring
    this.stopHeartbeat();
    this.stopConnectionMonitor();

    // Clear any pending queries
    this.clearQueue();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Check connection status
   */
  isReady() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get Canvas user ID from storage
   */
  async getCanvasUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['canvasUserId'], (result) => {
        resolve(result.canvasUserId || null);
      });
    });
  }
}

/**
 * Backend HTTP Client for PDF uploads
 */
class BackendClient {
  constructor(backendUrl = 'https://web-production-9aaba7.up.railway.app') {
    this.backendUrl = backendUrl;
  }

  /**
   * Upload files to backend for processing (PDFs, PPTX, images, etc.)
   */
  async uploadPDFs(courseId, files) {
    const formData = new FormData();

    // Add files to form data, validating that blob exists
    let validFileCount = 0;
    const fileTypes = {};
    const fileMetadata = []; // Store Canvas timestamps for each file

    for (const file of files) {
      // Validate that blob is actually a Blob object
      if (file.blob && file.blob instanceof Blob) {
        formData.append('files', file.blob, file.name);
        validFileCount++;

        // Track file types
        const ext = file.name.split('.').pop().toLowerCase();
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;

        // Collect Canvas timestamps for this file (for temporal disambiguation)
        fileMetadata.push({
          name: file.name,
          canvas_created_at: file.canvas_created_at || null,
          canvas_updated_at: file.canvas_updated_at || null,
          canvas_modified_at: file.canvas_modified_at || null
        });

        console.log(`  ✓ Adding ${file.name} (${ext}, ${file.blob.size} bytes, type: ${file.blob.type})`);
      } else {
        console.warn(`  ⚠️ Skipping ${file.name} - not a valid Blob (type: ${typeof file.blob})`);
      }
    }

    if (validFileCount === 0) {
      throw new Error('No valid files to upload. All files were skipped due to missing or invalid blobs.');
    }

    // Add file metadata as JSON (Canvas timestamps for temporal disambiguation)
    formData.append('file_metadata', JSON.stringify(fileMetadata));

    console.log(`📤 Uploading ${validFileCount} files to backend:`, fileTypes);
    console.log(`📤 File names being uploaded:`);
    for (const file of files.slice(0, 10)) {  // Show first 10
      if (file.blob) {
        console.log(`   - "${file.name}"`);
      }
    }

    try {
      // Get Canvas user ID for user-specific tracking
      const canvasUserId = await StorageManager.getCanvasUserId();
      const headers = {};
      if (canvasUserId) {
        headers['X-Canvas-User-Id'] = canvasUserId;
        console.log(`📤 Including Canvas User ID: ${canvasUserId}`);
      }

      const response = await fetch(`${this.backendUrl}/upload_pdfs?course_id=${courseId}`, {
        method: 'POST',
        headers: headers,
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Files uploaded successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ Upload error:', error);
      throw error;
    }
  }

  /**
   * Get collection status
   */
  async getCollectionStatus(courseId) {
    try {
      const canvasUserId = await this.getCanvasUserId();
      const headers = {};
      if (canvasUserId) {
        headers['X-Canvas-User-Id'] = canvasUserId;
      }
      const response = await fetch(`${this.backendUrl}/collections/${courseId}/status`, { headers });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error fetching collection status:', error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.backendUrl}/`);
      const result = await response.json();
      return result.status === 'ok';
    } catch (error) {
      console.error('Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Get Canvas user ID from storage
   */
  async getCanvasUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['canvasUserId'], (result) => {
        resolve(result.canvasUserId || null);
      });
    });
  }

  /**
   * Get recent chat sessions for a course
   */
  async getRecentChats(courseId, limit = 20) {
    try {
      const canvasUserId = await this.getCanvasUserId();
      const headers = {};
      if (canvasUserId) {
        headers['X-Canvas-User-Id'] = canvasUserId;
      }
      const response = await fetch(`${this.backendUrl}/chats/${courseId}?limit=${limit}`, { headers });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error fetching recent chats:', error);
      throw error;
    }
  }

  /**
   * Load a specific chat session
   */
  async getChatSession(courseId, sessionId) {
    try {
      const canvasUserId = await this.getCanvasUserId();
      const headers = {};
      if (canvasUserId) {
        headers['X-Canvas-User-Id'] = canvasUserId;
      }
      const response = await fetch(`${this.backendUrl}/chats/${courseId}/${sessionId}`, { headers });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error fetching chat session:', error);
      throw error;
    }
  }

  /**
   * Delete a chat session
   */
  async deleteChatSession(courseId, sessionId) {
    try {
      const canvasUserId = await this.getCanvasUserId();
      const headers = {};
      if (canvasUserId) {
        headers['X-Canvas-User-Id'] = canvasUserId;
      }
      const response = await fetch(`${this.backendUrl}/chats/${courseId}/${sessionId}`, {
        method: 'DELETE',
        headers
      });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error deleting chat session:', error);
      throw error;
    }
  }

  /**
   * Update chat session title
   */
  async updateChatTitle(courseId, sessionId, title) {
    try {
      const canvasUserId = await this.getCanvasUserId();
      const headers = {
        'Content-Type': 'application/json'
      };
      if (canvasUserId) {
        headers['X-Canvas-User-Id'] = canvasUserId;
      }
      const response = await fetch(`${this.backendUrl}/chats/${courseId}/${sessionId}/title`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title })
      });
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error updating chat title:', error);
      throw error;
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebSocketClient, BackendClient };
}
