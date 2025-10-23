/**
 * WebSocket Client for Python Backend
 * Replaces the JavaScript agent-orchestrator with Python backend communication
 */

class WebSocketClient {
  constructor(backendUrl = 'ws://localhost:8000') {
    this.backendUrl = backendUrl;
    this.ws = null;
    this.courseId = null;
    this.messageQueue = [];
    this.isConnected = false;
  }

  /**
   * Connect to WebSocket server
   */
  connect(courseId) {
    return new Promise((resolve, reject) => {
      this.courseId = courseId;
      const wsUrl = `${this.backendUrl}/ws/chat/${courseId}`;

      console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        this.isConnected = true;
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        this.isConnected = false;
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        this.isConnected = false;
      };
    });
  }

  /**
   * Send query and receive streaming response
   */
  async sendQuery(message, conversationHistory, selectedDocs, syllabusId, sessionId, onChunk, onComplete, onError) {
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
        session_id: sessionId || null  // For chat history saving
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
  constructor(backendUrl = 'http://localhost:8000') {
    this.backendUrl = backendUrl;
  }

  /**
   * Upload PDFs to backend for processing
   */
  async uploadPDFs(courseId, files) {
    const formData = new FormData();

    // Add files to form data
    for (const file of files) {
      formData.append('files', file.blob, file.name);
    }

    try {
      const response = await fetch(`${this.backendUrl}/upload_pdfs?course_id=${courseId}`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ PDFs uploaded:', result);
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
