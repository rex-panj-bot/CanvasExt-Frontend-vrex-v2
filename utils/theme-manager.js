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
    console.log(`🎨 [THEME-MANAGER] Initializing...`);
    console.log(`🎨 [THEME-MANAGER] Current system theme: ${this.currentScheme}`);

    // Apply theme immediately
    this.applyTheme(this.currentScheme);

    // Save SYSTEM theme for toolbar icon (separate from page preference)
    this.saveSystemTheme(this.currentScheme);

    // Listen for system theme changes
    this.mediaQuery.addEventListener('change', (event) => {
      const newScheme = event.matches ? 'dark' : 'light';
      console.log(`🎨 [THEME-MANAGER] ⚠️ SYSTEM THEME CHANGED: ${this.currentScheme} → ${newScheme}`);
      this.currentScheme = newScheme;
      this.applyTheme(newScheme);
      // Save system theme for toolbar icon
      this.saveSystemTheme(newScheme);
    });

    console.log(`🎨 [THEME-MANAGER] Initialized in ${this.currentScheme} mode`);
  }

  /**
   * Save system theme (for toolbar icon - only changes with actual system theme)
   */
  saveSystemTheme(scheme) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ 'system-theme': scheme });
      console.log(`🎨 System theme saved: ${scheme}`);
    }
  }

  /**
   * Apply theme to current page
   */
  applyTheme(scheme) {
    console.log(`🎨 [THEME-MANAGER] Applying theme: ${scheme}`);
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
      console.log(`🎨 [THEME-MANAGER] Saving to chrome.storage: ${scheme}`);
      chrome.storage.local.set({ 'theme-preference': scheme });
    }
  }

  /**
   * Update page favicon based on theme
   */
  updateFavicon(scheme) {
    const isDark = scheme === 'dark';
    // Tab favicons: use logo matching the theme
    const logoFile = isDark ? 'darkmodelogo.png' : 'lightmodelogo.png';

    console.log(`🎨 [THEME-MANAGER] Updating tab favicon:`);
    console.log(`   Scheme: ${scheme}, Logo: ${logoFile}`);
    console.log(`   Logic: Tab icon matches page theme (${isDark ? 'DARK page → DARK logo' : 'LIGHT page → LIGHT logo'})`);

    // Update existing favicon element (added in HTML with id="favicon")
    const faviconLink = document.getElementById('favicon');
    if (faviconLink) {
      faviconLink.href = chrome.runtime.getURL(`icons/${logoFile}`);
      console.log(`✅ [THEME-MANAGER] Tab favicon updated to ${logoFile}`);
    } else {
      console.warn('⚠️ [THEME-MANAGER] Favicon element with id="favicon" not found in HTML');
    }
  }

  /**
   * Notify background script of theme change (for icon update)
   */
  notifyBackground(scheme) {
    console.log(`🎨 [THEME-MANAGER] Notifying background of theme change: ${scheme}`);
    try {
      chrome.runtime.sendMessage({
        type: 'theme-changed',
        scheme: scheme
      }).then(() => {
        console.log(`✅ [THEME-MANAGER] Background notified successfully`);
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
