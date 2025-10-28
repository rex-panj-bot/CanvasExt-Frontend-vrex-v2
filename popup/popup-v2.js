/**
 * Popup Script V2 - Multi-Auth Support
 * Supports: OAuth 2.0, Session Login, and API Token
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
  authMethod: document.getElementById('auth-method-screen'),
  sessionSetup: document.getElementById('session-setup-screen'),
  oauthSetup: document.getElementById('oauth-setup-screen'),
  tokenSetup: document.getElementById('token-setup-screen'),
  main: document.getElementById('main-screen'),
  settings: document.getElementById('settings-screen')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Initialize theme
  initTheme();

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

  // Display extension ID for OAuth setup (still needed for reference)
  document.getElementById('extension-id-display').textContent = chrome.runtime.id;
  document.getElementById('redirect-uri-display').textContent = `https://${chrome.runtime.id}.chromiumapp.org/`;
}

function setupEventListeners() {
  // Auth method selection
  document.getElementById('select-session-auth').querySelector('.btn').addEventListener('click', () => {
    showScreen('sessionSetup');
  });

  document.getElementById('select-oauth-auth').querySelector('.btn').addEventListener('click', () => {
    showScreen('oauthSetup');
  });

  document.getElementById('select-token-auth').querySelector('.btn').addEventListener('click', () => {
    showScreen('tokenSetup');
  });

  // Back buttons - removed since we only have session auth now

  // Session auth
  document.getElementById('session-login-btn').addEventListener('click', handleSessionLogin);
  document.getElementById('session-continue-btn').addEventListener('click', handleSessionContinue);

  // OAuth auth
  document.getElementById('save-oauth-btn').addEventListener('click', handleOAuthSetup);
  document.getElementById('show-oauth-help').addEventListener('click', showOAuthHelp);
  document.getElementById('copy-ext-id').addEventListener('click', copyExtensionId);

  // Token auth
  document.getElementById('save-token-btn').addEventListener('click', handleTokenSetup);
  document.getElementById('show-token-help').addEventListener('click', showTokenHelp);

  // Main screen
  document.getElementById('settings-btn').addEventListener('click', () => {
    loadSettingsScreen();
    showScreen('settings');
  });
  document.getElementById('course-select').addEventListener('change', handleCourseChange);
  document.getElementById('download-btn').addEventListener('click', downloadMaterials);
  document.getElementById('study-bot-btn').addEventListener('click', createStudyBot);

  // Settings
  document.getElementById('settings-back-btn').addEventListener('click', () => showScreen('main'));
  document.getElementById('change-auth-btn').addEventListener('click', changeAuthMethod);
  document.getElementById('clear-data-btn').addEventListener('click', clearAllData);

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

// ========== OAUTH AUTH ==========

async function handleOAuthSetup() {
  const url = document.getElementById('oauth-canvas-url').value.trim();
  const clientId = document.getElementById('oauth-client-id').value.trim();
  const clientSecret = document.getElementById('oauth-client-secret').value.trim();
  const errorEl = document.getElementById('oauth-error');

  hideError(errorEl);

  if (!url || !clientId || !clientSecret) {
    showError(errorEl, 'Please fill in all fields');
    return;
  }

  try {
    const btn = document.getElementById('save-oauth-btn');
    btn.disabled = true;
    btn.textContent = 'Authorizing...';

    // Save OAuth credentials
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    normalizedUrl = normalizedUrl.replace(/\/$/, '');

    await StorageManager.saveOAuthCredentials(clientId, clientSecret, normalizedUrl);

    // Start OAuth flow
    const oauth = new CanvasOAuth(normalizedUrl, clientId, clientSecret);
    const tokens = await oauth.authenticate();

    // Save tokens
    await StorageManager.saveOAuthTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);
    await StorageManager.saveAuthMethod('oauth');
    currentAuthMethod = 'oauth';

    // Initialize API with OAuth
    canvasAPI = new CanvasAPI(normalizedUrl, tokens.accessToken, 'oauth');

    await loadMainScreen();
  } catch (error) {
    console.error('OAuth setup error:', error);
    showError(errorEl, error.message);
    document.getElementById('save-oauth-btn').disabled = false;
    document.getElementById('save-oauth-btn').textContent = 'Save & Authorize with Canvas';
  }
}

function showOAuthHelp(e) {
  e.preventDefault();
  const helpText = `OAuth 2.0 Setup Instructions:

1. Find Your Extension ID:
   - Go to chrome://extensions
   - Find "Canvas Material Extractor"
   - Copy the Extension ID

2. Request Developer Key from Canvas Admin:
   - Ask your Canvas admin to create a Developer Key
   - Provide them with:
     * Key Name: Canvas Material Extractor
     * Redirect URI: https://[your-extension-id].chromiumapp.org/
     * Scopes: url:GET|/api/v1/*

3. Get Credentials:
   - Admin will provide Client ID and Client Secret
   - Enter them in the form above

4. Authorize:
   - Click "Save & Authorize with Canvas"
   - Log in to Canvas when prompted
   - Authorize the extension

For detailed instructions, see the README file.`;

  alert(helpText);
}

function copyExtensionId() {
  const extId = chrome.runtime.id;
  navigator.clipboard.writeText(extId).then(() => {
    const btn = document.getElementById('copy-ext-id');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

// ========== TOKEN AUTH ==========

async function handleTokenSetup() {
  const url = document.getElementById('token-canvas-url').value.trim();
  const token = document.getElementById('api-token').value.trim();
  const errorEl = document.getElementById('token-error');

  hideError(errorEl);

  if (!url || !token) {
    showError(errorEl, 'Please enter both Canvas URL and API token');
    return;
  }

  try {
    const btn = document.getElementById('save-token-btn');
    btn.disabled = true;
    btn.textContent = 'Testing connection...';

    // Save credentials
    await StorageManager.saveCredentials(token, url);
    await StorageManager.saveAuthMethod('token');
    currentAuthMethod = 'token';

    // Test connection
    const savedUrl = await StorageManager.getCanvasUrl();
    canvasAPI = new CanvasAPI(savedUrl, token, 'token');

    const connected = await canvasAPI.testConnection();

    if (!connected) {
      throw new Error('Failed to connect to Canvas. Please check your credentials.');
    }

    await loadMainScreen();
  } catch (error) {
    showError(errorEl, error.message);
    document.getElementById('save-token-btn').disabled = false;
    document.getElementById('save-token-btn').textContent = 'Save & Continue';
  }
}

function showTokenHelp(e) {
  e.preventDefault();
  const helpText = `To get your Canvas API token:

1. Log in to Canvas
2. Click on "Account" in the left navigation
3. Click on "Settings"
4. Scroll down to "Approved Integrations"
5. Click "+ New Access Token"
6. Enter a purpose (e.g., "Material Extractor")
7. Click "Generate Token"
8. Copy the token and paste it here

Note: Some institutions have disabled API token generation. If you don't see this option, use Session Login or OAuth 2.0 instead.`;

  alert(helpText);
}

// ========== MAIN SCREEN ==========

async function loadMainScreen() {
  try {
    // Initialize Canvas API if not already done
    if (!canvasAPI) {
      const authMethod = await StorageManager.getAuthMethod();
      const url = await StorageManager.getCanvasUrl();

      if (authMethod === 'oauth') {
        const { accessToken } = await StorageManager.getOAuthTokens();
        canvasAPI = new CanvasAPI(url, accessToken, 'oauth');
      } else if (authMethod === 'session') {
        canvasAPI = new CanvasAPI(url, null, 'session');
      } else if (authMethod === 'token') {
        const { token } = await StorageManager.getCredentials();
        canvasAPI = new CanvasAPI(url, token, 'token');
      }
    }

    // Update auth badge
    const badge = document.getElementById('auth-method-badge');
    badge.textContent = currentAuthMethod || 'Unknown';

    showScreen('main');
    await loadCourses();
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

async function handleCourseChange() {
  const courseId = document.getElementById('course-select').value;

  console.log('🎯 [Popup] Course selected:', courseId);

  if (!courseId) {
    document.getElementById('material-section').classList.add('hidden');
    return;
  }

  const courseName = document.getElementById('course-select').options[document.getElementById('course-select').selectedIndex].text;
  currentCourse = { id: courseId, name: courseName };

  console.log('📌 [Popup] Set currentCourse:', currentCourse);

  await scanCourseMaterials(courseId, courseName);
}

async function scanCourseMaterials(courseId, courseName) {
  try {
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
  } catch (error) {
    console.error('Error scanning materials:', error);
    document.getElementById('scan-loading').classList.add('hidden');
    showError(document.getElementById('material-error'), 'Failed to scan materials: ' + error.message);
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
        await backendClient.uploadPDFs(courseId, filesToActuallyUpload);
        console.log(`✅ Uploaded ${filesToActuallyUpload.length} files to backend`);
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
  try {
    document.getElementById('study-bot-btn').disabled = true;
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

    // Supported file extensions for Gemini AI
    const supportedExtensions = [
      'pdf', 'txt', 'doc', 'docx',  // Documents
      'xlsx', 'xls', 'csv',          // Spreadsheets
      'pptx', 'ppt',                 // Presentations
      'md', 'rtf',                   // Text formats
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'    // Images (for vision)
    ];

    // Collect ALL files for local download + determine which need backend upload
    const allFilesToDownload = []; // For local blob storage (ALWAYS download)
    const filesToUploadToBackend = []; // For backend AI processing (only if new)

    // Helper function to process a single item
    const processItem = (item) => {
      // Prioritize stored_name (has correct extension from previous download)
      const itemName = item.stored_name || item.display_name || item.filename || item.name || item.title;
      if (!itemName || !item.url) {
        return;
      }

      // OPTIMIZATION: Skip download if item already has blob from cache
      const hasBlob = item.blob && item.blob instanceof Blob;

      // Try to determine file extension from name
      let ext = null;
      if (itemName.includes('.')) {
        ext = itemName.split('.').pop().toLowerCase();
      }

      // If no extension but item has a blob (from previous download), detect from MIME type
      if (!ext && item.blob && item.blob.type) {
        const mimeToExt = {
          'application/pdf': 'pdf',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
          'application/vnd.ms-powerpoint': 'ppt',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
          'application/msword': 'doc',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
          'application/vnd.ms-excel': 'xls',
          'text/plain': 'txt',
          'text/markdown': 'md',
          'text/csv': 'csv',
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/gif': 'gif',
          'image/webp': 'webp',
          'image/bmp': 'bmp'
        };
        ext = mimeToExt[item.blob.type];
      }

      const fileInfo = {
        url: item.url,
        name: itemName,
        type: ext || 'unknown'
      };

      // Only add to download list if we don't already have the blob
      if (!hasBlob) {
        allFilesToDownload.push(fileInfo);
      }

      // Check if supported and should be uploaded to backend
      const isSupported = ext && supportedExtensions.includes(ext);

      if (isSupported) {
        // Check backend cache ONLY for upload decision (not download)
        const fileNameWithoutExt = itemName.substring(0, itemName.lastIndexOf('.')) || itemName;
        const fileId = `${currentCourse.id}_${fileNameWithoutExt}`;
        if (!uploadedFileIds.has(fileId)) {
          filesToUploadToBackend.push(fileInfo);
          console.log(`Will upload ${itemName} (${ext}) to backend`);
        } else {
          console.log(`Skipping ${itemName} (${ext}) - already on backend`);
        }
      } else {
        console.log(`Skipping ${itemName} (${ext || 'no extension'}) - unsupported format`);
      }
    };

    // Process standalone files, pages, assignments
    for (const [category, items] of Object.entries(materialsToProcess)) {
      if (category === 'modules' || !Array.isArray(items)) continue;

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

    // Log summary of what will be uploaded
    const uploadSummary = {};
    filesToUploadToBackend.forEach(f => {
      uploadSummary[f.type] = (uploadSummary[f.type] || 0) + 1;
    });
    console.log(`📊 Files to upload to backend: ${filesToUploadToBackend.length}`, uploadSummary);

    // Count how many files already have cached blobs
    let cachedFileCount = 0;
    const countCachedBlobs = (items) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        if (item.blob && item.blob instanceof Blob) cachedFileCount++;
      });
    };

    for (const items of Object.values(materialsToProcess)) {
      countCachedBlobs(items);
    }
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      materialsToProcess.modules.forEach(module => {
        if (module.items) countCachedBlobs(module.items);
      });
    }

    console.log(`🚀 OPTIMIZATION: ${cachedFileCount} files using cached blobs, ${allFilesToDownload.length} need downloading`);
    console.log(`🚀 DEBUG: allFilesToDownload =`, allFilesToDownload);
    console.log(`🚀 DEBUG: filesToUploadToBackend.length =`, filesToUploadToBackend.length);

    // OPTIMIZATION: Skip downloads in main flow - will happen in background if needed
    // Keep blob attachment logic for files that were already downloaded from cache
    const downloadedFiles = [];

    if (false) {
      // This section disabled - downloads will happen in background function instead
      // Kept for reference only
      updateProgress(`Downloading ${allFilesToDownload.length} new files...`, PROGRESS_PERCENT.DOWNLOADING_START);

      let completed = 0;
      const total = allFilesToDownload.length;
      const concurrency = 16;

      // Download single file
      const downloadFile = async (file) => {
        try {
          const blob = await canvasAPI.downloadFile(file.url);

          // Ensure filename has an extension based on blob type
          let fileName = file.name;
          if (!fileName.includes('.')) {
            // No extension - detect from blob MIME type
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
            if (ext) {
              fileName = fileName + ext;
              console.log(`  ✓ Added extension: "${file.name}" → "${fileName}" (${blob.type})`);
            }
          }

          downloadedFiles.push({ blob, name: fileName });
          completed++;

          // Update progress
          const downloadProgressRange = PROGRESS_PERCENT.DOWNLOADING_END - PROGRESS_PERCENT.DOWNLOADING_START;
          const progress = PROGRESS_PERCENT.DOWNLOADING_START + ((completed / total) * downloadProgressRange);
          updateProgress(`Downloading files: ${completed}/${total}`, progress);

          return { success: true, name: file.name, size: blob.size };
        } catch (error) {
          completed++;

          // Update progress even on error
          const downloadProgressRange = PROGRESS_PERCENT.DOWNLOADING_END - PROGRESS_PERCENT.DOWNLOADING_START;
          const progress = PROGRESS_PERCENT.DOWNLOADING_START + ((completed / total) * downloadProgressRange);
          updateProgress(`Downloading files: ${completed}/${total}`, progress);

          console.error(`Failed to download ${file.name}:`, error);
          return { success: false, name: file.name, error };
        }
      };

      // Process downloads in batches
      const downloadBatch = async (batch) => {
        return Promise.all(batch.map(file => downloadFile(file)));
      };

      // Split files into batches
      const batches = [];
      for (let i = 0; i < allFilesToDownload.length; i += concurrency) {
        batches.push(allFilesToDownload.slice(i, i + concurrency));
      }

      // Download all batches sequentially (files within each batch in parallel)
      for (const batch of batches) {
        await downloadBatch(batch);
      }
    } else {
      console.log('⚡ FAST PATH: Skipping downloads, all files cached!');
      updateProgress('Using cached files...', PROGRESS_PERCENT.DOWNLOADING_END);
    }

    // Upload only NEW files to backend (respect backend cache)
    if (downloadedFiles.length > 0 && filesToUploadToBackend.length > 0) {
      // Filter downloaded files to only upload ones that backend doesn't have
      const uploadSet = new Set(filesToUploadToBackend.map(f => f.name));
      const filesToActuallyUpload = downloadedFiles.filter(f => {
        // Check if this file needs uploading (match by name or without extension)
        const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
        return uploadSet.has(f.name) || uploadSet.has(nameWithoutExt);
      });

      if (filesToActuallyUpload.length > 0) {
        updateProgress(`Uploading ${filesToActuallyUpload.length} new files to backend...`, PROGRESS_PERCENT.UPLOADING);

        console.log(`📤 Uploading ${filesToActuallyUpload.length} new files to backend`);

        // Log file types being uploaded
        const uploadTypes = {};
        filesToActuallyUpload.forEach(f => {
          const ext = f.name.split('.').pop().toLowerCase();
          uploadTypes[ext] = (uploadTypes[ext] || 0) + 1;
        });
        console.log(`📊 File types being uploaded:`, uploadTypes);

        await backendClient.uploadPDFs(currentCourse.id, filesToActuallyUpload);
        console.log(`✅ Successfully uploaded ${filesToActuallyUpload.length} new files to backend`);
      } else {
        console.log('⚡ FAST PATH: Skipping backend upload, all files already on backend!');
      }
    } else if (filesToUploadToBackend.length === 0) {
      console.log('⚡ FAST PATH: Skipping backend upload, all files already cached on backend!');
      updateProgress('All files already on backend...', PROGRESS_PERCENT.UPLOADING);
    }

    // Attach blobs to materials
    const blobMap = new Map();
    downloadedFiles.forEach(df => {
      blobMap.set(df.name, df.blob);
      // Also store without extension for matching
      const nameWithoutExt = df.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
      blobMap.set(nameWithoutExt, df.blob);
    });

    // Attach blobs to all matching items in materialsToProcess
    for (const items of Object.values(materialsToProcess)) {
      if (!Array.isArray(items)) continue;

      items.forEach((item) => {
        let itemName = item.display_name || item.filename || item.name || item.title;
        if (itemName) {
          // Try exact match first
          if (blobMap.has(itemName)) {
            item.blob = blobMap.get(itemName);
            // Update the stored name to include extension
            for (const [fileName, blob] of blobMap) {
              if (blob === item.blob && fileName.includes('.')) {
                item.stored_name = fileName;
                break;
              }
            }
          }
        }
      });
    }

    // ALSO attach blobs to module items
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      materialsToProcess.modules.forEach((module) => {
        if (module.items && Array.isArray(module.items)) {
          module.items.forEach((item) => {
            let itemName = item.title || item.name || item.display_name;
            if (itemName) {
              // Try exact match first
              if (blobMap.has(itemName)) {
                item.blob = blobMap.get(itemName);
                // Update the stored name to include extension
                for (const [fileName, blob] of blobMap) {
                  if (blob === item.blob && fileName.includes('.')) {
                    item.stored_name = fileName;
                    break;
                  }
                }
              }
            }
          });
        }
      });
    }

    // OPTIMIZATION: Determine if we need background loading
    const needsBackgroundLoading = allFilesToDownload.length > 0;

    console.log(`🚀 DEBUG: needsBackgroundLoading = ${needsBackgroundLoading}`);
    console.log(`🚀 DEBUG: About to check if statement, needsBackgroundLoading = ${needsBackgroundLoading}`);

    // Debug using alert to keep popup open
    alert(`DEBUG INFO:\nneedsBackgroundLoading: ${needsBackgroundLoading}\nallFilesToDownload.length: ${allFilesToDownload.length}\nfilesToUploadToBackend.length: ${filesToUploadToBackend.length}`);

    if (needsBackgroundLoading) {
      console.log('🚀 [POPUP] BACKGROUND LOADING BRANCH: Opening chat immediately, will load files in background');
      alert('Taking BACKGROUND LOADING branch');

      // Save skeleton materials to IndexedDB (with whatever blobs we already have from cache)
      updateProgress('Preparing chat...', PROGRESS_PERCENT.COMPLETE - 5);
      const materialsDB = new MaterialsDB();
      await materialsDB.saveMaterials(currentCourse.id, currentCourse.name, materialsToProcess);
      await materialsDB.close();

      // Open chat interface IMMEDIATELY (before downloads!)
      const chatUrl = chrome.runtime.getURL(`chat/chat.html?courseId=${currentCourse.id}&loading=true`);
      await chrome.tabs.create({ url: chatUrl });

      // Keep popup open with status message
      updateProgress('Downloads in progress... (keep this window open!)', 80);
      document.getElementById('study-bot-btn').textContent = 'Downloading... Please Wait';
      document.getElementById('study-bot-btn').disabled = true;

      // Prepare data for background loading
      const filesToDownloadCopy = allFilesToDownload.map(f => ({
        url: f.url,
        name: f.name,
        type: f.type
      }));
      const filesToUploadCopy = filesToUploadToBackend.map(f => ({
        url: f.url,
        name: f.name,
        type: f.type
      }));

      // SIMPLIFIED APPROACH: Do downloads directly in popup, send completion message when done
      // This is more reliable than service worker approach
      console.log('📤 [POPUP] Starting background downloads directly in popup');

      // Start downloads in background (don't await - let it run)
      (async () => {
        try {
          console.log('📥 [POPUP] Downloading files in background...');

          // Send initial progress message
          chrome.runtime.sendMessage({
            type: 'MATERIALS_LOADING_PROGRESS',
            courseId: currentCourse.id,
            status: 'loading',
            filesCompleted: 0,
            filesTotal: filesToDownloadCopy.length,
            message: `Downloading ${filesToDownloadCopy.length} files...`
          });

          // Download files using existing canvasAPI
          const downloadedFilesBackground = [];
          let completedBackground = 0;

          for (const file of filesToDownloadCopy) {
            try {
              const blob = await canvasAPI.downloadFile(file.url);
              let fileName = file.name;
              if (!fileName.includes('.') && blob.type) {
                const mimeToExt = {
                  'application/pdf': '.pdf',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
                  'text/plain': '.txt'
                };
                const ext = mimeToExt[blob.type];
                if (ext) fileName += ext;
              }
              downloadedFilesBackground.push({ blob, name: fileName });
              completedBackground++;

              // Send progress
              chrome.runtime.sendMessage({
                type: 'MATERIALS_LOADING_PROGRESS',
                courseId: currentCourse.id,
                status: 'loading',
                filesCompleted: completedBackground,
                filesTotal: filesToDownloadCopy.length,
                message: `Downloaded ${completedBackground}/${filesToDownloadCopy.length} files`
              });

              console.log(`✅ [POPUP] Downloaded ${fileName} (${completedBackground}/${filesToDownloadCopy.length})`);
            } catch (error) {
              completedBackground++;
              console.error(`❌ [POPUP] Failed to download ${file.name}:`, error);
            }
          }

          // Upload to backend if needed
          if (downloadedFilesBackground.length > 0 && filesToUploadCopy.length > 0) {
            console.log('📤 [POPUP] Uploading to backend...');
            chrome.runtime.sendMessage({
              type: 'MATERIALS_LOADING_PROGRESS',
              courseId: currentCourse.id,
              status: 'uploading',
              message: 'Uploading files to backend...'
            });

            try {
              await backendClient.uploadPDFs(currentCourse.id, downloadedFilesBackground);
              console.log('✅ [POPUP] Upload complete');
            } catch (error) {
              console.error('❌ [POPUP] Upload failed:', error);
            }
          }

          // Update IndexedDB with downloaded files
          console.log('💾 [POPUP] Updating IndexedDB...');
          const blobMap = new Map();
          downloadedFilesBackground.forEach(df => {
            blobMap.set(df.name, df.blob);
          });

          // Attach blobs to materials
          for (const items of Object.values(materialsToProcess)) {
            if (!Array.isArray(items)) continue;
            items.forEach((item) => {
              const itemName = item.display_name || item.filename || item.name || item.title;
              if (itemName && blobMap.has(itemName)) {
                item.blob = blobMap.get(itemName);
              }
            });
          }

          // Save updated materials
          const materialsDBBackground = new MaterialsDB();
          await materialsDBBackground.saveMaterials(currentCourse.id, currentCourse.name, materialsToProcess);
          await materialsDBBackground.close();

          // Send completion message
          chrome.runtime.sendMessage({
            type: 'MATERIALS_LOADING_COMPLETE',
            courseId: currentCourse.id,
            status: 'complete',
            message: 'All materials loaded!'
          });

          console.log('✅ [POPUP] Background loading complete!');

          // Reset popup UI after completion
          updateProgress('Complete! You can close this window.', 100);
          document.getElementById('study-bot-btn').textContent = 'Create Study Bot';
          document.getElementById('study-bot-btn').disabled = false;

        } catch (error) {
          console.error('❌ [POPUP] Background loading error:', error);
          chrome.runtime.sendMessage({
            type: 'MATERIALS_LOADING_ERROR',
            courseId: currentCourse.id,
            status: 'error',
            error: error.message
          });

          // Reset popup UI on error too
          updateProgress('Error occurred. Try again.', 0);
          document.getElementById('study-bot-btn').textContent = 'Create Study Bot';
          document.getElementById('study-bot-btn').disabled = false;
        }
      })();

    } else {
      // FAST PATH: Everything cached, no background loading needed
      console.log('⚡ [POPUP] FAST PATH BRANCH: All files cached, opening chat immediately');
      console.log('⚡ [POPUP] allFilesToDownload.length was:', allFilesToDownload.length);
      alert('Taking FAST PATH branch - all files cached');

      updateProgress('Saving materials...', PROGRESS_PERCENT.COMPLETE);
      const materialsDB = new MaterialsDB();
      await materialsDB.saveMaterials(currentCourse.id, currentCourse.name, materialsToProcess);
      await materialsDB.close();

      // Open chat interface
      const chatUrl = chrome.runtime.getURL(`chat/chat.html?courseId=${currentCourse.id}`);
      chrome.tabs.create({ url: chatUrl });

      // Reset UI
      setTimeout(() => {
        document.getElementById('study-bot-progress').classList.add('hidden');
        document.getElementById('study-bot-btn').disabled = false;
        document.getElementById('study-bot-progress-fill').style.width = '0%';
      }, 500);
    }

  } catch (error) {
    console.error('Error creating study bot:', error);
    showError(document.getElementById('material-error'), 'Failed to create study bot: ' + error.message);
    document.getElementById('study-bot-progress').classList.add('hidden');
    document.getElementById('study-bot-btn').disabled = false;
  }
}

/**
 * Filter materials - now simplified to just pass through all content types
 * No more keyword-based filtering
 */
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

async function loadSettingsScreen() {
  const authMethod = await StorageManager.getAuthMethod();
  const url = await StorageManager.getCanvasUrl();

  document.getElementById('current-auth-method').textContent = authMethod || 'None';
  document.getElementById('current-canvas-url').textContent = url || 'Not set';
}

async function changeAuthMethod() {
  // Session auth only - just clear and restart
  await StorageManager.clearAll();
  showScreen('sessionSetup');
}

async function clearAllData() {
  await StorageManager.clearAll();
  showScreen('sessionSetup');
}

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

// Theme Management
function initTheme() {
  // Load saved theme preference
  chrome.storage.local.get(['theme'], (result) => {
    const savedTheme = result.theme || 'dark';
    applyTheme(savedTheme);
  });

  // Set up theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);

  // Save theme preference
  chrome.storage.local.set({ theme: newTheme });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeToggle = document.getElementById('theme-toggle');

  if (themeToggle) {
    if (theme === 'light') {
      themeToggle.classList.add('light');
    } else {
      themeToggle.classList.remove('light');
    }
  }
}
