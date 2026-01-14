/**
 * Configuration Manager
 * Handles backend URL configuration
 */

// Production mode - set to true to disable all console logging
const PRODUCTION_MODE = true;

// Store original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  info: console.info
};

// Override console methods in production
if (PRODUCTION_MODE) {
  console.log = () => {};
  console.warn = () => {};
  console.debug = () => {};
  console.info = () => {};
  // Keep console.error for critical errors only in production
  // but filter out sensitive data
  console.error = (...args) => {
    // Filter out any args that might contain sensitive data
    const safeArgs = args.map(arg => {
      if (typeof arg === 'string') {
        // Remove potential API keys, tokens, or sensitive URLs
        return arg
          .replace(/api[_-]?key[=:]\s*['"]?[a-zA-Z0-9_-]+['"]?/gi, 'api_key=[REDACTED]')
          .replace(/token[=:]\s*['"]?[a-zA-Z0-9_.-]+['"]?/gi, 'token=[REDACTED]')
          .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]');
      }
      return arg;
    });
    originalConsole.error('[Error]', ...safeArgs);
  };
}

class Config {
  static DEFAULT_BACKEND_URL = 'https://web-production-9aaba7.up.railway.app';
  static STORAGE_KEY = 'backend_url';
  static PRODUCTION_MODE = PRODUCTION_MODE;

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
