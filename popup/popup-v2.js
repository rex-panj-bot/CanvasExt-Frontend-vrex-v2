/**
 * Popup Script V2 - Session Auth Only
 * Supports: Session Login
 */

// Constants
const PROGRESS_PERCENT = {
  PREPARING: 10,
  BACKEND_CHECK: 20,
  COLLECTING: 30,
  DOWNLOADING_START: 40,
  DOWNLOADING_END: 70,
  UPLOADING: 70,
  COMPLETE: 100
};

// Utility: Compute SHA-256 hash of file blob (for hash-based file identification)
async function computeFileHash(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  } catch (error) {
    console.error('❌ Failed to compute file hash:', error);
    return null;
  }
}

// Global variables
let canvasAPI = null;
let fileProcessor = null;
let currentCourse = null;
let scannedMaterials = null;
let currentAuthMethod = null;
let preCheckedFiles = null; // Cache for pre-checked file existence results

// Screen management
const screens = {
  sessionSetup: document.getElementById('session-setup-screen'),
  main: document.getElementById('main-screen')
};

// Initialize theme based on system preference or user override
function initializeTheme() {
  chrome.storage.local.get(['theme-preference'], (result) => {
    const savedTheme = result['theme-preference'];

    if (savedTheme) {
      // User has set a preference, use it
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      // No user preference, use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = prefersDark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    }
  });
}

// Listen for storage changes (theme sync between popup and chat)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['theme-preference']) {
    const newTheme = changes['theme-preference'].newValue;
    if (newTheme) {
      document.documentElement.setAttribute('data-theme', newTheme);
      updateThemeButtons();
    }
  }
});

// Listen for system theme changes (only if user hasn't set a manual preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  chrome.storage.local.get(['theme-preference'], (result) => {
    if (!result['theme-preference']) {
      // Only update if user hasn't manually set a preference
      const theme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    }
  });
});

// Initialize theme before DOM loads
initializeTheme();

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  fileProcessor = new FileProcessor();

  // Always use session auth - no other options
  currentAuthMethod = 'session';

  // Check if user has session configured
  const url = await StorageManager.getCanvasUrl();

  if (url) {
    try {
      const sessionAuth = new SessionAuth(url);
      const isValid = await sessionAuth.testSession();

      if (isValid) {
        // Session is valid, go to main screen
        await loadMainScreen();
      } else {
        // Session invalid, show session setup screen with continue button
        showScreen('sessionSetup');
        document.getElementById('session-canvas-url').value = url.replace('https://', '').replace('http://', '');
        document.getElementById('session-login-btn').classList.add('hidden');
        document.getElementById('session-continue-btn').classList.remove('hidden');
      }
    } catch (error) {
      console.error('Session check failed:', error);
      showScreen('sessionSetup');
    }
  } else {
    // No URL configured, show session setup
    showScreen('sessionSetup');
  }

  setupEventListeners();
}

function setupEventListeners() {
  // Session auth
  document.getElementById('session-login-btn').addEventListener('click', handleSessionLogin);
  document.getElementById('session-continue-btn').addEventListener('click', handleSessionContinue);

  // Main screen
  document.getElementById('course-select').addEventListener('change', handleCourseChange);
  document.getElementById('study-bot-btn').addEventListener('click', createStudyBot);

  // Settings button - show modal
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsModal = document.getElementById('close-settings-modal');

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
      updateThemeButtons();
    });
  }

  if (closeSettingsModal && settingsModal) {
    closeSettingsModal.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });

    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
      }
    });
  }

  // Theme toggle buttons in modal
  const lightThemeBtn = document.getElementById('light-theme-btn');
  const darkThemeBtn = document.getElementById('dark-theme-btn');

  if (lightThemeBtn) {
    lightThemeBtn.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      chrome.storage.local.set({ 'theme-preference': 'light' });
      updateThemeButtons();
    });
  }

  if (darkThemeBtn) {
    darkThemeBtn.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      chrome.storage.local.set({ 'theme-preference': 'dark' });
      updateThemeButtons();
    });
  }

  // Theme toggle icon on Canvas login screen
  const sessionThemeToggle = document.getElementById('session-theme-toggle');
  if (sessionThemeToggle) {
    sessionThemeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';

      document.documentElement.setAttribute('data-theme', newTheme);
      chrome.storage.local.set({ 'theme-preference': newTheme });
    });
  }

  // Logout button - clear all data and reset to initial setup
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      // Confirm with user
      const confirmed = confirm(
        'Are you sure you want to logout?\n\n' +
        'This will clear all saved data including:\n' +
        '• Canvas domain and API key\n' +
        '• Gemini API key\n' +
        '• Course materials\n' +
        '• Chat history\n' +
        '• All settings\n\n' +
        'You will need to set everything up again.'
      );

      if (confirmed) {
        try {
          // Clear all chrome.storage.local data
          await chrome.storage.local.clear();

          // Clear all localStorage data
          localStorage.clear();

          // Reload the extension to initial setup state
          window.location.reload();
        } catch (error) {
          console.error('Error during logout:', error);
          alert('Error clearing data. Please try again.');
        }
      }
    });
  }

  function updateThemeButtons() {
    chrome.storage.local.get(['theme-preference'], (result) => {
      const savedTheme = result['theme-preference'];
      let currentTheme;

      if (savedTheme) {
        currentTheme = savedTheme;
      } else {
        // No saved preference, check system
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        currentTheme = prefersDark ? 'dark' : 'light';
      }

      if (lightThemeBtn && darkThemeBtn) {
        if (currentTheme === 'light') {
          lightThemeBtn.classList.add('active');
          darkThemeBtn.classList.remove('active');
        } else {
          lightThemeBtn.classList.remove('active');
          darkThemeBtn.classList.add('active');
        }
      }
    });
  }

  // Add listeners to category checkboxes in simple view
  const categoryCheckboxes = document.querySelectorAll('.category-checkbox');
  console.log('[DEBUG] Found category checkboxes in simple view:', categoryCheckboxes.length);

  categoryCheckboxes.forEach((checkbox) => {
    console.log('[DEBUG] Adding listener to category checkbox:', checkbox.id);
    checkbox.addEventListener('change', (e) => {
      console.log('[DEBUG] Category checkbox clicked:', e.target.id, 'checked:', e.target.checked);
    });
  });

  // Detailed view toggle
  document.getElementById('toggle-detailed-view').addEventListener('click', toggleDetailedView);
}

function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen.classList.add('hidden'));
  screens[screenName].classList.remove('hidden');
}

function showAuthMethodScreen() {
  // Always go to session setup now
  showScreen('sessionSetup');
}

function showError(element, message) {
  element.textContent = message;
  element.classList.add('show');
}

function hideError(element) {
  element.textContent = '';
  element.classList.remove('show');
}

// ========== SESSION AUTH ==========

async function handleSessionLogin() {
  const url = document.getElementById('session-canvas-url').value.trim();
  const errorEl = document.getElementById('session-error');

  hideError(errorEl);

  if (!url) {
    showError(errorEl, 'Please enter your Canvas URL');
    return;
  }

  try {
    const btn = document.getElementById('session-login-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    // Save Canvas URL and set auth method
    await StorageManager.saveCanvasUrl(url);
    await StorageManager.saveAuthMethod('session');

    const savedUrl = await StorageManager.getCanvasUrl();

    // Open Canvas login page
    const loginUrl = `${savedUrl}/login`;
    chrome.tabs.create({ url: loginUrl });

    // Show continue button
    btn.classList.add('hidden');
    document.getElementById('session-continue-btn').classList.remove('hidden');
  } catch (error) {
    showError(errorEl, error.message);
    document.getElementById('session-login-btn').disabled = false;
    document.getElementById('session-login-btn').textContent = 'Log in to Canvas';
  }
}

async function handleSessionContinue() {
  const errorEl = document.getElementById('session-error');
  const btn = document.getElementById('session-continue-btn');

  try {
    btn.disabled = true;
    btn.textContent = 'Checking login status...';

    // First check if URL has been entered
    const urlInput = document.getElementById('session-canvas-url');
    let url = await StorageManager.getCanvasUrl();

    // If no URL saved yet, try to save from input field
    if (!url && urlInput && urlInput.value.trim()) {
      await StorageManager.saveCanvasUrl(urlInput.value.trim());
      await StorageManager.saveAuthMethod('session');
      url = await StorageManager.getCanvasUrl();
    }

    if (!url) {
      showError(errorEl, 'Please enter your Canvas URL first');
      btn.disabled = false;
      btn.textContent = 'I\'m Logged In - Continue';
      return;
    }

    const sessionAuth = new SessionAuth(url);

    // Test if logged in
    console.log('Testing Canvas session...');
    const isValid = await sessionAuth.testSession();

    if (!isValid) {
      showError(errorEl, 'Not logged in to Canvas. Please log in and try again.');
      btn.disabled = false;
      btn.textContent = 'I\'m Logged In - Continue';
      return;
    }

    console.log('Session valid! Loading main screen...');

    // Initialize API with session auth
    currentAuthMethod = 'session';
    canvasAPI = new CanvasAPI(url, null, 'session');

    await loadMainScreen();
  } catch (error) {
    console.error('Session continue error:', error);
    showError(errorEl, error.message);
    btn.disabled = false;
    btn.textContent = 'I\'m Logged In - Continue';
  }
}


// ========== MAIN SCREEN ==========

async function loadMainScreen() {
  try {
    // Initialize Canvas API if not already done
    if (!canvasAPI) {
      const url = await StorageManager.getCanvasUrl();
      canvasAPI = new CanvasAPI(url, null, 'session');
    }

    // Fetch and store Canvas user ID if not already stored
    const existingUserId = await StorageManager.getCanvasUserId();
    if (!existingUserId && canvasAPI) {
      await canvasAPI.fetchAndStoreUserId();
    }

    showScreen('main');
    await loadCourses();
    await loadRecentCourses();
  } catch (error) {
    console.error('Error loading main screen:', error);
    showAuthMethodScreen();
  }
}

async function loadCourses() {
  try {
    document.getElementById('course-loading').classList.remove('hidden');
    document.getElementById('course-select').classList.add('hidden');
    hideError(document.getElementById('course-error'));

    const courses = await canvasAPI.getCourses();

    const select = document.getElementById('course-select');
    select.innerHTML = '<option value="">-- Select a course --</option>';

    courses.forEach(course => {
      const option = document.createElement('option');
      option.value = course.id;
      option.textContent = course.name;
      select.appendChild(option);
    });

    document.getElementById('course-loading').classList.add('hidden');
    document.getElementById('course-select').classList.remove('hidden');

    // Check for current course from content script
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_COURSE' }, (response) => {
      if (response && response.courseInfo) {
        select.value = response.courseInfo.id;
        handleCourseChange();
      }
    });
  } catch (error) {
    console.error('Error loading courses:', error);
    document.getElementById('course-loading').classList.add('hidden');
    showError(document.getElementById('course-error'), 'Failed to load courses: ' + error.message);
  }
}

