/**
 * Session Cookie Authentication
 * Uses existing Canvas session cookies for API authentication
 */

class SessionAuth {
  constructor(canvasUrl) {
    this.canvasUrl = canvasUrl.replace(/\/$/, '');
  }

  /**
   * Check if user is logged into Canvas
   */
  async isLoggedIn() {
    try {
      // Try to get Canvas session cookies
      const cookies = await this.getCanvasCookies();
      return cookies && cookies.length > 0;
    } catch (error) {
      console.error('Error checking login status:', error);
      return false;
    }
  }

  /**
   * Get Canvas session cookies
   */
  async getCanvasCookies() {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.canvasUrl);

      chrome.cookies.getAll(
        {
          domain: urlObj.hostname
        },
        (cookies) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            // Filter for session-related cookies
            const sessionCookies = cookies.filter(cookie =>
              cookie.name.includes('session') ||
              cookie.name.includes('canvas') ||
              cookie.name === '_csrf_token'
            );
            resolve(sessionCookies);
          }
        }
      );
    });
  }

  /**
   * Make authenticated request using session cookies
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.canvasUrl}${endpoint}`;

    console.log(`Session Auth Request: ${url}`);

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // Include cookies
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Not logged in to Canvas. Please log in to Canvas in this browser first.');
        }
        throw new Error(`Request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Session auth request error:', error);
      throw error;
    }
  }

  /**
   * Test if session is valid by making a test API call
   * Also captures and stores the Canvas user ID
   */
  async testSession() {
    try {
      console.log('Testing session for:', this.canvasUrl);

      // First check if we have any Canvas cookies
      const cookies = await this.getCanvasCookies();
      console.log('Found cookies:', cookies.length);

      if (cookies.length === 0) {
        console.log('No Canvas cookies found');
        return false;
      }

      // Try to make an API request
      const response = await fetch(`${this.canvasUrl}/api/v1/users/self`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      console.log('Session test response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('Session valid! User:', data.name || data.id);

        // Save Canvas user ID for user-specific data tracking
        if (data.id && typeof StorageManager !== 'undefined') {
          try {
            await StorageManager.saveCanvasUserId(data.id);
            console.log('Canvas user ID saved:', data.id);
          } catch (err) {
            console.warn('Failed to save Canvas user ID:', err);
          }
        }

        return true;
      }

      console.log('Session test failed with status:', response.status);
      return false;
    } catch (error) {
      console.error('Session test failed:', error);
      return false;
    }
  }

  /**
   * Get CSRF token from cookies
   */
  async getCsrfToken() {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.canvasUrl);

      chrome.cookies.get(
        {
          url: this.canvasUrl,
          name: '_csrf_token'
        },
        (cookie) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(cookie ? cookie.value : null);
          }
        }
      );
    });
  }

  /**
   * Make request with CSRF token for POST/PUT/DELETE
   */
  async makeAuthenticatedRequest(endpoint, options = {}) {
    const csrfToken = await this.getCsrfToken();

    const headers = {
      'Accept': 'application/json',
      ...options.headers
    };

    if (csrfToken && (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE')) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    return this.makeRequest(endpoint, {
      ...options,
      headers
    });
  }

  /**
   * Prompt user to log in to Canvas
   */
  async promptLogin() {
    const loginUrl = `${this.canvasUrl}/login`;

    return new Promise((resolve, reject) => {
      chrome.tabs.create({ url: loginUrl }, (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        // Listen for tab updates to detect when login is complete
        const listener = (tabId, changeInfo, updatedTab) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            const url = updatedTab.url || '';

            // Check if we're back on Canvas (not login page)
            if (url.includes(this.canvasUrl) && !url.includes('/login')) {
              chrome.tabs.onUpdated.removeListener(listener);
              chrome.tabs.remove(tab.id);
              resolve(true);
            }
          }
        };

        chrome.tabs.onUpdated.addListener(listener);

        // Timeout after 5 minutes
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('Login timeout'));
        }, 5 * 60 * 1000);
      });
    });
  }

  /**
   * Get authentication headers for fetch requests
   */
  async getAuthHeaders() {
    const csrfToken = await this.getCsrfToken();
    const headers = {
      'Accept': 'application/json'
    };

    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    return headers;
  }

  /**
   * Check if Canvas session is accessible
   */
  static async checkCanvasAccess(canvasUrl) {
    try {
      const sessionAuth = new SessionAuth(canvasUrl);
      const isLoggedIn = await sessionAuth.isLoggedIn();

      if (!isLoggedIn) {
        return { accessible: false, reason: 'not_logged_in' };
      }

      const isValid = await sessionAuth.testSession();

      if (!isValid) {
        return { accessible: false, reason: 'invalid_session' };
      }

      return { accessible: true };
    } catch (error) {
      return { accessible: false, reason: error.message };
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionAuth;
}
