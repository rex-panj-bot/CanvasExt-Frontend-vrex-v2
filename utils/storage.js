/**
 * Storage Utility
 * Manages Chrome storage for API tokens, settings, and user preferences
 */

const StorageManager = {
  /**
   * Save Canvas API token
   */
  async saveApiToken(token) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ canvasApiToken: token }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('API token saved successfully');
          resolve();
        }
      });
    });
  },

  /**
   * Get Canvas API token
   */
  async getApiToken() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['canvasApiToken'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.canvasApiToken || null);
        }
      });
    });
  },

  /**
   * Save Canvas instance URL
   */
  async saveCanvasUrl(url) {
    return new Promise((resolve, reject) => {
      // Normalize URL
      let normalizedUrl = url.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }
      normalizedUrl = normalizedUrl.replace(/\/$/, ''); // Remove trailing slash

      chrome.storage.local.set({ canvasInstanceUrl: normalizedUrl }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('Canvas URL saved:', normalizedUrl);
          resolve();
        }
      });
    });
  },

  /**
   * Get Canvas instance URL
   */
  async getCanvasUrl() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['canvasInstanceUrl'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.canvasInstanceUrl || null);
        }
      });
    });
  },

  /**
   * Save both token and URL
   */
  async saveCredentials(token, url) {
    await this.saveApiToken(token);
    await this.saveCanvasUrl(url);
  },

  /**
   * Get both token and URL
   */
  async getCredentials() {
    const token = await this.getApiToken();
    const url = await this.getCanvasUrl();
    return { token, url };
  },

  /**
   * Check if credentials are configured
   */
  async hasCredentials() {
    const { token, url } = await this.getCredentials();
    return !!(token && url);
  },

  // ========== Authentication Method Selection ==========

  /**
   * Save selected authentication method
   */
  async saveAuthMethod(method) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ authMethod: method }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('Auth method saved:', method);
          resolve();
        }
      });
    });
  },

  /**
   * Get selected authentication method
   */
  async getAuthMethod() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['authMethod'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.authMethod || null);
        }
      });
    });
  },

  /**
   * Check if any authentication is configured
   */
  async hasAnyAuth() {
    const authMethod = await this.getAuthMethod();

    if (authMethod === 'session') {
      const url = await this.getCanvasUrl();
      return !!url;
    } else if (authMethod === 'token') {
      return await this.hasCredentials();
    }

    return false;
  },

  /**
   * Clear all stored data
   */
  async clearAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('All storage cleared');
          resolve();
        }
      });
    });
  },

  /**
   * Save user preferences
   */
  async savePreferences(preferences) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ userPreferences: preferences }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('Preferences saved:', preferences);
          resolve();
        }
      });
    });
  },

  /**
   * Get user preferences
   */
  async getPreferences() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['userPreferences'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.userPreferences || {
            includeSyllabus: true,
            includeLectures: true,
            includeReadings: true,
            includeAssignments: true,
            includePages: true
          });
        }
      });
    });
  },

  /**
   * Save last selected course
   */
  async saveLastCourse(courseId, courseName) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({
        lastCourse: { id: courseId, name: courseName }
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Get last selected course
   */
  async getLastCourse() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['lastCourse'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.lastCourse || null);
        }
      });
    });
  },

  // ========== Anthropic API Key Methods ==========

  /**
   * Save Anthropic API key
   */
  async saveAnthropicAPIKey(apiKey) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ anthropicApiKey: apiKey.trim() }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('Anthropic API key saved');
          resolve();
        }
      });
    });
  },

  /**
   * Get Anthropic API key
   */
  async getAnthropicAPIKey() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['anthropicApiKey'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.anthropicApiKey || null);
        }
      });
    });
  },

  /**
   * Check if Anthropic API key is configured
   */
  async hasAnthropicAPIKey() {
    const apiKey = await this.getAnthropicAPIKey();
    return !!apiKey;
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