async function loadRecentCourses() {
  try {
    const materialsDB = new MaterialsDB();
    const courseIds = await materialsDB.listCourses();

    if (!courseIds || courseIds.length === 0) {
      // No recent courses, keep section hidden
      document.getElementById('recent-courses-section').classList.add('hidden');
      await materialsDB.close();
      return;
    }

    // Load course details for each course ID
    const recentCourses = [];
    for (const courseId of courseIds) {
      const materialsData = await materialsDB.loadMaterials(courseId);
      if (materialsData && materialsData.courseName) {
        // Debug log to check what courseName type we're getting
        console.log('[Recent Courses] courseId:', courseId, 'courseName type:', typeof materialsData.courseName, 'value:', materialsData.courseName);

        // Ensure we have a valid course name (not an object)
        let courseName;
        if (typeof materialsData.courseName === 'string') {
          courseName = materialsData.courseName;
        } else if (typeof materialsData.courseName === 'object' && materialsData.courseName !== null) {
          // If courseName is an object, try to extract a name property
          courseName = materialsData.courseName.name || materialsData.courseName.courseName || 'Unknown Course';
          console.warn('⚠️ courseName was an object, extracted:', courseName);
        } else {
          courseName = String(materialsData.courseName);
        }

        recentCourses.push({
          id: String(courseId), // Ensure courseId is a string
          name: courseName,
          lastUpdated: materialsData.lastUpdated
        });
      }
    }

    await materialsDB.close();

    // Sort by last updated (most recent first) - show ALL courses
    recentCourses.sort((a, b) => b.lastUpdated - a.lastUpdated);

    if (recentCourses.length === 0) {
      document.getElementById('recent-courses-section').classList.add('hidden');
      return;
    }

    // Display recent courses
    const recentCoursesSection = document.getElementById('recent-courses-section');
    const recentCoursesList = document.getElementById('recent-courses-list');

    recentCoursesList.innerHTML = '';

    recentCourses.forEach(course => {
      const courseItem = document.createElement('div');
      courseItem.className = 'recent-course-card';
      courseItem.innerHTML = `
        <div class="recent-course-name">${course.name}</div>
        <div class="recent-course-code">${formatTimeAgo(course.lastUpdated)}</div>
      `;
      courseItem.addEventListener('click', () => {
        // Open chat page directly for this course
        const chatUrl = chrome.runtime.getURL(`chat/chat.html?courseId=${course.id}`);
        chrome.tabs.create({ url: chatUrl });
      });
      recentCoursesList.appendChild(courseItem);
    });

    recentCoursesSection.classList.remove('hidden');
  } catch (error) {
    console.error('Error loading recent courses:', error);
    // Don't show error to user, just keep section hidden
    document.getElementById('recent-courses-section').classList.add('hidden');
  }
}

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

async function handleCourseChange() {
  const courseId = document.getElementById('course-select').value;

  console.log('🎯 [Popup] Course selected:', courseId);

  if (!courseId) {
    document.getElementById('material-section').classList.add('hidden');
    // Disable study bot button when no course selected
    const studyBotBtn = document.getElementById('study-bot-btn');
    studyBotBtn.disabled = true;
    studyBotBtn.title = 'Please select a course first';
    return;
  }

  // Disable study bot button immediately when switching courses
  const studyBotBtn = document.getElementById('study-bot-btn');
  studyBotBtn.disabled = true;
  studyBotBtn.title = 'Loading course materials...';

  const courseName = document.getElementById('course-select').options[document.getElementById('course-select').selectedIndex].text;
  currentCourse = { id: courseId, name: courseName };

  console.log('📌 [Popup] Set currentCourse:', currentCourse);

  await scanCourseMaterials(courseId, courseName);
}

async function scanCourseMaterials(courseId, courseName) {
  const studyBotBtn = document.getElementById('study-bot-btn');

  try {
    // Disable button and show loading state
    studyBotBtn.disabled = true;
    studyBotBtn.title = 'Loading course materials...';

    document.getElementById('material-section').classList.remove('hidden');
    document.getElementById('course-name').textContent = courseName;
    document.getElementById('scan-loading').classList.remove('hidden');
    document.getElementById('material-summary').classList.add('hidden');
    hideError(document.getElementById('material-error'));

    const materials = await canvasAPI.getAllCourseMaterials(courseId, (status) => {
      document.getElementById('scan-status').textContent = status;
    });

    scannedMaterials = materials;

    const preferences = getPreferencesFromUI();
    fileProcessor.processMaterials(materials, preferences);

    updateMaterialSummary();

    document.getElementById('scan-loading').classList.add('hidden');
    document.getElementById('material-summary').classList.remove('hidden');

    // Re-enable study bot button after materials are loaded
    studyBotBtn.disabled = false;
    studyBotBtn.title = 'Create an AI study bot for this course';

    // PRE-EMPTIVE OPTIMIZATION: Start checking files in background before user clicks button
    // This makes the subsequent "Create Study Bot" click feel instant
    preCheckFilesInBackground(courseId, courseName);
  } catch (error) {
    console.error('Error scanning materials:', error);
    document.getElementById('scan-loading').classList.add('hidden');
    showError(document.getElementById('material-error'), 'Failed to scan materials: ' + error.message);
    // Keep study bot button disabled on error
    studyBotBtn.disabled = true;
    studyBotBtn.title = 'Cannot create study bot - materials failed to load';
  }
}

function updateMaterialSummary() {
  const preferences = getPreferencesFromUI();

  if (scannedMaterials) {
    fileProcessor.processMaterials(scannedMaterials, preferences);
  }

  const totalSize = fileProcessor.getTotalSize();

  // Calculate summary directly from scannedMaterials for accurate counts
  // This shows ALL modules and files, not just filtered ones
  const summary = {
    total: 0,
    modules: 0,
    moduleFiles: 0,
    standaloneFiles: 0,
    pages: 0,
    assignments: 0
  };

  if (scannedMaterials) {
    // Count ALL modules (not filtered by file type)
    if (scannedMaterials.modules) {
      summary.modules = scannedMaterials.modules.length;
      scannedMaterials.modules.forEach(module => {
        if (module.items) {
          // Count files in modules
          summary.moduleFiles += module.items.filter(item => item.type === 'File').length;
        }
      });
    }

    // Count standalone files
    if (scannedMaterials.files) {
      summary.standaloneFiles = scannedMaterials.files.length;
    }

    // Count pages
    if (scannedMaterials.pages) {
      summary.pages = scannedMaterials.pages.length;
    }

    // Count assignments
    if (scannedMaterials.assignments) {
      summary.assignments = scannedMaterials.assignments.length;
    }

    summary.total = summary.moduleFiles + summary.standaloneFiles + summary.pages + summary.assignments;
  }

  // Show breakdown instead of just total
  const fileCount = (summary.moduleFiles || 0) + (summary.standaloneFiles || 0);
  const pageCount = summary.pages || 0;
  const assignmentCount = summary.assignments || 0;

  let countText = `${fileCount} files`;
  if (pageCount > 0) countText += ` • ${pageCount} pages`;
  if (assignmentCount > 0) countText += ` • ${assignmentCount} assignments`;

  document.getElementById('total-count').textContent = countText;
  document.getElementById('total-size').textContent = fileProcessor.formatBytes(totalSize);

  document.getElementById('modules-count').textContent = summary.modules || 0;
  document.getElementById('module-files-count').textContent = summary.moduleFiles || 0;
  document.getElementById('standalone-files-count').textContent = summary.standaloneFiles || 0;
  document.getElementById('pages-count').textContent = summary.pages || 0;
  document.getElementById('assignments-count').textContent = summary.assignments || 0;
}

function getPreferencesFromUI() {
  // No preferences needed anymore - we include all modules and files
  return {};
}

// ========== AI STUDY BOT ==========

/**
 * Download PDFs in parallel for significantly faster performance
 *
 * @param {Array} pdfFiles - Array of {url, name} objects
 * @param {CanvasAPI} canvasAPI - Canvas API instance for downloading
 * @param {Function} progressCallback - Called with (completed, total) after each download
 * @param {Number} concurrency - Number of simultaneous downloads (default: 8)
 * @returns {Promise<Array>} - Array of {blob, name} objects successfully downloaded
 *
 * Performance: Downloads 25 PDFs in ~3-5 seconds vs 25-30 seconds sequentially
 */
async function downloadPDFsInParallel(pdfFiles, canvasAPI, progressCallback, concurrency = 16) {
  const filesToUpload = [];
  let completed = 0;
  const total = pdfFiles.length;

  // Download single PDF with retry logic
  const downloadPDF = async (pdf) => {
    try {
      const blob = await canvasAPI.downloadFile(pdf.url);
      filesToUpload.push({ blob, name: pdf.name });
      completed++;
      if (progressCallback) progressCallback(completed, total);
      console.log(`✅ Downloaded ${pdf.name} (${completed}/${total})`);
      return { success: true, name: pdf.name };
    } catch (error) {
      completed++;
      if (progressCallback) progressCallback(completed, total);
      console.warn(`❌ Failed to download ${pdf.name}:`, error);
      return { success: false, name: pdf.name, error };
    }
  };

  // Process downloads in batches for controlled parallelism
  const downloadBatch = async (batch) => {
    return Promise.all(batch.map(pdf => downloadPDF(pdf)));
  };

  // Split files into batches
  const batches = [];
  for (let i = 0; i < pdfFiles.length; i += concurrency) {
    batches.push(pdfFiles.slice(i, i + concurrency));
  }

  // Download all batches sequentially (but files within each batch in parallel)
  for (const batch of batches) {
    await downloadBatch(batch);
  }

  console.log(`📦 Downloaded ${filesToUpload.length}/${total} PDFs successfully`);
  return filesToUpload;
}

