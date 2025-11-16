/**
 * Canvas LMS API Wrapper
 * Handles all Canvas API interactions with pagination, rate limiting, and error handling
 */

class CanvasAPI {
  constructor(baseUrl, apiToken, authMode = 'token') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiToken = apiToken;
    this.authMode = authMode; // 'token' or 'session'
    this.requestDelay = 100; // ms between requests to avoid rate limiting
    this.lastRequestTime = 0;
    this.concurrentRequests = 0; // Track concurrent requests
    this.maxConcurrentRequests = 10; // Allow up to 10 parallel requests
  }

  /**
   * Delay to respect rate limits (optimized for parallel downloads)
   * Only enforces delay for API requests, not file downloads
   */
  async rateLimit(isFileDownload = false) {
    // For file downloads, use a lighter rate limit to allow parallelism
    if (isFileDownload) {
      // Wait if too many concurrent downloads
      while (this.concurrentRequests >= this.maxConcurrentRequests) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      this.concurrentRequests++;
      return;
    }

    // For API requests, use traditional rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Get authentication headers based on auth mode
   */
  getAuthHeaders() {
    const headers = {
      'Accept': 'application/json'
    };

    if (this.authMode === 'token') {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }
    // For session mode, credentials are handled via cookies

    return headers;
  }

  /**
   * Make a Canvas API request with pagination support
   */
  async makeRequest(endpoint, options = {}) {
    await this.rateLimit();

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      ...this.getAuthHeaders(),
      ...options.headers
    };

    const fetchOptions = {
      ...options,
      headers
    };

    // Include credentials for session-based auth
    if (this.authMode === 'session') {
      fetchOptions.credentials = 'include';
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API token. Please check your Canvas API token.');
        } else if (response.status === 403) {
          throw new Error('Access forbidden. Check your Canvas permissions.');
        } else if (response.status === 404) {
          throw new Error('Resource not found.');
        } else {
          throw new Error(`Canvas API error: ${response.status} ${response.statusText}`);
        }
      }

      const data = await response.json();

      // Handle pagination - Canvas uses Link header
      let allData = Array.isArray(data) ? data : [data];

      const linkHeader = response.headers.get('Link');
      if (linkHeader) {
        const nextLink = this.parseLinkHeader(linkHeader).next;
        if (nextLink) {
          const nextData = await this.makeRequestFromUrl(nextLink);
          allData = allData.concat(nextData);
        }
      }

      return allData;
    } catch (error) {
      console.error('Canvas API Error:', error);
      throw error;
    }
  }

  /**
   * Make request from full URL (for pagination)
   */
  async makeRequestFromUrl(url) {
    await this.rateLimit();

    const headers = this.getAuthHeaders();

    const fetchOptions = { headers };

    // Include credentials for session-based auth
    if (this.authMode === 'session') {
      fetchOptions.credentials = 'include';
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`Canvas API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      let allData = Array.isArray(data) ? data : [data];

      const linkHeader = response.headers.get('Link');
      if (linkHeader) {
        const nextLink = this.parseLinkHeader(linkHeader).next;
        if (nextLink) {
          const nextData = await this.makeRequestFromUrl(nextLink);
          allData = allData.concat(nextData);
        }
      }

      return allData;
    } catch (error) {
      console.error('Canvas API Error:', error);
      throw error;
    }
  }

  /**
   * Parse Link header for pagination
   */
  parseLinkHeader(header) {
    const links = {};
    const parts = header.split(',');

    parts.forEach(part => {
      const section = part.split(';');
      if (section.length === 2) {
        const url = section[0].replace(/<(.*)>/, '$1').trim();
        const rel = section[1].replace(/rel="(.*)"/, '$1').trim();
        links[rel] = url;
      }
    });

    return links;
  }

  /**
   * Get all courses for the current user
   */
  async getCourses() {
    try {
      const courses = await this.makeRequest('/api/v1/courses?enrollment_state=active&per_page=100');
      return courses;
    } catch (error) {
      console.error('Error fetching courses:', error);
      throw error;
    }
  }

  /**
   * Get modules for a specific course
   */
  async getModules(courseId) {
    try {
      const modules = await this.makeRequest(`/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`);
      return modules;
    } catch (error) {
      console.error(`Error fetching modules for course ${courseId}:`, error);
      throw error;
    }
  }

  /**
   * Get files for a specific course
   */
  async getFiles(courseId) {
    try {
      const files = await this.makeRequest(`/api/v1/courses/${courseId}/files?per_page=100`);
      return files;
    } catch (error) {
      console.error(`Error fetching files for course ${courseId}:`, error);
      throw error;
    }
  }

  /**
   * Get pages for a specific course
   */
  async getPages(courseId) {
    try {
      const pages = await this.makeRequest(`/api/v1/courses/${courseId}/pages?per_page=100`);
      return pages;
    } catch (error) {
      console.error(`Error fetching pages for course ${courseId}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific page with full content
   */
  async getPage(courseId, pageUrl) {
    try {
      const page = await this.makeRequest(`/api/v1/courses/${courseId}/pages/${pageUrl}`);
      return page[0] || page;
    } catch (error) {
      console.error(`Error fetching page ${pageUrl} for course ${courseId}:`, error);
      throw error;
    }
  }

  /**
   * Get assignments for a specific course
   */
  async getAssignments(courseId) {
    try {
      const assignments = await this.makeRequest(`/api/v1/courses/${courseId}/assignments?per_page=100`);
      return assignments;
    } catch (error) {
      console.error(`Error fetching assignments for course ${courseId}:`, error);
      throw error;
    }
  }

  /**
   * Get all materials for a course (modules, files, pages, assignments)
   */
  async getAllCourseMaterials(courseId, progressCallback) {
    const materials = {
      modules: [],
      files: [],
      pages: [],
      assignments: [],
      errors: [] // Track errors for each resource type
    };

    // Fetch modules with error handling
    try {
      if (progressCallback) progressCallback('Fetching modules...');
      materials.modules = await this.getModules(courseId);
    } catch (error) {
      console.warn('Error fetching modules:', error);
      materials.errors.push({ type: 'modules', error: error.message });
    }

    // Fetch files with error handling
    try {
      if (progressCallback) progressCallback('Fetching files...');
      materials.files = await this.getFiles(courseId);
    } catch (error) {
      console.warn('Error fetching files:', error);
      materials.errors.push({ type: 'files', error: error.message });
    }

    // Fetch pages with error handling
    try {
      if (progressCallback) progressCallback('Fetching pages...');
      materials.pages = await this.getPages(courseId);
    } catch (error) {
      console.warn('Error fetching pages:', error);
      materials.errors.push({ type: 'pages', error: error.message });
    }

    // Fetch assignments with error handling
    try {
      if (progressCallback) progressCallback('Fetching assignments...');
      materials.assignments = await this.getAssignments(courseId);
    } catch (error) {
      console.warn('Error fetching assignments:', error);
      materials.errors.push({ type: 'assignments', error: error.message });
    }

    // Show warning if some resources failed
    if (materials.errors.length > 0) {
      console.warn('Some resources could not be fetched:', materials.errors);
      if (progressCallback) {
        progressCallback(`Warning: ${materials.errors.length} resource type(s) unavailable`);
      }
    }

    return materials;
  }

  /**
   * Download file content (optimized for parallel downloads)
   */
  async downloadFile(fileUrl) {
    await this.rateLimit(true); // Use file download rate limiting

    const headers = this.getAuthHeaders();
    const fetchOptions = {
      headers,
      // IMPORTANT: Use 'same-origin' instead of 'include' or 'omit'
      // This allows credentials for same-origin requests but not for CDN redirects
      // Canvas CDN redirects will work because the download URL includes a token
      credentials: 'same-origin'
    };

    try {
      // Check if this is a Canvas API file endpoint that returns JSON metadata
      // Example: /api/v1/courses/123/files/456
      if (fileUrl.includes('/api/v1/') && fileUrl.includes('/files/')) {
        // First, get the file metadata which includes the actual download URL
        const metadataResponse = await fetch(fileUrl, fetchOptions);

        if (!metadataResponse.ok) {
          throw new Error(`Failed to fetch file metadata: ${metadataResponse.status}`);
        }

        const metadata = await metadataResponse.json();

        // Use the download URL from metadata, or construct one with download_frd=1
        const downloadUrl = metadata.url || `${fileUrl.replace('/api/v1/courses/', '/courses/').replace('/files/', '/files/')}/download?download_frd=1`;

        // Now download the actual file content
        const response = await fetch(downloadUrl, {
          ...fetchOptions,
          credentials: 'same-origin' // Don't send credentials for CDN URLs
        });

        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();

        // Verify we got actual file content, not JSON
        if (blob.type === 'application/json' && blob.size < 5000) {
          // Try the direct download URL
          const directUrl = `${fileUrl}/download?download_frd=1`;
          const retryResponse = await fetch(directUrl, fetchOptions);
          if (retryResponse.ok) {
            const retryBlob = await retryResponse.blob();
            this.concurrentRequests--;
            return retryBlob;
          }
        }

        this.concurrentRequests--;
        return blob;
      }

      // Direct download URL (already has token or is a public URL)
      const response = await fetch(fileUrl, fetchOptions);

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();

      // Decrement concurrent request counter
      this.concurrentRequests--;

      return blob;
    } catch (error) {
      // Decrement counter even on error
      this.concurrentRequests--;
      console.error('Error downloading file:', error);
      throw error;
    }
  }

  /**
   * Test API connection
   */
  async testConnection() {
    try {
      await this.makeRequest('/api/v1/users/self');
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Fetch and store Canvas user ID
   * Returns the user ID if successful, null otherwise
   */
  async fetchAndStoreUserId() {
    try {
      const userData = await this.makeRequest('/api/v1/users/self');
      const user = Array.isArray(userData) ? userData[0] : userData;

      if (user && user.id && typeof StorageManager !== 'undefined') {
        await StorageManager.saveCanvasUserId(user.id);
        console.log('Canvas user ID saved:', user.id);
        return user.id;
      }
      return null;
    } catch (error) {
      console.error('Error fetching Canvas user ID:', error);
      return null;
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CanvasAPI;
}
