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

// Global variables
let canvasAPI = null;
let fileProcessor = null;
let currentCourse = null;
let scannedMaterials = null;
let currentAuthMethod = null;

// Screen management
const screens = {
  sessionSetup: document.getElementById('session-setup-screen'),
  main: document.getElementById('main-screen')
};

// Initialize theme based on system preference or user override
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme) {
    // User has set a preference, use it
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    // No user preference, use system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Listen for system theme changes (only if user hasn't set a manual preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  const savedTheme = localStorage.getItem('theme');
  if (!savedTheme) {
    // Only update if user hasn't manually set a preference
    const theme = e.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }
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
      localStorage.setItem('theme', 'light');
      updateThemeButtons();
    });
  }

  if (darkThemeBtn) {
    darkThemeBtn.addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      updateThemeButtons();
    });
  }

  function updateThemeButtons() {
    const savedTheme = localStorage.getItem('theme');
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
  }

  // No checkboxes needed anymore - materials are always included

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

    const url = await StorageManager.getCanvasUrl();
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
        console.log('📚 [Recent Courses] courseId:', courseId, 'courseName type:', typeof materialsData.courseName, 'value:', materialsData.courseName);

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

  const summary = fileProcessor.getSummary();
  const totalSize = fileProcessor.getTotalSize();

  document.getElementById('total-count').textContent = summary.total;
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