/**
 * Pre-emptively check which files exist in GCS in background
 * This runs after course materials are scanned, before user clicks "Create Study Bot"
 * Makes the button click feel instant since checking is already done!
 *
 * @param {string} courseId - Course identifier
 * @param {string} courseName - Course name
 */
async function preCheckFilesInBackground(courseId, courseName) {
  try {
    console.log('⚡ [PRE-CHECK] Starting background file check...');

    // Build file list (same logic as createStudyBot)
    const materialsToProcess = filterMaterialsByPreferences(scannedMaterials, {});

    const filesToProcess = [];

    // Collect files from materials
    const processItem = (item) => {
      const itemName = item.stored_name || item.display_name || item.filename || item.name || item.title;
      if (!itemName || !item.url) return;

      filesToProcess.push({
        name: itemName,
        url: item.url,
        id: item.content_id || item.id || item.file_id
      });
    };

    // Process standalone files
    for (const [category, items] of Object.entries(materialsToProcess)) {
      if (category === 'modules' || category === 'pages' || category === 'assignments' || !Array.isArray(items)) continue;
      items.forEach(processItem);
    }

    // Process module items
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      materialsToProcess.modules.forEach((module) => {
        if (module.items && Array.isArray(module.items)) {
          module.items.forEach(item => {
            if (item.type === 'File' && item.url) {
              processItem(item);
            }
          });
        }
      });
    }

    if (filesToProcess.length === 0) {
      console.log('⚡ [PRE-CHECK] No files to check');
      preCheckedFiles = { exists: [], missing: [] };
      return;
    }

    console.log(`⚡ [PRE-CHECK] Checking ${filesToProcess.length} files...`);

    // Make the check request (this happens in background while user is reading the summary)
    const checkResponse = await fetch(`https://web-production-9aaba7.up.railway.app/check_files_exist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: courseId,
        files: filesToProcess
      })
    });

    if (checkResponse.ok) {
      const result = await checkResponse.json();
      preCheckedFiles = {
        exists: result.exists || [],
        missing: result.missing || [],
        timestamp: Date.now(),
        courseId: courseId
      };
      console.log(`✅ [PRE-CHECK] Complete! ${result.exists.length} in GCS, ${result.missing.length} need uploading`);
      console.log('⚡ [PRE-CHECK] Next "Create Study Bot" click will be INSTANT!');
    } else {
      console.warn('⚠️ [PRE-CHECK] Failed, will check on button click');
      preCheckedFiles = null;
    }
  } catch (error) {
    console.warn('⚠️ [PRE-CHECK] Error:', error.message);
    preCheckedFiles = null;
  }
}

/**
 * Check if materials are cached in IndexedDB and still fresh
 *
 * @param {string} courseId - Course identifier
 * @returns {Promise<Object|null>} - Cached materials or null if not found/stale
 */
async function checkCachedMaterials(courseId) {
  try {
    const materialsDB = new MaterialsDB();
    const cached = await materialsDB.loadMaterials(courseId);
    await materialsDB.close();

    if (!cached) {
      console.log('📭 No cached materials found in IndexedDB');
      chrome.runtime.sendMessage({
        type: 'LOG_FROM_POPUP',
        message: `📭 [POPUP] No cached materials found for course ${courseId}`
      });
      return null;
    }

    // Check if cache is fresh (< 24 hours old)
    const cacheAge = Date.now() - cached.lastUpdated;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (cacheAge > maxAge) {
      console.log(`🕐 Cached materials too old (${Math.floor(cacheAge / (60 * 60 * 1000))} hours), will refresh`);
      chrome.runtime.sendMessage({
        type: 'LOG_FROM_POPUP',
        message: `🕐 [POPUP] Cache too old: ${Math.floor(cacheAge / (60 * 60 * 1000))} hours`
      });
      return null;
    }

    console.log(`✅ Found fresh cached materials (${Math.floor(cacheAge / (60 * 1000))} minutes old)`);

    // Log how many materials have hashes
    let totalMaterials = 0;
    let materialsWithHash = 0;
    for (const [category, items] of Object.entries(cached.materials || {})) {
      if (Array.isArray(items)) {
        items.forEach(item => {
          totalMaterials++;
          if (item.hash) materialsWithHash++;
        });
      } else if (category === 'modules' && Array.isArray(items)) {
        items.forEach(module => {
          if (module.items) {
            module.items.forEach(item => {
              totalMaterials++;
              if (item.hash) materialsWithHash++;
            });
          }
        });
      }
    }
    console.log(`[CACHE] Loaded materials: ${totalMaterials} total, ${materialsWithHash} WITH hashes`);

    return cached;
  } catch (error) {
    console.error('Error checking cached materials:', error);
    return null;
  }
}

/**
 * Compare scanned materials with cached materials to find files that need downloading
 *
 * @param {Object} scanned - Freshly scanned materials from Canvas API
 * @param {Object} cached - Cached materials from IndexedDB
 * @returns {Array} - Array of file items that need to be downloaded
 */
function findFilesToDownload(scanned, cached) {
  const cachedFiles = new Map();

  // Build map of cached files with blobs (key = url)
  if (cached && cached.materials) {
    for (const [category, items] of Object.entries(cached.materials)) {
      if (!Array.isArray(items)) continue;

      items.forEach(item => {
        if (item.url && item.blob) {
          cachedFiles.set(item.url, item);
        }
      });
    }

    // Also check module items
    if (cached.materials.modules && Array.isArray(cached.materials.modules)) {
      cached.materials.modules.forEach(module => {
        if (module.items && Array.isArray(module.items)) {
          module.items.forEach(item => {
            if (item.url && item.blob) {
              cachedFiles.set(item.url, item);
            }
          });
        }
      });
    }
  }

  console.log(`📦 Found ${cachedFiles.size} cached files with blobs`);

  const filesToDownload = [];

  // Check all scanned files to see which ones need downloading
  const checkItems = (items) => {
    if (!Array.isArray(items)) return;

    items.forEach(item => {
      if (item.url) {
        if (!cachedFiles.has(item.url)) {
          filesToDownload.push(item);
        }
      }
    });
  };

  // Check all categories
  for (const [category, items] of Object.entries(scanned)) {
    if (category === 'modules') {
      // Handle module items separately
      if (Array.isArray(items)) {
        items.forEach(module => {
          if (module.items && Array.isArray(module.items)) {
            checkItems(module.items);
          }
        });
      }
    } else {
      checkItems(items);
    }
  }

  console.log(`🆕 ${filesToDownload.length} new files need downloading`);
  return filesToDownload;
}

/**
 * Merge cached blobs with scanned materials
 *
 * @param {Object} scanned - Freshly scanned materials
 * @param {Object} cached - Cached materials with blobs
 * @returns {Object} - Merged materials with cached blobs attached
 */
function mergeCachedBlobs(scanned, cached) {
  if (!cached || !cached.materials) return scanned;

  const blobMap = new Map();

  // Build blob map from cached materials (key = url)
  const extractBlobs = (items) => {
    if (!Array.isArray(items)) return;

    items.forEach(item => {
      if (item.url) {
        blobMap.set(item.url, {
          blob: item.blob,
          stored_name: item.stored_name,
          hash: item.hash  // CRITICAL: Preserve hash for deduplication
        });
      }
    });
  };

  // Extract blobs from all categories
  for (const items of Object.values(cached.materials)) {
    extractBlobs(items);
  }

  // Extract from modules
  if (cached.materials.modules && Array.isArray(cached.materials.modules)) {
    cached.materials.modules.forEach(module => {
      if (module.items) extractBlobs(module.items);
    });
  }

  // Count hashes in blob map
  const hashCount = Array.from(blobMap.values()).filter(v => v.hash).length;
  console.log(`🔗 Built blob map with ${blobMap.size} cached items (${hashCount} with hashes)`);

  // Attach cached blobs to scanned materials
  const attachBlobs = (items) => {
    if (!Array.isArray(items)) return;

    items.forEach(item => {
      if (item.url && blobMap.has(item.url)) {
        const cached = blobMap.get(item.url);
        item.blob = cached.blob;
        item.stored_name = cached.stored_name;
        item.hash = cached.hash;  // CRITICAL: Copy hash for deduplication
      }
    });
  };

  // Attach to all categories
  const merged = { ...scanned };
  for (const items of Object.values(merged)) {
    attachBlobs(items);
  }

  // Attach to modules
  if (merged.modules && Array.isArray(merged.modules)) {
    merged.modules.forEach(module => {
      if (module.items) attachBlobs(module.items);
    });
  }

  return merged;
}

/**
 * Continue loading files in background after chat opens
 * Downloads files, uploads to backend, and updates IndexedDB
 */
async function continueLoadingInBackground(courseId, courseName, filesToDownload, filesToUploadToBackend, materialsToProcess, backendClient, canvasAPI) {
  try {
    console.log('📥 Background loading started:', filesToDownload.length, 'files to download');

    // Send initial progress message
    chrome.runtime.sendMessage({
      type: 'MATERIALS_LOADING_PROGRESS',
      courseId: courseId,
      status: 'loading',
      filesCompleted: 0,
      filesTotal: filesToDownload.length,
      message: `Downloading ${filesToDownload.length} files...`
    });

    // Download files in parallel
    const downloadedFiles = [];
    let completed = 0;
    const concurrency = 16;

    const downloadFile = async (file) => {
      try {
        const blob = await canvasAPI.downloadFile(file.url);
        let fileName = file.name;
        if (!fileName.includes('.')) {
          const mimeToExt = {
            'application/pdf': '.pdf',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
            'application/vnd.ms-powerpoint': '.ppt',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'application/vnd.ms-excel': '.xls',
            'text/plain': '.txt',
            'text/markdown': '.md',
            'text/csv': '.csv',
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp'
          };
          const ext = mimeToExt[blob.type];
          if (ext) fileName = fileName + ext;
        }

        // Compute hash immediately at download time for hash-based identification
        const hash = await computeFileHash(blob);

        downloadedFiles.push({ blob, name: fileName, hash, canvasId: file.id });
        completed++;

        // Send progress update
        chrome.runtime.sendMessage({
          type: 'MATERIALS_LOADING_PROGRESS',
          courseId: courseId,
          status: 'loading',
          filesCompleted: completed,
          filesTotal: filesToDownload.length,
          message: `Downloaded ${completed}/${filesToDownload.length} files`
        });

        return { success: true, name: file.name };
      } catch (error) {
        completed++;
        console.error(`Failed to download ${file.name}:`, error);
        return { success: false, name: file.name, error };
      }
    };

    // Process in batches
    const batches = [];
    for (let i = 0; i < filesToDownload.length; i += concurrency) {
      batches.push(filesToDownload.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      await Promise.all(batch.map(file => downloadFile(file)));
    }

    console.log(`📦 Downloaded ${downloadedFiles.length}/${filesToDownload.length} files`);

    // Upload to backend if needed
    if (downloadedFiles.length > 0 && filesToUploadToBackend.length > 0) {
      chrome.runtime.sendMessage({
        type: 'MATERIALS_LOADING_PROGRESS',
        courseId: courseId,
        status: 'uploading',
        message: `Uploading ${downloadedFiles.length} files to backend...`
      });

      const uploadSet = new Set(filesToUploadToBackend.map(f => f.name));
      const filesToActuallyUpload = downloadedFiles.filter(f => {
        const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
        return uploadSet.has(f.name) || uploadSet.has(nameWithoutExt);
      });

      if (filesToActuallyUpload.length > 0) {
        const uploadResult = await backendClient.uploadPDFs(courseId, filesToActuallyUpload);
        console.log(`✅ Uploaded ${filesToActuallyUpload.length} files to backend`);

        // Check for unreadable files and filter them out
        if (uploadResult && uploadResult.files) {
          const unreadableFiles = uploadResult.files.filter(f => f.unreadable === true);

          if (unreadableFiles.length > 0) {
            const unreadableNames = unreadableFiles.map(f => f.filename).join(', ');
            console.warn(`⚠️ ${unreadableFiles.length} files could not be converted:`, unreadableNames);

            // Show alert to user (simple notification)
            alert(`⚠️ ${unreadableFiles.length} file(s) could not be converted and won't be available to the AI:\n\n${unreadableNames}\n\nThese files will not appear in your file list.`);

            // Remove unreadable files from materialsToProcess
            const unreadableSet = new Set(unreadableFiles.map(f => f.filename));
            for (const [key, items] of Object.entries(materialsToProcess)) {
              if (Array.isArray(items)) {
                materialsToProcess[key] = items.filter(item => {
                  const itemName = item.display_name || item.filename || item.name || item.title;
                  return !unreadableSet.has(itemName);
                });
              }
            }

            // Remove from module items
            if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
              materialsToProcess.modules.forEach((module) => {
                if (module.items && Array.isArray(module.items)) {
                  module.items = module.items.filter(item => {
                    const itemName = item.title || item.name || item.display_name;
                    return !unreadableSet.has(itemName);
                  });
                }
              });
            }
          }
        }
      }
    }

    // Attach blobs and hashes to materials
    const blobMap = new Map();
    const hashMap = new Map();
    downloadedFiles.forEach(df => {
      blobMap.set(df.name, df.blob);
      hashMap.set(df.name, df.hash);
      const nameWithoutExt = df.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
      blobMap.set(nameWithoutExt, df.blob);
      hashMap.set(nameWithoutExt, df.hash);
    });

    // Attach to all items
    for (const items of Object.values(materialsToProcess)) {
      if (!Array.isArray(items)) continue;
      items.forEach((item) => {
        let itemName = item.display_name || item.filename || item.name || item.title;
        if (itemName && blobMap.has(itemName)) {
          item.blob = blobMap.get(itemName);
          item.hash = hashMap.get(itemName);
          for (const [fileName, blob] of blobMap) {
            if (blob === item.blob && fileName.includes('.')) {
              item.stored_name = fileName;
              break;
            }
          }
        }
      });
    }

    // Attach to module items
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      materialsToProcess.modules.forEach((module) => {
        if (module.items && Array.isArray(module.items)) {
          module.items.forEach((item) => {
            let itemName = item.title || item.name || item.display_name;
            if (itemName && blobMap.has(itemName)) {
              item.blob = blobMap.get(itemName);
              item.hash = hashMap.get(itemName);
              for (const [fileName, blob] of blobMap) {
                if (blob === item.blob && fileName.includes('.')) {
                  item.stored_name = fileName;
                  break;
                }
              }
            }
          });
        }
      });
    }

    // Update IndexedDB with complete materials
    const materialsDB = new MaterialsDB();
    await materialsDB.saveMaterials(courseId, courseName, materialsToProcess);
    await materialsDB.close();

    console.log('✅ Background loading complete');

    // Send completion message
    chrome.runtime.sendMessage({
      type: 'MATERIALS_LOADING_COMPLETE',
      courseId: courseId,
      status: 'complete',
      message: 'All materials loaded!'
    });

  } catch (error) {
    console.error('❌ Background loading failed:', error);

    chrome.runtime.sendMessage({
      type: 'MATERIALS_LOADING_ERROR',
      courseId: courseId,
      status: 'error',
      error: error.message
    });
  }
}

