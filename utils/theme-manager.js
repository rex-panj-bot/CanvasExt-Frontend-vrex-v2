/**
 * Theme Manager
 * Handles system dark/light mode detection and syncing across all extension pages
 */

class ThemeManager {
  constructor() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.currentScheme = this.mediaQuery.matches ? 'dark' : 'light';
  }

  /**
   * Initialize theme detection and sync
   */
  init() {
    // Apply theme immediately
    this.applyTheme(this.currentScheme);

    // Send initial scheme to background for icon update
    this.notifyBackground(this.currentScheme);

    // Listen for system theme changes
    this.mediaQuery.addEventListener('change', (event) => {
      const newScheme = event.matches ? 'dark' : 'light';
      console.log(`🎨 System theme changed: ${newScheme}`);
      this.currentScheme = newScheme;
      this.applyTheme(newScheme);
      this.notifyBackground(newScheme);
    });

    console.log(`🎨 Theme manager initialized: ${this.currentScheme} mode`);
  }

  /**
   * Apply theme to current page
   */
  applyTheme(scheme) {
    const isDark = scheme === 'dark';

    // Set data attribute on document for CSS targeting
    document.documentElement.setAttribute('data-theme', scheme);

    // Set color-scheme for browser UI (scrollbars, form controls)
    document.documentElement.style.colorScheme = scheme;

    // Update favicon/tab icon
    this.updateFavicon(scheme);

    // Store preference in both localStorage and chrome.storage for service worker access
    localStorage.setItem('theme-preference', scheme);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ 'theme-preference': scheme });
    }
  }

  /**
   * Update page favicon based on theme
   */
  updateFavicon(scheme) {
    const isDark = scheme === 'dark';
    const iconPrefix = isDark ? 'dark' : 'light';

    // Remove existing favicon links
    const existingLinks = document.querySelectorAll('link[rel*="icon"]');
    existingLinks.forEach(link => link.remove());

    // Add new favicon links for all sizes
    const sizes = [
      { size: '16x16', file: `logo-${iconPrefix}-16.png` },
      { size: '48x48', file: `logo-${iconPrefix}-48.png` },
      { size: '128x128', file: `logo-${iconPrefix}-128.png` }
    ];

    sizes.forEach(({ size, file }) => {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.sizes = size;
      link.href = chrome.runtime.getURL(`icons/${file}`);
      document.head.appendChild(link);
    });

    console.log(`🎨 Tab icon updated to ${scheme} mode`);
  }

  /**
   * Notify background script of theme change (for icon update)
   */
  notifyBackground(scheme) {
    try {
      chrome.runtime.sendMessage({
        type: 'theme-changed',
        scheme: scheme
      }).catch(err => {
        // Ignore errors if background script isn't ready
        console.debug('Theme notification failed (background may not be ready):', err);
      });
    } catch (error) {
      console.debug('Theme notification error:', error);
    }
  }

  /**
   * Get current theme
   */
  getCurrentTheme() {
    return this.currentScheme;
  }

  /**
   * Check if dark mode is active
   */
  isDarkMode() {
    return this.currentScheme === 'dark';
  }
}

// Auto-initialize if in a window context (not service worker)
if (typeof window !== 'undefined') {
  const themeManager = new ThemeManager();

  // Initialize immediately if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      themeManager.init();
    });
  } else {
    themeManager.init();
  }

  // Export for use in other scripts
  window.themeManager = themeManager;
}
