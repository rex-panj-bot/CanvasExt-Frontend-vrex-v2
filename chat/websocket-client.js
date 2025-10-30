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

        // Attempt to reconnect if not manually closed
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('❌ Max reconnection attempts reached');
        }
      };
    });
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

    this.reconnectTimeout = setTimeout(() => {
      if (this.courseId) {
        this.connect(this.courseId).catch(error => {
          console.error('Reconnection failed:', error);
        });
      }
    }, delay);
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
    if (!this.isConnected) {
      console.error('WebSocket not connected');
      if (onError) onError(new Error('Not connected to backend'));
      return Promise.reject(new Error('Not connected to backend'));
    }

    // Return a Promise that resolves when streaming is complete
    return new Promise((resolve, reject) => {
      // Prepare message
      const payload = {
        message: message,
        history: conversationHistory,
        selected_docs: selectedDocs || [],
        syllabus_id: syllabusId || null,
        session_id: sessionId || null,  // For chat history saving
        api_key: apiKey || null,  // User's Gemini API key
        enable_web_search: enableWebSearch || false,  // Web search toggle
        use_smart_selection: useSmartSelection || false  // Smart file selection toggle
      };

      // Handle incoming messages
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'chunk') {
            if (onChunk) {
              onChunk(data.content);
            }
          } else if (data.type === 'done') {
            if (onComplete) onComplete();
            resolve();
          } else if (data.type === 'stopped') {
            console.log('🛑 Stream stopped by user');
            if (onComplete) onComplete();
            resolve();
          } else if (data.type === 'error') {
            const error = new Error(data.message);
            if (onError) onError(error);
            reject(error);
          }
        } catch (error) {
          console.error('❌ WebSocket error:', error);
          if (onError) onError(error);
          reject(error);
        }
      };

      // Send query
      this.ws.send(JSON.stringify(payload));
    });
  }

  /**
   * Close WebSocket connection
   */
  disconnect() {
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

    for (const file of files) {
      // Validate that blob is actually a Blob object
      if (file.blob && file.blob instanceof Blob) {
        formData.append('files', file.blob, file.name);
        validFileCount++;

        // Track file types
        const ext = file.name.split('.').pop().toLowerCase();
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;

        console.log(`  ✓ Adding ${file.name} (${ext}, ${file.blob.size} bytes, type: ${file.blob.type})`);
      } else {
        console.warn(`  ⚠️ Skipping ${file.name} - not a valid Blob (type: ${typeof file.blob})`);
      }
    }

    if (validFileCount === 0) {
      throw new Error('No valid files to upload. All files were skipped due to missing or invalid blobs.');
    }

    console.log(`📤 Uploading ${validFileCount} files to backend:`, fileTypes);
    console.log(`📤 File names being uploaded:`);
    for (const file of files.slice(0, 10)) {  // Show first 10
      if (file.blob) {
        console.log(`   - "${file.name}"`);
      }
    }

    try {
      const response = await fetch(`${this.backendUrl}/upload_pdfs?course_id=${courseId}`, {
        method: 'POST',
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
      const response = await fetch(`${this.backendUrl}/collections/${courseId}/status`);
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
   * Get recent chat sessions for a course
   */
  async getRecentChats(courseId, limit = 20) {
    try {
      const response = await fetch(`${this.backendUrl}/chats/${courseId}?limit=${limit}`);
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
      const response = await fetch(`${this.backendUrl}/chats/${courseId}/${sessionId}`);
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
      const response = await fetch(`${this.backendUrl}/chats/${courseId}/${sessionId}`, {
        method: 'DELETE'
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
      const response = await fetch(`${this.backendUrl}/chats/${courseId}/${sessionId}/title`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
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