/**
 * Create Study Bot - Upload PDFs to backend and open chat interface
 *
 * This function handles the optimized upload flow:
 * 1. Checks IndexedDB for cached materials (FAST PATH)
 * 2. Checks backend for already-uploaded files (caching)
 * 3. Downloads only NEW PDFs from Canvas
 * 4. Uploads only new files to backend
 * 5. Opens chat interface IMMEDIATELY (background loading if needed)
 *
 * Performance: <2s to open chat (warm or cold!), loading continues in background
 */
async function createStudyBot() {
  const studyBotBtn = document.getElementById('study-bot-btn');

  try {
    studyBotBtn.disabled = true;
    studyBotBtn.title = 'Creating study bot...';
    document.getElementById('study-bot-progress').classList.remove('hidden');

    // Progress update helper
    const updateProgress = (text, percent) => {
      document.getElementById('study-bot-progress-text').textContent = text;
      document.getElementById('study-bot-progress-fill').style.width = percent + '%';
    };

    updateProgress('Preparing materials...', PROGRESS_PERCENT.PREPARING);

    if (!scannedMaterials) {
      throw new Error('No materials scanned. Please scan materials first.');
    }

    // OPTIMIZATION: Check IndexedDB cache first (FAST PATH)
    updateProgress('Checking cache...', PROGRESS_PERCENT.PREPARING + 5);
    const cachedMaterials = await checkCachedMaterials(currentCourse.id);

    // Get selected materials
    let materialsToProcess;
    if (detailedViewVisible && selectedFiles.size > 0) {
      materialsToProcess = filterSelectedMaterials(scannedMaterials, selectedFiles);
    } else {
      const preferences = getPreferencesFromUI();
      materialsToProcess = filterMaterialsByPreferences(scannedMaterials, preferences);
    }

    // If we have cached materials, merge blobs to avoid re-downloading
    if (cachedMaterials) {
      console.log('🚀 FAST PATH: Using cached materials with blobs');
      chrome.runtime.sendMessage({
        type: 'LOG_FROM_POPUP',
        message: `🚀 [POPUP] FAST PATH: Merging cached materials`
      });
      materialsToProcess = mergeCachedBlobs(materialsToProcess, cachedMaterials);
    } else {
      console.log('⚠️ NO CACHE: Will need to download all files');
      chrome.runtime.sendMessage({
        type: 'LOG_FROM_POPUP',
        message: `⚠️ [POPUP] NO CACHE: cachedMaterials is null/undefined`
      });
    }

    updateProgress('Checking backend...', PROGRESS_PERCENT.BACKEND_CHECK);

    // Check backend and get already uploaded files
    const backendClient = new BackendClient('https://web-production-9aaba7.up.railway.app');
    const isBackendReady = await backendClient.healthCheck();

    if (!isBackendReady) {
      throw new Error('Backend not available. Please start the Python backend.');
    }

    // Get list of files already uploaded
    const statusResponse = await fetch(`https://web-production-9aaba7.up.railway.app/collections/${currentCourse.id}/status`);
    const status = await statusResponse.json();
    const uploadedFileIds = new Set(status.files || []);

    updateProgress('Collecting files...', PROGRESS_PERCENT.COLLECTING);

    // NEW APPROACH: Just collect Canvas URLs, backend will download and process
    const filesToProcess = [];
    const skippedFiles = []; // Track files without URLs
    let filesToUploadToBackend = []; // Pages/assignments converted to text blobs (let for hash reassignment)
    const seenFileKeys = new Set(); // Track files to avoid duplicates
    let duplicatesSkipped = 0;

    // Helper function to collect file info
    const processItem = (item) => {
      const itemName = item.stored_name || item.display_name || item.filename || item.name || item.title;

      if (!itemName) return;

      if (!item.url) {
        console.warn(`⚠️ Skipping "${itemName}" - no download URL from Canvas`);
        skippedFiles.push(itemName);
        return;
      }

      // Deduplicate: same file can appear in Files list AND modules
      // Use Canvas file ID: content_id for modules, id for files
      const fileId = item.content_id || item.id || item.file_id;
      const dedupeKey = fileId || item.url || itemName;

      if (seenFileKeys.has(dedupeKey)) {
        duplicatesSkipped++;
        return; // Skip duplicate
      }
      seenFileKeys.add(dedupeKey);

      filesToProcess.push({
        name: itemName,
        url: item.url,
        id: fileId,  // Canvas file ID for fresh URL generation
        blob: item.blob,  // Include blob if available (for hash computation)
        hash: item.hash   // Include hash if available from IndexedDB/backend
      });
    };

    // Process standalone files only (NOT pages/assignments - they're handled separately below)
    for (const [category, items] of Object.entries(materialsToProcess)) {
      // Skip modules, pages, and assignments - they're processed separately
      if (category === 'modules' || category === 'pages' || category === 'assignments' || !Array.isArray(items)) continue;

      for (const item of items) {
        processItem(item);
      }
    }

    // Process module items (files within modules)
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      materialsToProcess.modules.forEach((module) => {
        if (!module.items || !Array.isArray(module.items)) return;

        module.items.forEach(item => {
          // Only process File type items from modules
          if (item.type === 'File' && item.url) {
            processItem(item);
          }
        });
      });
    }

    // Process assignments: convert descriptions to text files for AI to read
    console.log(`[ASSIGNMENT] Checking materialsToProcess.assignments:`, {
      exists: !!materialsToProcess.assignments,
      isArray: Array.isArray(materialsToProcess.assignments),
      length: materialsToProcess.assignments?.length,
      assignments: materialsToProcess.assignments
    });
    chrome.runtime.sendMessage({
      type: 'LOG_FROM_POPUP',
      message: `🔍 [ASSIGNMENT] materialsToProcess has ${materialsToProcess.assignments?.length || 0} assignments (isArray: ${Array.isArray(materialsToProcess.assignments)})`
    });

    if (materialsToProcess.assignments && Array.isArray(materialsToProcess.assignments)) {
      console.log(`📋 Processing ${materialsToProcess.assignments.length} assignment descriptions for backend upload`);
      chrome.runtime.sendMessage({
        type: 'LOG_FROM_POPUP',
        message: `📋 [ASSIGNMENT] Processing ${materialsToProcess.assignments.length} assignment descriptions`
      });

      materialsToProcess.assignments.forEach((assignment) => {
        // Only process assignments with descriptions
        if (!assignment.description || assignment.description.trim() === '') {
          console.log(`⏭️ Skipping assignment "${assignment.name}" - no description`);
          chrome.runtime.sendMessage({
            type: 'LOG_FROM_POPUP',
            message: `⏭️ [ASSIGNMENT] Skipping "${assignment.name}" - no description`
          });
          return;
        }

        // Strip HTML tags from description to get plain text
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = assignment.description;
        const plainText = tempDiv.textContent || tempDiv.innerText || '';

        if (plainText.trim() === '') {
          console.log(`⏭️ Skipping assignment "${assignment.name}" - empty after HTML strip`);
          return;
        }

        // Create text content with assignment metadata
        const assignmentText = `Assignment: ${assignment.name}\n` +
                              `Due Date: ${assignment.due_at ? new Date(assignment.due_at).toLocaleString() : 'No due date'}\n` +
                              `Canvas URL: ${assignment.html_url}\n\n` +
                              `Description:\n${plainText.trim()}`;

        // Create text blob
        const textBlob = new Blob([assignmentText], { type: 'text/plain' });

        // Create filename: prefix with [Assignment] for clarity
        const safeName = assignment.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
        const filename = `[Assignment] ${safeName}.txt`;

        // Add blob and stored_name to assignment object
        assignment.blob = textBlob;
        assignment.stored_name = filename;  // Enable backend matching by filename

        console.log(`📝 [ASSIGNMENT] Created blob for "${assignment.name}":`, {
          stored_name: assignment.stored_name,
          blob_size: textBlob.size,
          has_id: !!assignment.id,
          id: assignment.id,
          has_html_url: !!assignment.html_url
        });
        chrome.runtime.sendMessage({
          type: 'LOG_FROM_POPUP',
          message: `📝 [ASSIGNMENT] Created blob for "${assignment.name}": size=${textBlob.size}, id=${assignment.id}, stored_name=${assignment.stored_name}`
        });

        // Check if already uploaded
        const fileId = `${currentCourse.id}_[Assignment] ${safeName}`;

        if (!uploadedFileIds.has(fileId)) {
          // Add to backend upload queue
          filesToUploadToBackend.push({
            blob: textBlob,
            name: filename,
            type: 'txt'
          });

          console.log(`✅ [ASSIGNMENT] Queued "${assignment.name}" for backend upload as ${filename}`);
          chrome.runtime.sendMessage({
            type: 'LOG_FROM_POPUP',
            message: `✅ [ASSIGNMENT] Queued "${assignment.name}" as ${filename}`
          });
        } else {
          console.log(`⏭️ [ASSIGNMENT] "${assignment.name}" already uploaded to backend`);
        }

        // Process assignment attachments as separate files
        if (assignment.attachments && Array.isArray(assignment.attachments) && assignment.attachments.length > 0) {
          console.log(`📎 [ASSIGNMENT] Processing ${assignment.attachments.length} attachment(s) for "${assignment.name}"`);
          chrome.runtime.sendMessage({
            type: 'LOG_FROM_POPUP',
            message: `📎 [ASSIGNMENT] Processing ${assignment.attachments.length} attachment(s) for "${assignment.name}"`
          });

          assignment.attachments.forEach(attachment => {
            if (attachment.url && attachment.filename) {
              // Create a unique key for deduplication
              const attachmentKey = `${currentCourse.id}_attachment_${attachment.id}`;

              if (!seenFileKeys.has(attachmentKey)) {
                seenFileKeys.add(attachmentKey);

                filesToProcess.push({
                  name: attachment.filename,
                  url: attachment.url,
                  id: attachment.id,
                  canvas_id: attachment.id,
                  size: attachment.size,
                  type: 'attachment',
                  parent_assignment: assignment.name,
                  display_name: `${attachment.filename} (from ${assignment.name})`
                });

                console.log(`📎 [ASSIGNMENT] Added attachment: ${attachment.filename} (${attachment.size} bytes)`);
                chrome.runtime.sendMessage({
                  type: 'LOG_FROM_POPUP',
                  message: `📎 [ASSIGNMENT] Added attachment: ${attachment.filename}`
                });
              }
            }
          });
        }
      });
    }

    // Process pages: convert body content to text files for AI to read
    if (materialsToProcess.pages && Array.isArray(materialsToProcess.pages)) {
      console.log(`📄 Processing ${materialsToProcess.pages.length} page body content for backend upload`);

      materialsToProcess.pages.forEach((page) => {
        // Only process pages with body content
        // Note: Canvas API list endpoint may not include body, would need individual fetch
        if (!page.body || page.body.trim() === '') {
          console.log(`⏭️ Skipping page "${page.title}" - no body content available`);
          return;
        }

        // Strip HTML tags from body to get plain text
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = page.body;
        const plainText = tempDiv.textContent || tempDiv.innerText || '';

        if (plainText.trim() === '') {
          console.log(`⏭️ Skipping page "${page.title}" - empty after HTML strip`);
          return;
        }

        // Create text content with page metadata
        const pageText = `Page: ${page.title}\n` +
                        `Canvas URL: ${page.html_url}\n\n` +
                        `Content:\n${plainText.trim()}`;

        // Create text blob
        const textBlob = new Blob([pageText], { type: 'text/plain' });

        // Add blob to page object so it can be opened locally
        page.blob = textBlob;

        // Create filename: prefix with [Page] for clarity
        const safeName = page.title.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
        const filename = `[Page] ${safeName}.txt`;

        // Check if already uploaded
        const fileId = `${currentCourse.id}_[Page] ${safeName}`;

        if (!uploadedFileIds.has(fileId)) {
          // Add to backend upload queue
          filesToUploadToBackend.push({
            blob: textBlob,
            name: filename,
            type: 'txt'
          });

          console.log(`✅ Queued page "${page.title}" for backend upload as ${filename}`);
        } else {
          console.log(`⏭️ Page "${page.title}" already uploaded to backend`);
        }
      });
    }

    // Log summary of files to process
    const filesWithHashInProcess = filesToProcess.filter(f => f.hash).length;
    console.log(`📊 Files to process: ${filesToProcess.length} total, ${filesWithHashInProcess} with hash from IndexedDB`);
    if (duplicatesSkipped > 0) {
      console.log(`🗑️ Removed ${duplicatesSkipped} duplicate files during collection`);
    }

    // Also log to service worker for persistence
    chrome.runtime.sendMessage({
      type: 'LOG_FROM_POPUP',
      message: `📊 [POPUP] Collected ${filesToProcess.length} unique files (skipped ${duplicatesSkipped} duplicates)`
    });
    if (skippedFiles.length > 0) {
      console.warn(`⚠️ ${skippedFiles.length} files skipped (no Canvas download URL):`, skippedFiles);

      // Notify user about unpublished/inaccessible files
      const skippedNames = skippedFiles.slice(0, 10).join('\n• ');
      const moreCount = skippedFiles.length > 10 ? `\n...and ${skippedFiles.length - 10} more` : '';
      alert(`⚠️ ${skippedFiles.length} file(s) are not yet published or accessible and will be skipped:\n\n• ${skippedNames}${moreCount}\n\nThese files won't be available to the AI until they are published in Canvas.`);

      // Remove skipped files from materialsToProcess so they don't show in UI
      const skippedSet = new Set(skippedFiles);
      for (const [key, items] of Object.entries(materialsToProcess)) {
        if (Array.isArray(items)) {
          materialsToProcess[key] = items.filter(item => {
            const itemName = item.stored_name || item.display_name || item.filename || item.name || item.title;
            return !skippedSet.has(itemName);
          });
        }
      }

      // Also remove from module items
      if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
        materialsToProcess.modules.forEach((module) => {
          if (module.items && Array.isArray(module.items)) {
            module.items = module.items.filter(item => {
              const itemName = item.stored_name || item.title || item.name || item.display_name;
              return !skippedSet.has(itemName);
            });
          }
        });
      }
    }

    // CRITICAL: Compute hashes for assignments/pages BEFORE uploading
    if (filesToUploadToBackend.length > 0) {
      console.log(`🔢 [ASSIGNMENT] Computing hashes for ${filesToUploadToBackend.length} backend files (assignments/pages)...`);
      chrome.runtime.sendMessage({
        type: 'LOG_FROM_POPUP',
        message: `🔢 [ASSIGNMENT] Computing hashes for ${filesToUploadToBackend.length} backend files BEFORE upload`
      });

      const hashStartTime = Date.now();
      const backendFilesWithHashes = await Promise.all(filesToUploadToBackend.map(async (file) => {
        if (file.blob) {
          const hash = await computeFileHash(file.blob);
          console.log(`🔢 [ASSIGNMENT] Hash computed for "${file.name}": ${hash?.substring(0, 16)}...`);
          return {
            ...file,
            hash: hash,
            docId: hash ? `${currentCourse.id}_${hash}` : null
          };
        } else {
          return file;
        }
      }));
      const hashDuration = Date.now() - hashStartTime;
      console.log(`✅ Computed hashes for ${backendFilesWithHashes.length} assignments/pages in ${hashDuration}ms`);

      // Update filesToUploadToBackend with hashed versions
      filesToUploadToBackend = backendFilesWithHashes;

      // Build hash map for applying to materials
      const backendHashMap = new Map();
      backendFilesWithHashes.forEach(f => {
        if (f.hash) {
          backendHashMap.set(f.name, f.hash);
          // Also map without extension
          const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
          backendHashMap.set(nameWithoutExt, f.hash);
        }
      });

      // Apply hashes to assignments and pages in materialsToProcess
      console.log(`🔗 [ASSIGNMENT] Applying hashes to assignments and pages...`);
      ['assignments', 'pages'].forEach(category => {
        if (materialsToProcess[category]) {
          materialsToProcess[category].forEach(item => {
            const possibleNames = [
              item.stored_name,
              item.display_name,
              item.filename,
              item.name,
              item.title
            ].filter(Boolean);

            for (const itemName of possibleNames) {
              if (backendHashMap.has(itemName)) {
                item.hash = backendHashMap.get(itemName);
                console.log(`✅ [ASSIGNMENT] Hash applied to "${item.name}": ${item.hash.substring(0, 16)}... (matched by: ${itemName})`);
                chrome.runtime.sendMessage({
                  type: 'LOG_FROM_POPUP',
                  message: `✅ [ASSIGNMENT] Hash applied to "${item.name}"`
                });
                break;
              }
            }
          });
        }
      });
    }

    // Upload pages/assignments text blobs (now with hashes)
    if (filesToUploadToBackend.length > 0) {
      updateProgress(`Uploading ${filesToUploadToBackend.length} pages/assignments as text...`, PROGRESS_PERCENT.UPLOADING - 5);

      try {
        const backendClient = new BackendClient('https://web-production-9aaba7.up.railway.app');
        const uploadResult = await backendClient.uploadPDFs(currentCourse.id, filesToUploadToBackend);
        console.log(`✅ Uploaded ${filesToUploadToBackend.length} pages/assignments as text files`);
        chrome.runtime.sendMessage({
          type: 'LOG_FROM_POPUP',
          message: `✅ [ASSIGNMENT] Uploaded ${filesToUploadToBackend.length} assignments/pages with hashes`
        });

        if (uploadResult.failed_count > 0) {
          console.warn(`⚠️ ${uploadResult.failed_count} text files failed to upload`);
        }
      } catch (error) {
        console.error('❌ Failed to upload pages/assignments:', error);
        // Don't throw - continue with file processing
      }
    }

    // HASH-BASED DUPLICATE DETECTION: Only compute hashes if files have blobs
    let filesToUpload = [];

    if (filesToProcess.length > 0) {
      // Check if files have blobs (frontend already downloaded) or just URLs (backend will download)
      const hasBlobs = filesToProcess.some(f => f.blob);

      let filesWithHashes = filesToProcess;

      if (hasBlobs) {
        // Step 1: Compute hashes for all files (only if we have blobs)
        updateProgress(`Computing file hashes for ${filesToProcess.length} files...`, PROGRESS_PERCENT.UPLOADING - 15);

        const hashStartTime = Date.now();
        filesWithHashes = await Promise.all(filesToProcess.map(async (file) => {
          if (file.blob) {
            const hash = await computeFileHash(file.blob);
            return {
              ...file,
              hash: hash,  // Add hash to file object
              docId: hash ? `${currentCourse.id}_${hash}` : null  // Pre-compute doc_id
            };
          } else {
            // No blob, can't compute hash (backend will handle this)
            return file;
          }
        }));

        const hashDuration = Date.now() - hashStartTime;
        console.log(`✅ Computed hashes for ${filesWithHashes.length} files in ${hashDuration}ms`);

        // CRITICAL: Update materials with computed hashes so they're saved to IndexedDB
        // This enables pure hash-based matching when backend returns
        const hashMap = new Map();
        filesWithHashes.forEach(f => {
          if (f.hash) {
            hashMap.set(f.name, f.hash);
            // Also map without extension
            const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
            hashMap.set(nameWithoutExt, f.hash);
          }
        });

        // Update all material categories with hashes (assignments/pages already done above)
        let hashesApplied = 0;
        const categories = ['files'];
        for (const category of categories) {
          if (!materialsToProcess[category]) continue;

          console.log(`🔗 [ASSIGNMENT] Applying hashes to ${materialsToProcess[category].length} ${category}...`);

          materialsToProcess[category].forEach(item => {
            // Try multiple possible name properties
            const possibleNames = [
              item.stored_name,
              item.display_name,
              item.filename,
              item.name,
              item.title
            ].filter(Boolean);

            for (const itemName of possibleNames) {
              if (hashMap.has(itemName)) {
                item.hash = hashMap.get(itemName);
                hashesApplied++;

                if (category === 'assignments') {
                  console.log(`✅ [ASSIGNMENT] Hash applied to "${item.name}": ${item.hash.substring(0, 16)}... (matched by: ${itemName})`);
                }
                break;
              }
            }

            if (category === 'assignments' && !item.hash) {
              console.warn(`⚠️ [ASSIGNMENT] No hash found for "${item.name}". Tried names:`, possibleNames);
            }
          });
        }

        // Update module items with hashes
        if (materialsToProcess.modules) {
          materialsToProcess.modules.forEach(module => {
            if (module.items) {
              module.items.forEach(item => {
                const possibleNames = [
                  item.stored_name,
                  item.title,
                  item.name,
                  item.display_name
                ].filter(Boolean);

                for (const itemName of possibleNames) {
                  if (hashMap.has(itemName)) {
                    item.hash = hashMap.get(itemName);
                    hashesApplied++;
                    break;
                  }
                }
              });
            }
          });
        }

        console.log(`✅ Applied hashes to ${hashesApplied} materials`);
      } else {
        console.log(`⚡ Skipping hash computation - backend will download and hash files`);
      }

      // Step 2: Check existence only if we have hashes
      if (hasBlobs && filesWithHashes.some(f => f.hash)) {
        // We have hashes, can check for duplicates
        if (preCheckedFiles && preCheckedFiles.courseId === currentCourse.id) {
          // PRE-CHECKED RESULTS AVAILABLE - USE THEM INSTANTLY!
          console.log('⚡⚡⚡ [INSTANT] Using pre-checked results (0ms)!');
          const { exists, missing } = preCheckedFiles;
          console.log(`✅ [PRE-CHECK-CACHED] ${exists.length} files in GCS, ${missing.length} need uploading`);

          // Only upload files that are missing from GCS (match by hash)
          filesToUpload = filesWithHashes.filter(f => {
            // Check if this file's hash is in the missing list
            return missing.some(m => m.hash === f.hash || m.name === f.name);
          });

          if (exists.length > 0) {
            console.log(`⚡ FAST PATH: Skipping ${exists.length} files already in GCS`);
          }
        } else {
          // No pre-check available, check now using hashes (slower path)
          updateProgress(`Checking which files need uploading (${filesWithHashes.length} files)...`, PROGRESS_PERCENT.UPLOADING - 10);

          try {
            // Check files using HASHES - this enables proper duplicate detection
            const checkResponse = await fetch(`https://web-production-9aaba7.up.railway.app/check_files_exist`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                course_id: currentCourse.id,
                files: filesWithHashes.map(f => ({
                  name: f.name,
                  hash: f.hash,
                  url: f.url
                }))
              })
            });

            if (checkResponse.ok) {
              const { exists, missing } = await checkResponse.json();
              console.log(`✅ [POPUP-V2] HASH-BASED CHECK: ${exists.length} files already in GCS, ${missing.length} need uploading`);

              // Only upload files that are missing from GCS (match by hash)
              filesToUpload = filesWithHashes.filter(f => {
                return missing.some(m => m.hash === f.hash);
              });

              if (exists.length > 0) {
                console.log(`⚡ FAST PATH: Skipping ${exists.length} files already in GCS (matched by hash)`);
              }
            } else {
              // If check fails, upload all files
              console.warn(`⚠️ [POPUP-V2] File check failed, will upload all files`);
              filesToUpload = filesWithHashes;
            }
          } catch (error) {
            console.error('❌ [POPUP-V2] File check error:', error);
            // If check fails, upload all files
            filesToUpload = filesWithHashes;
          }
        }
      } else {
        // No hashes available - backend will download and handle duplicate detection
        console.log(`⚡ No hashes available - backend will handle duplicate detection`);
        filesToUpload = filesWithHashes;
      }
    }

    // NEW APPROACH: Send files to background worker for batched upload
    // This allows chat to open immediately while files upload in background
    if (filesToUpload.length > 0) {
      // DEDUPLICATE: Remove duplicate files before uploading
      // Same file can appear in both files list AND modules - deduplicate by URL or hash
      const seenKeys = new Set();
      const deduplicatedFiles = [];
      let hashKeys = 0, urlKeys = 0, idKeys = 0, nameKeys = 0;

      filesToUpload.forEach(f => {
        // Use hash if available (for cached materials), otherwise URL, otherwise Canvas ID, otherwise name
        let key;
        if (f.hash) {
          key = `hash:${f.hash}`;
          hashKeys++;
        } else if (f.url) {
          key = `url:${f.url}`;
          urlKeys++;
        } else if (f.id) {
          key = `id:${f.id}`;
          idKeys++;
        } else {
          key = `name:${f.name}`;
          nameKeys++;
        }

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          deduplicatedFiles.push(f);
        }
      });

      console.log(`🔑 Dedup keys used: ${hashKeys} hash, ${urlKeys} URL, ${idKeys} Canvas ID, ${nameKeys} name`);
      if (deduplicatedFiles.length < filesToUpload.length) {
        console.log(`⚡ Deduplicated ${filesToUpload.length} files → ${deduplicatedFiles.length} unique (removed ${filesToUpload.length - deduplicatedFiles.length} duplicates)`);
        chrome.runtime.sendMessage({
          type: 'LOG_FROM_POPUP',
          message: `⚡ [DEDUP] ${filesToUpload.length} → ${deduplicatedFiles.length} (keys: ${hashKeys} hash, ${urlKeys} url, ${idKeys} id, ${nameKeys} name)`
        });
      }
      filesToUpload = deduplicatedFiles;

      // OPTIMIZATION: Prioritize important files (syllabus, small files) for faster perceived speed
      filesToUpload.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aSize = a.blob?.size || 0;
        const bSize = b.blob?.size || 0;

        // Priority keywords (syllabus, outline, schedule)
        const aPriority = aName.includes('syllabus') || aName.includes('outline') || aName.includes('schedule');
        const bPriority = bName.includes('syllabus') || bName.includes('outline') || bName.includes('schedule');

        if (aPriority && !bPriority) return -1;  // a first
        if (!aPriority && bPriority) return 1;   // b first

        // If both priority or both not priority, sort by size (small first)
        return aSize - bSize;
      });
      console.log(`⚡ Prioritized ${filesToUpload.length} files (priority keywords + small files first)`);

      // Note: Hashes already computed earlier for duplicate detection
      updateProgress(`Preparing ${filesToUpload.length} files for background upload...`, PROGRESS_PERCENT.UPLOADING);

      try {
        // Get Canvas URL and cookies for authentication
        const canvasUrl = await StorageManager.getCanvasUrl();
        const cookies = await chrome.cookies.getAll({ url: canvasUrl });

        // Extract session cookies (Canvas uses various cookie names depending on institution)
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Log what we're about to send
        const hashCountBeforeSend = filesToUpload.filter(f => f.hash).length;
        console.log(`📤 [POPUP] About to send ${filesToUpload.length} files to service worker: ${hashCountBeforeSend} with hash`);

        // Also log to service worker console for persistence
        chrome.runtime.sendMessage({
          type: 'LOG_FROM_POPUP',
          message: `📤 [POPUP] Sending ${filesToUpload.length} files: ${hashCountBeforeSend} with hash`
        });

        if (hashCountBeforeSend === 0 && filesToUpload.length > 0) {
          console.error(`❌ [POPUP] WARNING: No files have hashes! First file:`, filesToUpload[0]);
          // Log first 3 files to service worker for debugging
          chrome.runtime.sendMessage({
            type: 'LOG_FROM_POPUP',
            message: `❌ [POPUP] First 3 files without hashes: ${JSON.stringify(filesToUpload.slice(0, 3).map(f => ({name: f.name, hash: f.hash, id: f.id, url: f.url?.substring(0, 50)})))}`
          });
        }

        // Send files to background worker for batched upload (with hashes)
        await chrome.runtime.sendMessage({
          type: 'START_BACKGROUND_UPLOAD',
          payload: {
            courseId: currentCourse.id,
            files: filesToUpload,  // Files already have hash and docId from earlier
            canvasUrl: canvasUrl,
            cookies: cookieString
          }
        });

        console.log(`📤 Sent ${filesToUpload.length} files (with hashes) to background worker for upload`);
      } catch (error) {
        console.error('❌ Failed to start background upload:', error);
        // Don't throw - still open chat, user can retry upload from chat
      }
    } else {
      console.log('⚡ All files already in GCS - no uploads needed!');
    }

    // Open chat interface immediately - files will upload in background!
    updateProgress('Opening chat...', PROGRESS_PERCENT.COMPLETE);

    // Save materials metadata to IndexedDB (no blobs needed - files are in GCS)
    console.log(`💾 [ASSIGNMENT] Saving materials to IndexedDB...`);
    if (materialsToProcess.assignments) {
      console.log(`💾 [ASSIGNMENT] Assignments being saved:`, materialsToProcess.assignments.map(a => ({
        name: a.name,
        stored_name: a.stored_name,
        hash: a.hash?.substring(0, 16),
        has_id: !!a.id,
        id: a.id,
        has_doc_id: !!a.doc_id
      })));
    }

    const materialsDB = new MaterialsDB();
    await materialsDB.saveMaterials(currentCourse.id, currentCourse.name, materialsToProcess);
    await materialsDB.close();

    // Open chat with loading=true parameter only if files are being uploaded
    const hasFilesToUpload = filesToUpload.length > 0;
    const chatUrl = chrome.runtime.getURL(
      `chat/chat.html?courseId=${currentCourse.id}${hasFilesToUpload ? '&loading=true' : ''}`
    );
    await chrome.tabs.create({ url: chatUrl });

    // Reset UI
    document.getElementById('study-bot-progress').classList.add('hidden');
    studyBotBtn.disabled = false;
    studyBotBtn.title = 'Create an AI study bot for this course';

  } catch (error) {
    console.error('Error creating study bot:', error);
    showError(document.getElementById('material-error'), 'Failed to create study bot: ' + error.message);
    document.getElementById('study-bot-progress').classList.add('hidden');
    studyBotBtn.disabled = false;
    studyBotBtn.title = 'Create an AI study bot for this course';
  }
}
function filterMaterialsByPreferences(materials, preferences) {
  const filtered = {
    modules: materials.modules || [],
    files: materials.files || [],
    pages: materials.pages || [],
    assignments: materials.assignments || [],
    errors: materials.errors || []
  };

  console.log('Filtering materials:', {
    inputModules: materials.modules?.length || 0,
    inputFiles: materials.files?.length || 0,
    inputPages: materials.pages?.length || 0,
    inputAssignments: materials.assignments?.length || 0,
    outputModules: filtered.modules.length,
    outputFiles: filtered.files.length,
    outputPages: filtered.pages.length,
    outputAssignments: filtered.assignments.length
  });

  return filtered;
}

