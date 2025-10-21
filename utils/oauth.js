/**
 * OAuth 2.0 Utility
 * Handles Canvas OAuth 2.0 authentication flow
 */

class CanvasOAuth {
  constructor(canvasUrl, clientId, clientSecret) {
    this.canvasUrl = canvasUrl.replace(/\/$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  }

  /**
   * Get authorization URL
   */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      state: state || this.generateState(),
      scope: '' // Canvas uses default scopes if empty
    });

    return `${this.canvasUrl}/login/oauth2/auth?${params.toString()}`;
  }

  /**
   * Generate random state for CSRF protection
   */
  generateState() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Start OAuth flow
   */
  async authorize() {
    return new Promise((resolve, reject) => {
      const state = this.generateState();
      const authUrl = this.getAuthorizationUrl(state);

      console.log('Starting OAuth flow with URL:', authUrl);

      // Launch web auth flow
      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        (redirectUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!redirectUrl) {
            reject(new Error('No redirect URL received'));
            return;
          }

          console.log('Received redirect URL:', redirectUrl);

          try {
            // Parse the redirect URL
            const url = new URL(redirectUrl);
            const code = url.searchParams.get('code');
            const returnedState = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (!code) {
              reject(new Error('No authorization code received'));
              return;
            }

            // Verify state (optional but recommended)
            if (returnedState !== state) {
              console.warn('State mismatch - possible CSRF attempt');
            }

            resolve(code);
          } catch (error) {
            reject(new Error(`Failed to parse redirect URL: ${error.message}`));
          }
        }
      );
    });
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    const tokenUrl = `${this.canvasUrl}/login/oauth2/token`;

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      code: code
    });

    console.log('Exchanging code for token at:', tokenUrl);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      if (!data.access_token) {
        throw new Error('No access token in response');
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        tokenType: data.token_type
      };
    } catch (error) {
      console.error('Token exchange error:', error);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken) {
    const tokenUrl = `${this.canvasUrl}/login/oauth2/token`;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken
    });

    console.log('Refreshing access token');

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken, // Use old refresh token if new one not provided
        expiresIn: data.expires_in,
        tokenType: data.token_type
      };
    } catch (error) {
      console.error('Token refresh error:', error);
      throw error;
    }
  }

  /**
   * Complete OAuth flow (authorize + exchange)
   */
  async authenticate() {
    try {
      const code = await this.authorize();
      const tokens = await this.exchangeCodeForToken(code);
      return tokens;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  /**
   * Get extension ID for redirect URI
   */
  static getExtensionId() {
    return chrome.runtime.id;
  }

  /**
   * Get redirect URI for this extension
   */
  static getRedirectUri() {
    return `https://${chrome.runtime.id}.chromiumapp.org/`;
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CanvasOAuth;
}
