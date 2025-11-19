imap/**
 * Content Script
 * Detects Canvas course pages and extracts course information
 */

(function() {
  'use strict';

  console.log('Canvas Material Extractor: Content script loaded');

  /**
   * Extract course ID from URL
   */
  function getCourseIdFromUrl() {
    const url = window.location.href;
    const match = url.match(/\/courses\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract course name from page
   */
  function getCourseName() {
    // Try multiple selectors that Canvas uses for course names
    const selectors = [
      '#crumb_course_0',
      '.ellipsible',
      '[data-testid="course-name"]',
      '.ic-app-nav-toggle-and-crumbs span[title]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }

    return null;
  }

  /**
   * Get course information
   */
  function getCourseInfo() {
    const courseId = getCourseIdFromUrl();
    const courseName = getCourseName();

    if (courseId) {
      return {
        id: courseId,
        name: courseName || `Course ${courseId}`,
        url: window.location.href
      };
    }

    return null;
  }

  /**
   * Send course info to background script
   */
  function sendCourseInfo() {
    const courseInfo = getCourseInfo();

    if (courseInfo) {
      console.log('Course detected:', courseInfo);

      // Send to background script
      chrome.runtime.sendMessage({
        type: 'COURSE_DETECTED',
        courseInfo: courseInfo
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending course info:', chrome.runtime.lastError);
        } else {
          console.log('Course info sent successfully');
        }
      });
    }
  }

  /**
   * Listen for messages from popup
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);

    if (request.type === 'GET_COURSE_INFO') {
      const courseInfo = getCourseInfo();
      sendResponse({ courseInfo: courseInfo });
    }

    return true; // Keep message channel open for async response
  });

  // Check if we're on a course page
  if (getCourseIdFromUrl()) {
    // Send course info immediately
    sendCourseInfo();

    // Also send when DOM changes (for SPA navigation)
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        if (getCourseIdFromUrl()) {
          setTimeout(sendCourseInfo, 500); // Small delay to let page load
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();
