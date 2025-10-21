/**
 * Configuration Manager
 * Handles backend URL configuration
 */

class Config {
  static DEFAULT_BACKEND_URL = 'http://localhost:8000';
  static STORAGE_KEY = 'backend_url';

  /**
   * Get the configured backend URL
   * @returns {Promise<string>} Backend URL (http and ws formats)
   */
  static async getBackendUrl() {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const url = result[this.STORAGE_KEY] || this.DEFAULT_BACKEND_URL;

      // Ensure URL format is correct
      return this.normalizeUrl(url);
    } catch (error) {
      console.error('Error getting backend URL:', error);
      return this.DEFAULT_BACKEND_URL;
    }
  }

  /**
   * Set the backend URL
   * @param {string} url - Backend URL
   */
  static async setBackendUrl(url) {
    const normalized = this.normalizeUrl(url);
    await chrome.storage.local.set({ [this.STORAGE_KEY]: normalized });
    return normalized;
  }

  /**
   * Normalize URL to http:// format
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL
   */
  static normalizeUrl(url) {
    if (!url) return this.DEFAULT_BACKEND_URL;

    // Remove trailing slash
    url = url.trim().replace(/\/$/, '');

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }

    return url;
  }

  /**
   * Convert HTTP URL to WebSocket URL
   * @param {string} httpUrl - HTTP URL
   * @returns {string} WebSocket URL
   */
  static httpToWs(httpUrl) {
    return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }

  /**
   * Test if backend is reachable
   * @param {string} url - Backend URL to test
   * @returns {Promise<boolean>} True if backend is reachable
   */
  static async testBackend(url) {
    try {
      const normalized = this.normalizeUrl(url);
      const response = await fetch(`${normalized}/`, { method: 'GET' });
      const data = await response.json();
      return data.status === 'ok';
    } catch (error) {
      console.error('Backend test failed:', error);
      return false;
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Config;
}