/**
 * Filter materials by selected files from detailed view
 */
function filterSelectedMaterials(materials, selectedFileIds) {
  const filtered = {
    modules: [],
    files: [],
    pages: [],
    assignments: [],
    errors: materials.errors || []
  };

  selectedFileIds.forEach(fileId => {
    const [category, indexStr] = fileId.split('-');
    const index = parseInt(indexStr);

    if (materials[category] && materials[category][index]) {
      if (!filtered[category]) {
        filtered[category] = [];
      }
      filtered[category].push(materials[category][index]);
    }
  });

  return filtered;
}

// ========== SETTINGS ==========


// ========== DETAILED FILE LIST VIEW ==========

let detailedViewVisible = false;
let selectedFiles = new Set(); // Track individually selected files

function toggleDetailedView() {
  const simpleView = document.getElementById('simple-view');
  const detailedView = document.getElementById('detailed-view');
  const toggleBtn = document.getElementById('toggle-detailed-view');

  detailedViewVisible = !detailedViewVisible;

  if (detailedViewVisible) {
    simpleView.classList.add('hidden');
    detailedView.classList.remove('hidden');
    toggleBtn.querySelector('span').textContent = 'Show Simple View';
    populateDetailedView();
  } else {
    simpleView.classList.remove('hidden');
    detailedView.classList.add('hidden');
    toggleBtn.querySelector('span').textContent = 'Show Detailed File List';
  }
}