async function downloadMaterials() {
  try {
    document.getElementById('download-btn').disabled = true;
    document.getElementById('download-progress').classList.remove('hidden');

    const zipBlob = await fileProcessor.downloadAllAsZip(
      canvasAPI,
      currentCourse.name,
      (status, progress) => {
        document.getElementById('progress-text').textContent = status;
        document.getElementById('progress-fill').style.width = progress + '%';
      }
    );

    const url = URL.createObjectURL(zipBlob);
    const filename = `${fileProcessor.sanitizeFilename(currentCourse.name)}_materials.zip`;

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, (downloadId) => {
      console.log('Download started:', downloadId);
      URL.revokeObjectURL(url);

      setTimeout(() => {
        document.getElementById('download-progress').classList.add('hidden');
        document.getElementById('download-btn').disabled = false;
        document.getElementById('progress-fill').style.width = '0%';
      }, 2000);
    });
  } catch (error) {
    console.error('Error downloading materials:', error);
    showError(document.getElementById('material-error'), 'Failed to download: ' + error.message);
    document.getElementById('download-progress').classList.add('hidden');
    document.getElementById('download-btn').disabled = false;
  }
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
      console.log('📭 No cached materials found');
      return null;
    }

    // Check if cache is fresh (< 24 hours old)
    const cacheAge = Date.now() - cached.lastUpdated;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (cacheAge > maxAge) {
      console.log(`🕐 Cached materials too old (${Math.floor(cacheAge / (60 * 60 * 1000))} hours), will refresh`);
      return null;
    }

    console.log(`✅ Found fresh cached materials (${Math.floor(cacheAge / (60 * 1000))} minutes old)`);
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
      if (item.url && item.blob) {
        blobMap.set(item.url, {
          blob: item.blob,
          stored_name: item.stored_name
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

  console.log(`🔗 Built blob map with ${blobMap.size} cached blobs`);

  // Attach cached blobs to scanned materials
  const attachBlobs = (items) => {
    if (!Array.isArray(items)) return;

    items.forEach(item => {
      if (item.url && blobMap.has(item.url)) {
        const cached = blobMap.get(item.url);
        item.blob = cached.blob;
        item.stored_name = cached.stored_name;
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
        downloadedFiles.push({ blob, name: fileName });
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

    // Attach blobs to materials
    const blobMap = new Map();
    downloadedFiles.forEach(df => {
      blobMap.set(df.name, df.blob);
      const nameWithoutExt = df.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
      blobMap.set(nameWithoutExt, df.blob);
    });

    // Attach to all items
    for (const items of Object.values(materialsToProcess)) {
      if (!Array.isArray(items)) continue;
      items.forEach((item) => {
        let itemName = item.display_name || item.filename || item.name || item.title;
        if (itemName && blobMap.has(itemName)) {
          item.blob = blobMap.get(itemName);
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
      materialsToProcess = mergeCachedBlobs(materialsToProcess, cachedMaterials);
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
    const filesToUploadToBackend = []; // Pages/assignments converted to text blobs

    // Helper function to collect file info
    const processItem = (item) => {
      const itemName = item.stored_name || item.display_name || item.filename || item.name || item.title;

      if (!itemName) return;

      if (!item.url) {
        console.warn(`⚠️ Skipping "${itemName}" - no download URL from Canvas`);
        skippedFiles.push(itemName);
        return;
      }

      filesToProcess.push({
        name: itemName,
        url: item.url
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
    if (materialsToProcess.assignments && Array.isArray(materialsToProcess.assignments)) {
      console.log(`📋 Processing ${materialsToProcess.assignments.length} assignment descriptions for backend upload`);

      materialsToProcess.assignments.forEach((assignment) => {
        // Only process assignments with descriptions
        if (!assignment.description || assignment.description.trim() === '') {
          console.log(`⏭️ Skipping assignment "${assignment.name}" - no description`);
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

        // Add blob to assignment object so it can be opened locally
        assignment.blob = textBlob;

        // Create filename: prefix with [Assignment] for clarity
        const safeName = assignment.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
        const filename = `[Assignment] ${safeName}.txt`;

        // Check if already uploaded
        const fileId = `${currentCourse.id}_[Assignment] ${safeName}`;

        if (!uploadedFileIds.has(fileId)) {
          // Add to backend upload queue
          filesToUploadToBackend.push({
            blob: textBlob,
            name: filename,
            type: 'txt'
          });

          console.log(`✅ Queued assignment "${assignment.name}" for backend upload as ${filename}`);
        } else {
          console.log(`⏭️ Assignment "${assignment.name}" already uploaded to backend`);
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
    console.log(`📊 Files to process: ${filesToProcess.length}`);
    if (skippedFiles.length > 0) {
      console.warn(`⚠️ ${skippedFiles.length} files skipped (no Canvas download URL):`, skippedFiles);
    }

    // Upload pages/assignments text blobs that were created above
    if (filesToUploadToBackend.length > 0) {
      updateProgress(`Uploading ${filesToUploadToBackend.length} pages/assignments as text...`, PROGRESS_PERCENT.UPLOADING - 5);

      try {
        const backendClient = new BackendClient('https://web-production-9aaba7.up.railway.app');
        const uploadResult = await backendClient.uploadPDFs(currentCourse.id, filesToUploadToBackend);
        console.log(`✅ Uploaded ${filesToUploadToBackend.length} pages/assignments as text files`);

        if (uploadResult.failed_count > 0) {
          console.warn(`⚠️ ${uploadResult.failed_count} text files failed to upload`);
        }
      } catch (error) {
        console.error('❌ Failed to upload pages/assignments:', error);
        // Don't throw - continue with file processing
      }
    }

    // NEW APPROACH: Send Canvas URLs to backend, it will download and process
    if (filesToProcess.length > 0) {
      updateProgress(`Processing ${filesToProcess.length} files on backend...`, PROGRESS_PERCENT.UPLOADING);

      try {
        const response = await fetch(`https://web-production-9aaba7.up.railway.app/process_canvas_files`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            course_id: currentCourse.id,
            files: filesToProcess
          })
        });

        const result = await response.json();
        console.log(`✅ Backend Upload Summary:`);
        console.log(`   - Total files sent: ${filesToProcess.length}`);
        console.log(`   - Successfully processed: ${result.processed}`);
        console.log(`   - Skipped (already in GCS): ${result.skipped}`);
        console.log(`   - Failed to process: ${result.failed}`);

        if (result.failed > 0) {
          console.error(`❌ ${result.failed} files failed to upload - check Railway backend logs for details`);
        }

        // Show summary to user
        if (result.processed > 0 || result.skipped > 0) {
          console.log(`✅ ${result.processed + result.skipped} files are now in GCS and ready for AI`);
        }
      } catch (error) {
        console.error('❌ Failed to process files on backend:', error);
        throw new Error(`Backend processing failed: ${error.message}`);
      }
    } else {
      console.log('⚡ No files to process');
    }

    // Open chat interface immediately - no downloads needed!
    updateProgress('Opening chat...', PROGRESS_PERCENT.COMPLETE);

    // Save materials metadata to IndexedDB (no blobs needed - files are in GCS)
    const materialsDB = new MaterialsDB();
    await materialsDB.saveMaterials(currentCourse.id, currentCourse.name, materialsToProcess);
    await materialsDB.close();

    // Open chat
    const chatUrl = chrome.runtime.getURL(`chat/chat.html?courseId=${currentCourse.id}`);
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
    toggleBtn.textContent = '📊 Show Simple View';
    populateDetailedView();
  } else {
    simpleView.classList.remove('hidden');
    detailedView.classList.add('hidden');
    toggleBtn.textContent = '📋 Show Detailed File List';
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
  html += '<button id="select-all-files" class="btn btn-secondary btn-small">Select All</button>';
  html += '<button id="deselect-all-files" class="btn btn-secondary btn-small">Deselect All</button>';
  html += '</div>';
  html += '</div>';

  const categoryLabels = {
    modules: { name: 'Modules', icon: '📚' },
    files: { name: 'Files', icon: '📄' },
    pages: { name: 'Pages', icon: '📝' },
    assignments: { name: 'Assignments', icon: '✏️' }
  };

  for (const [category, items] of Object.entries(scannedMaterials)) {
    if (category === 'errors' || !items || items.length === 0) continue;

    const label = categoryLabels[category] || { name: category, icon: '📦' };

    html += `<div class="file-category-section">`;
    html += `<div class="file-category-header">`;
    html += `<span class="category-icon">${label.icon}</span>`;
    html += `<h4>${label.name} (${items.length})</h4>`;
    html += `</div>`;
    html += `<div class="file-items">`;

    items.forEach((item, index) => {
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
      } else if (category === 'modules') {
        // Modules contain items, extract from module structure
        itemName = item.title || item.name || 'Unnamed Module Item';
      } else {
        itemName = item.name || item.title || item.display_name || 'Unnamed Item';
      }

      const fileType = item['content-type'] || item.mimeType || item.type || 'unknown';
      const fileIcon = getFileIcon(fileType);

      html += `<div class="file-item ${item.status === 'download_failed' || item.status === 'processing_error' ? 'file-error' : ''}">`;
      html += `<input type="checkbox" id="file-${fileId}" ${checked} data-category="${category}" data-index="${index}">`;
      html += `<label for="file-${fileId}">`;
      html += `<span class="file-icon">${fileIcon}</span>`;
      html += `<span class="file-name">${itemName}</span>`;
      if (fileType !== 'unknown') {
        html += `<span class="file-type">${getFileExtension(itemName) || fileType}</span>`;
      }
      if (item.status === 'download_failed' || item.status === 'processing_error') {
        html += `<span class="file-status-error">⚠️ Error</span>`;
      }
      html += `</label>`;
      html += `</div>`;
    });

    html += `</div></div>`;
  }

  // Show errors if any
  if (scannedMaterials.errors && scannedMaterials.errors.length > 0) {
    html += `<div class="errors-section">`;
    html += `<h4>⚠️ Resource Errors (${scannedMaterials.errors.length})</h4>`;
    scannedMaterials.errors.forEach(err => {
      html += `<div class="error-item">`;
      html += `<strong>${err.type}</strong>: ${err.error}`;
      html += `</div>`;
    });
    html += `</div>`;
  }

  detailedView.innerHTML = html;

  // Add event listeners
  document.getElementById('select-all-files')?.addEventListener('click', selectAllFiles);
  document.getElementById('deselect-all-files')?.addEventListener('click', deselectAllFiles);

  // Add listeners to all checkboxes
  detailedView.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const fileId = e.target.id.replace('file-', '');
      if (e.target.checked) {
        selectedFiles.add(fileId);
      } else {
        selectedFiles.delete(fileId);
      }
    });
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
    const fileId = cb.id.replace('file-', '');
    selectedFiles.add(fileId);
  });
}

function deselectAllFiles() {
  const checkboxes = document.querySelectorAll('#detailed-view input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = false;
  });
  selectedFiles.clear();
}

// Theme Management - removed (now handled at top of file with system preference detection)