function populateDetailedView() {
  const detailedView = document.getElementById('detailed-view');

  if (!scannedMaterials) {
    detailedView.innerHTML = '<p class="no-materials">No materials scanned yet.</p>';
    return;
  }

  let html = '<div class="file-list-header">';
  html += '<h3>All Course Files</h3>';
  html += '<div class="file-list-actions">';
  html += '<label class="select-all-label">';
  html += '<input type="checkbox" id="select-all-checkbox" class="select-all-checkbox">';
  html += '<span>Select All</span>';
  html += '</label>';
  html += '</div>';
  html += '</div>';

  const categoryLabels = {
    files: { name: 'Course Files' },
    pages: { name: 'Course Pages' },
    assignments: { name: 'Assignments' }
  };

  // Handle modules separately with nested structure
  if (scannedMaterials.modules && scannedMaterials.modules.length > 0) {
    html += `<div class="file-category-section" data-category="modules">`;
    html += `<div class="file-category-header">`;
    html += `<input type="checkbox" class="module-checkbox" id="module-modules" data-category="modules">`;
    html += `<span class="section-title">Course Modules</span>`;
    html += `<span class="section-count">${scannedMaterials.modules.length}</span>`;
    html += `</div>`;
    html += `<div class="file-modules-container">`;

    scannedMaterials.modules.forEach((module, moduleIdx) => {
      const moduleFiles = module.items ? module.items.filter(item => item.type === 'File' && item.url) : [];
      if (moduleFiles.length === 0) return; // Skip modules with no files

      html += `<div class="module-item" data-module-idx="${moduleIdx}">`;
      html += `<div class="module-header">`;
      html += `<input type="checkbox" class="module-file-checkbox" id="module-files-${moduleIdx}" data-module-idx="${moduleIdx}">`;
      html += `<svg class="module-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none">`;
      html += `<path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      html += `</svg>`;
      html += `<span class="module-name">${module.name || `Module ${moduleIdx + 1}`}</span>`;
      html += `<span class="module-count">${moduleFiles.length}</span>`;
      html += `</div>`;
      html += `<div class="module-files collapsed">`;

      moduleFiles.forEach((file, fileIdx) => {
        const fileId = `modules-${moduleIdx}-${fileIdx}`;
        const checked = selectedFiles.has(fileId) || selectedFiles.size === 0 ? 'checked' : '';
        const fileName = file.title || file.name || 'Unnamed File';
        const fileType = file['content-type'] || file.mimeType || 'unknown';

        html += `<div class="file-item ${file.status === 'download_failed' || file.status === 'processing_error' ? 'file-error' : ''}">`;
        html += `<input type="checkbox" id="file-${fileId}" ${checked} data-category="modules" data-module-idx="${moduleIdx}" data-index="${fileIdx}">`;
        html += `<label for="file-${fileId}">`;
        html += `<span class="file-name">${fileName}</span>`;
        if (fileType !== 'unknown') {
          html += `<span class="file-type">${getFileExtension(fileName) || fileType}</span>`;
        }
        if (file.status === 'download_failed' || file.status === 'processing_error') {
          html += `<span class="file-status-error">Error</span>`;
        }
        html += `</label>`;
        html += `</div>`;
      });

      html += `</div></div>`;
    });

    html += `</div></div>`;
  }

  // Build set of module file IDs to avoid duplication
  const moduleFileIds = new Set();
  if (scannedMaterials.modules) {
    scannedMaterials.modules.forEach(module => {
      if (module.items) {
        module.items.forEach(item => {
          if (item.type === 'File') {
            // Track by multiple IDs for robustness
            if (item.content_id) moduleFileIds.add(item.content_id);
            if (item.id) moduleFileIds.add(item.id);
            if (item.url) moduleFileIds.add(item.url);
          }
        });
      }
    });
  }

  // Handle other categories (files, pages, assignments)
  for (const [category, items] of Object.entries(scannedMaterials)) {
    if (category === 'errors' || category === 'modules' || !items || items.length === 0) continue;

    const label = categoryLabels[category] || { name: category };

    // For files category, filter out items that are already in modules
    let itemsToDisplay = items;
    if (category === 'files') {
      itemsToDisplay = items.filter(item => {
        const isInModule = moduleFileIds.has(item.content_id) ||
                          moduleFileIds.has(item.id) ||
                          moduleFileIds.has(item.url);
        return !isInModule; // Only include files NOT in modules
      });

      // Skip category if no standalone files remain
      if (itemsToDisplay.length === 0) continue;
    }

    html += `<div class="file-category-section" data-category="${category}">`;
    html += `<div class="file-category-header">`;
    html += `<input type="checkbox" class="module-checkbox" id="module-${category}" data-category="${category}">`;
    html += `<span class="section-title">${label.name}</span>`;
    html += `<span class="section-count">${itemsToDisplay.length}</span>`;
    html += `</div>`;
    html += `<div class="file-items">`;

    itemsToDisplay.forEach((item, index) => {
      const fileId = `${category}-${index}`;
      const checked = selectedFiles.has(fileId) || selectedFiles.size === 0 ? 'checked' : '';

      // Get the correct name property based on category
      let itemName = 'Unnamed';
      if (category === 'files') {
        itemName = item.display_name || item.filename || item.name || 'Unnamed File';
      } else if (category === 'pages') {
        itemName = item.title || item.name || 'Unnamed Page';
      } else if (category === 'assignments') {
        itemName = item.name || 'Unnamed Assignment';
      } else {
        itemName = item.name || item.title || item.display_name || 'Unnamed Item';
      }

      const fileType = item['content-type'] || item.mimeType || item.type || 'unknown';

      html += `<div class="file-item ${item.status === 'download_failed' || item.status === 'processing_error' ? 'file-error' : ''}">`;
      html += `<input type="checkbox" id="file-${fileId}" ${checked} data-category="${category}" data-index="${index}">`;
      html += `<label for="file-${fileId}">`;
      html += `<span class="file-name">${itemName}</span>`;
      if (fileType !== 'unknown') {
        html += `<span class="file-type">${getFileExtension(itemName) || fileType}</span>`;
      }
      if (item.status === 'download_failed' || item.status === 'processing_error') {
        html += `<span class="file-status-error">Error</span>`;
      }
      html += `</label>`;
      html += `</div>`;
    });

    html += `</div></div>`;
  }

  // Show errors if any
  if (scannedMaterials.errors && scannedMaterials.errors.length > 0) {
    html += `<div class="errors-section">`;
    html += `<h4>Resource Errors (${scannedMaterials.errors.length})</h4>`;
    scannedMaterials.errors.forEach(err => {
      html += `<div class="error-item">`;
      html += `<strong>${err.type}</strong>: ${err.error}`;
      html += `</div>`;
    });
    html += `</div>`;
  }

  detailedView.innerHTML = html;

  // Add event listeners
  const selectAllCheckbox = document.getElementById('select-all-checkbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      if (isChecked) {
        selectAllFiles();
      } else {
        deselectAllFiles();
      }
    });
  }

  // Add listeners to module-level checkboxes (detailed view)
  const moduleCheckboxes = detailedView.querySelectorAll('.module-checkbox');
  console.log('[DEBUG] Found module checkboxes in detailed view:', moduleCheckboxes.length);

  moduleCheckboxes.forEach((moduleCheckbox, index) => {
    console.log('[DEBUG] Adding listener to module checkbox', index, moduleCheckbox.id);
    moduleCheckbox.addEventListener('change', (e) => {
      const category = e.target.dataset.category;
      const isChecked = e.target.checked;
      console.log('[DEBUG] Module checkbox clicked:', category, 'checked:', isChecked);

      // Find all checkboxes in this category and toggle them
      const categorySection = e.target.closest('.file-category-section');

      // For modules category, also get module-file-checkbox and checkboxes inside module-files
      const fileCheckboxes = categorySection.querySelectorAll('.file-items input[type="checkbox"], .module-file-checkbox, .module-files input[type="checkbox"]');
      console.log('[DEBUG] Toggling', fileCheckboxes.length, 'checkboxes in category:', category);

      fileCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        checkbox.indeterminate = false;
        const fileId = checkbox.id.replace('file-', '');
        if (fileId) {
          if (isChecked) {
            selectedFiles.add(fileId);
          } else {
            selectedFiles.delete(fileId);
          }
        }
      });
      console.log('[DEBUG] Selected files after toggle:', selectedFiles.size);
    });
  });

  // Add listeners to module header clicks (expand/collapse)
  detailedView.querySelectorAll('.module-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on checkbox
      if (e.target.type === 'checkbox') return;

      const moduleItem = header.closest('.module-item');
      const moduleFiles = moduleItem.querySelector('.module-files');
      const chevron = header.querySelector('.module-chevron');

      moduleFiles.classList.toggle('collapsed');
      chevron.classList.toggle('rotated');
    });
  });

  // Add listeners to module file checkboxes (for individual modules)
  detailedView.querySelectorAll('.module-file-checkbox').forEach(moduleCheckbox => {
    moduleCheckbox.addEventListener('change', (e) => {
      e.stopPropagation(); // Prevent triggering header click
      const moduleIdx = e.target.dataset.moduleIdx;
      const isChecked = e.target.checked;
      const moduleItem = e.target.closest('.module-item');
      const fileCheckboxes = moduleItem.querySelectorAll('.module-files input[type="checkbox"]');

      fileCheckboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        const fileId = checkbox.id.replace('file-', '');
        if (isChecked) {
          selectedFiles.add(fileId);
        } else {
          selectedFiles.delete(fileId);
        }
      });
    });
  });

  // Add listeners to individual file checkboxes
  detailedView.querySelectorAll('.file-items input[type="checkbox"], .module-files input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const fileId = e.target.id.replace('file-', '');
      if (e.target.checked) {
        selectedFiles.add(fileId);
      } else {
        selectedFiles.delete(fileId);
      }

      // Update the category-level checkbox state based on its children
      const categorySection = e.target.closest('.file-category-section');
      if (categorySection) {
        const moduleCheckbox = categorySection.querySelector('.module-checkbox');
        const fileCheckboxes = categorySection.querySelectorAll('.file-items input[type="checkbox"], .module-file-checkbox, .module-files input[type="checkbox"]');
        const allChecked = Array.from(fileCheckboxes).every(cb => cb.checked);
        const someChecked = Array.from(fileCheckboxes).some(cb => cb.checked);

        if (moduleCheckbox) {
          if (allChecked && fileCheckboxes.length > 0) {
            moduleCheckbox.checked = true;
            moduleCheckbox.indeterminate = false;
          } else if (someChecked) {
            moduleCheckbox.checked = false;
            moduleCheckbox.indeterminate = true;
          } else {
            moduleCheckbox.checked = false;
            moduleCheckbox.indeterminate = false;
          }
        }
      }

      // Update individual module checkbox state if inside a module
      const moduleItem = e.target.closest('.module-item');
      if (moduleItem) {
        const moduleFileCheckbox = moduleItem.querySelector('.module-file-checkbox');
        const moduleFileCheckboxes = moduleItem.querySelectorAll('.module-files input[type="checkbox"]');
        const allChecked = Array.from(moduleFileCheckboxes).every(cb => cb.checked);
        const someChecked = Array.from(moduleFileCheckboxes).some(cb => cb.checked);

        if (moduleFileCheckbox) {
          if (allChecked) {
            moduleFileCheckbox.checked = true;
            moduleFileCheckbox.indeterminate = false;
          } else if (someChecked) {
            moduleFileCheckbox.checked = false;
            moduleFileCheckbox.indeterminate = true;
          } else {
            moduleFileCheckbox.checked = false;
            moduleFileCheckbox.indeterminate = false;
          }
        }
      }
    });
  });

  // Initialize module checkbox states
  detailedView.querySelectorAll('.module-checkbox').forEach(moduleCheckbox => {
    const categorySection = moduleCheckbox.closest('.file-category-section');
    const fileCheckboxes = categorySection.querySelectorAll('.file-items input[type="checkbox"], .module-file-checkbox, .module-files input[type="checkbox"]');
    const allChecked = Array.from(fileCheckboxes).every(cb => cb.checked);
    const someChecked = Array.from(fileCheckboxes).some(cb => cb.checked);

    if (allChecked && fileCheckboxes.length > 0) {
      moduleCheckbox.checked = true;
      moduleCheckbox.indeterminate = false;
    } else if (someChecked) {
      moduleCheckbox.checked = false;
      moduleCheckbox.indeterminate = true;
    } else {
      moduleCheckbox.checked = false;
      moduleCheckbox.indeterminate = false;
    }
  });
}

function getFileIcon(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return '📄';

  const mime = mimeType.toLowerCase();
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📘';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return '📊';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('video')) return '🎥';
  if (mime.includes('audio')) return '🎵';
  if (mime.includes('text')) return '📄';
  if (mime === 'assignment') return '✏️';
  if (mime === 'page') return '📝';
  return '📄';
}

function getFileExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const ext = filename.split('.').pop().toLowerCase();
  if (ext && ext.length <= 4 && ext !== filename.toLowerCase()) return `.${ext}`;
  return '';
}

function selectAllFiles() {
  const checkboxes = document.querySelectorAll('#detailed-view input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = true;
    cb.indeterminate = false;
    const fileId = cb.id.replace('file-', '');
    if (fileId) {
      selectedFiles.add(fileId);
    }
  });

  // Also check all category checkboxes in simple view
  const categoryCheckboxes = document.querySelectorAll('.category-checkbox');
  categoryCheckboxes.forEach(cb => {
    cb.checked = true;
  });

  // Update module checkbox states based on their children
  const moduleFileCheckboxes = document.querySelectorAll('.module-file-checkbox');
  moduleFileCheckboxes.forEach(moduleCheckbox => {
    const moduleIdx = moduleCheckbox.dataset.moduleIdx;
    const fileCheckboxes = document.querySelectorAll(
      `.file-item input[data-module-idx="${moduleIdx}"]`
    );

    if (fileCheckboxes.length > 0) {
      const allChecked = Array.from(fileCheckboxes).every(cb => cb.checked);
      const anyChecked = Array.from(fileCheckboxes).some(cb => cb.checked);

      moduleCheckbox.checked = allChecked;
      moduleCheckbox.indeterminate = !allChecked && anyChecked;
    }
  });

  // Update category-level module checkboxes
  const categoryModuleCheckboxes = document.querySelectorAll('.module-checkbox');
  categoryModuleCheckboxes.forEach(cb => {
    cb.checked = true;
    cb.indeterminate = false;
  });
}

function deselectAllFiles() {
  const checkboxes = document.querySelectorAll('#detailed-view input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
  selectedFiles.clear();

  // Also uncheck all category checkboxes in simple view
  const categoryCheckboxes = document.querySelectorAll('.category-checkbox');
  categoryCheckboxes.forEach(cb => {
    cb.checked = false;
  });

  // Also uncheck all module-level checkboxes in detailed view
  const moduleCheckboxes = document.querySelectorAll('.module-checkbox, .module-file-checkbox');
  moduleCheckboxes.forEach(cb => {
    cb.checked = false;
    cb.indeterminate = false;
  });
}

// Theme Management - removed (now handled at top of file with system preference detection)
