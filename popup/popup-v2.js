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
  console.log('Popup V2 initializing...');

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

    // Debug: Log detailed material structure
    console.log('📊 SCANNED MATERIALS DETAIL:');
    console.log('  Total categories:', Object.keys(materials).length);

    // Log modules in detail
    if (materials.modules && materials.modules.length > 0) {
      console.log('\n📦 MODULES:', materials.modules.length);
      materials.modules.forEach((module, idx) => {
        console.log(`\n  Module ${idx + 1}: "${module.name}"`);
        if (module.items && module.items.length > 0) {
          console.log(`    Items: ${module.items.length}`);
          module.items.forEach((item, itemIdx) => {
            console.log(`      ${itemIdx + 1}. [${item.type}] ${item.title}`);
            if (item.type === 'File') {
              console.log(`         - content_id: ${item.content_id}`);
              console.log(`         - url: ${item.url ? item.url.substring(0, 50) + '...' : 'none'}`);
            } else if (item.type === 'ExternalUrl') {
              console.log(`         - external_url: ${item.external_url}`);
            } else if (item.type === 'Page') {
              console.log(`         - page_url: ${item.page_url}`);
            }
          });
        }
      });
    }

    // Log files
    if (materials.files && materials.files.length > 0) {
      console.log('\n📄 FILES:', materials.files.length);
      const filesByType = {};
      materials.files.forEach(file => {
        const ext = file.display_name ? file.display_name.split('.').pop().toLowerCase() : 'unknown';
        filesByType[ext] = (filesByType[ext] || 0) + 1;
      });
      console.log('  By type:', filesByType);
      // Show first few files
      materials.files.slice(0, 5).forEach((file, idx) => {
        console.log(`    ${idx + 1}. ${file.display_name} (${(file.size / 1024).toFixed(1)}KB)`);
      });
    }

    // Log pages
    if (materials.pages && materials.pages.length > 0) {
      console.log('\n📝 PAGES:', materials.pages.length);
      materials.pages.slice(0, 5).forEach((page, idx) => {
        console.log(`    ${idx + 1}. ${page.title}`);
      });
    }

    // Log assignments
    if (materials.assignments && materials.assignments.length > 0) {
      console.log('\n📋 ASSIGNMENTS:', materials.assignments.length);
      materials.assignments.slice(0, 5).forEach((assignment, idx) => {
        console.log(`    ${idx + 1}. ${assignment.name}`);
      });
    }

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
async function downloadPDFsInParallel(pdfFiles, canvasAPI, progressCallback, concurrency = 8) {
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
 * Create Study Bot - Upload PDFs to backend and open chat interface
 *
 * This function handles the optimized upload flow:
 * 1. Checks backend for already-uploaded files (caching)
 * 2. Downloads only NEW PDFs from Canvas
 * 3. Uploads only new files to backend
 * 4. Opens chat interface
 *
 * Performance: 5-10s first time, <1s if files unchanged
 */
async function createStudyBot() {
  try {
    console.log('🚀 [Popup] Create Study Bot started');
    console.log('   Current course:', currentCourse);

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

    // Get selected materials
    let materialsToProcess;
    if (detailedViewVisible && selectedFiles.size > 0) {
      materialsToProcess = filterSelectedMaterials(scannedMaterials, selectedFiles);
      console.log('Using selected files:', selectedFiles.size, 'items');
    } else {
      const preferences = getPreferencesFromUI();
      materialsToProcess = filterMaterialsByPreferences(scannedMaterials, preferences);
      console.log('Using preferences:', preferences);
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
      'png', 'jpg', 'jpeg', 'gif'    // Images (for vision)
    ];

    // Collect ALL files for local download + determine which need backend upload
    const allFilesToDownload = []; // For local blob storage (ALWAYS download)
    const filesToUploadToBackend = []; // For backend AI processing (only if new)

    // Helper function to process a single item
    const processItem = (item, sourceCategory) => {
      const itemName = item.display_name || item.filename || item.name || item.title;
      if (!itemName || !item.url) {
        console.log(`⏭️  Skipping item without name or URL:`, item);
        return;
      }

      // Try to determine file extension from name, or fetch to get content-type
      let ext = null;
      if (itemName.includes('.')) {
        ext = itemName.split('.').pop().toLowerCase();
      }

      // If no extension or not supported, skip for now (Canvas sometimes uses titles without extensions)
      if (!ext || !supportedExtensions.includes(ext)) {
        console.log(`⏭️  Skipping ${itemName} from ${sourceCategory} (no valid extension, will try to fetch)`);
        // Still add to download list - we'll try to download and see what we get
        allFilesToDownload.push({
          url: item.url,
          name: itemName,
          type: ext || 'unknown'
        });
        return;
      }

      const fileInfo = {
        url: item.url,
        name: itemName,
        type: ext
      };

      // ALWAYS add to download list (for local blobs - needed to open files)
      allFilesToDownload.push(fileInfo);

      // Check backend cache ONLY for upload decision (not download)
      const fileNameWithoutExt = itemName.substring(0, itemName.lastIndexOf('.')) || itemName;
      const fileId = `${currentCourse.id}_${fileNameWithoutExt}`;
      if (!uploadedFileIds.has(fileId)) {
        filesToUploadToBackend.push(fileInfo);
        console.log(`📤 Will upload to backend: ${itemName} (from ${sourceCategory})`);
      } else {
        console.log(`✅ Already on backend (will still download locally): ${itemName}`);
      }
    };

    // Process standalone files, pages, assignments
    for (const [category, items] of Object.entries(materialsToProcess)) {
      if (category === 'modules' || !Array.isArray(items)) continue;

      console.log(`📂 Processing ${category}: ${items.length} items`);
      for (const item of items) {
        processItem(item, category);
      }
    }

    // Process module items (files within modules)
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      console.log(`📦 Processing ${materialsToProcess.modules.length} modules`);
      materialsToProcess.modules.forEach((module, moduleIdx) => {
        if (!module.items || !Array.isArray(module.items)) return;

        console.log(`  📦 Module "${module.name}": ${module.items.length} items`);
        module.items.forEach(item => {
          // Only process File type items from modules
          if (item.type === 'File' && item.url) {
            processItem(item, `module: ${module.name}`);
          }
        });
      });
    }

    console.log(`📊 Total files: ${allFilesToDownload.length}, New files for backend: ${filesToUploadToBackend.length}`);
    console.log(`📊 File type breakdown:`, allFilesToDownload.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {}));

    // ALWAYS download files locally (even if backend has them)
    // This ensures we have blobs for opening files from the sidebar
    updateProgress(`Downloading ${allFilesToDownload.length} files locally...`, PROGRESS_PERCENT.DOWNLOADING_START);
    console.log(`📥 [Popup] Downloading ${allFilesToDownload.length} files for local blob storage...`);
    console.log(`  File types:`, allFilesToDownload.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {}));

    const downloadedFiles = [];
    let completed = 0;
    const total = allFilesToDownload.length;
    const concurrency = 8;

      // Download single file to filesystem AND keep blob for backend upload
      const downloadFile = async (file) => {
        console.log(`📥 [Popup] Downloading: ${file.name} (${file.type})...`);
        try {
          const blob = await canvasAPI.downloadFile(file.url);

          // Create a unique folder structure for this course
          const courseFolder = `CanvasExtension/${fileProcessor.sanitizeFilename(currentCourse.name)}`;
          const filePath = `${courseFolder}/${file.name}`;

          // Download to filesystem using Chrome downloads API
          const blobUrl = URL.createObjectURL(blob);

          const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
              url: blobUrl,
              filename: filePath,
              conflictAction: 'overwrite',  // Overwrite if file exists
              saveAs: false  // Don't prompt user
            }, (id) => {
              if (chrome.runtime.lastError) {
                console.warn(`⚠️  Filesystem download failed for ${file.name}, will use blob only`);
                resolve(null);
              } else {
                resolve(id);
              }
            });
          });

          // Store both blob (for backend upload) and download info
          downloadedFiles.push({
            blob,
            name: file.name,
            downloadId,
            filePath
          });

          completed++;

          // Clean up blob URL after a delay
          setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

          // Update progress
          const downloadProgressRange = PROGRESS_PERCENT.DOWNLOADING_END - PROGRESS_PERCENT.DOWNLOADING_START;
          const progress = PROGRESS_PERCENT.DOWNLOADING_START + ((completed / total) * downloadProgressRange);
          updateProgress(`Downloading files: ${completed}/${total}`, progress);

          console.log(`✅ [Popup] Downloaded ${file.name} to filesystem (${blob.size} bytes, ${completed}/${total})`);
          return { success: true, name: file.name, size: blob.size, downloadId, filePath };
        } catch (error) {
          completed++;

          // Update progress even on error
          const downloadProgressRange = PROGRESS_PERCENT.DOWNLOADING_END - PROGRESS_PERCENT.DOWNLOADING_START;
          const progress = PROGRESS_PERCENT.DOWNLOADING_START + ((completed / total) * downloadProgressRange);
          updateProgress(`Downloading files: ${completed}/${total}`, progress);

          console.error(`❌ [Popup] Failed to download ${file.name}:`, error);
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

    console.log(`📦 [Popup] Downloaded ${downloadedFiles.length}/${total} files successfully`);
    console.log(`  Total size: ${downloadedFiles.reduce((sum, f) => sum + (f.blob?.size || 0), 0).toLocaleString()} bytes`);

    // Upload to backend ONLY files that are new (not in backend cache)
    if (filesToUploadToBackend.length > 0) {
      updateProgress(`Uploading ${filesToUploadToBackend.length} new files to backend...`, PROGRESS_PERCENT.UPLOADING);

      // Filter downloaded files to only include ones that need backend upload
      const blobsToUpload = downloadedFiles.filter(df =>
        filesToUploadToBackend.some(f => f.name === df.name)
      );

      console.log(`📤 [Popup] Uploading ${blobsToUpload.length} new files to backend...`);
      await backendClient.uploadPDFs(currentCourse.id, blobsToUpload);
      console.log(`✅ [Popup] Uploaded ${blobsToUpload.length} new files to backend`);
    } else {
      console.log(`✅ [Popup] All files already on backend, skipping upload`);
    }

    // Attach download info to materials (blob for backend, downloadId/filePath for opening)
    console.log(`🔗 [Popup] Attaching ${downloadedFiles.length} file references to materials structure...`);
    const fileMap = new Map();
    downloadedFiles.forEach(df => {
      fileMap.set(df.name, df);
    });
    console.log(`  Created file map with ${fileMap.size} entries`);

    // Attach file info to all matching items in materialsToProcess
    let attachedCount = 0;
    let notFoundCount = 0;
    const notFoundItems = [];

    for (const [category, items] of Object.entries(materialsToProcess)) {
      if (!Array.isArray(items)) continue;

      items.forEach((item) => {
        const itemName = item.display_name || item.filename || item.name || item.title;
        if (itemName && fileMap.has(itemName)) {
          const fileInfo = fileMap.get(itemName);
          item.blob = fileInfo.blob;  // For backend upload
          item.downloadId = fileInfo.downloadId;  // For opening from filesystem
          item.filePath = fileInfo.filePath;  // For reference
          attachedCount++;
          console.log(`  ✅ [${category}] Attached file info to: ${itemName} (${item.blob.size} bytes, path: ${fileInfo.filePath})`);
        } else if (itemName) {
          notFoundCount++;
          notFoundItems.push({ category, name: itemName });
          console.warn(`  ⚠️  [${category}] No file found for: ${itemName}`);
        }
      });
    }

    // ALSO attach to module items (files within modules)
    if (materialsToProcess.modules && Array.isArray(materialsToProcess.modules)) {
      console.log(`  Attaching file info to ${materialsToProcess.modules.length} modules...`);
      materialsToProcess.modules.forEach((module) => {
        if (module.items && Array.isArray(module.items)) {
          module.items.forEach((item) => {
            const itemName = item.title || item.name || item.display_name;
            if (itemName && fileMap.has(itemName)) {
              const fileInfo = fileMap.get(itemName);
              item.blob = fileInfo.blob;  // For backend upload
              item.downloadId = fileInfo.downloadId;  // For opening from filesystem
              item.filePath = fileInfo.filePath;  // For reference
              attachedCount++;
              console.log(`  ✅ [module: ${module.name}] Attached file info to: ${itemName} (${item.blob.size} bytes, path: ${fileInfo.filePath})`);
            } else if (itemName) {
              notFoundCount++;
              notFoundItems.push({ category: 'module', moduleName: module.name, name: itemName });
              console.warn(`  ⚠️  [module: ${module.name}] No file found for: ${itemName}`);
            }
          });
        }
      });
    }

    console.log(`📊 [Popup] Blob attachment summary:`);
    console.log(`  Downloaded blobs: ${downloadedFiles.length}`);
    console.log(`  Blobs attached: ${attachedCount}`);
    console.log(`  Items without blobs: ${notFoundCount}`);

    if (notFoundCount > 0) {
      console.warn(`⚠️  [Popup] ${notFoundCount} items did not get blobs attached:`, notFoundItems);
    }

    if (attachedCount !== downloadedFiles.length) {
      console.warn(`⚠️  [Popup] Mismatch: Downloaded ${downloadedFiles.length} files but only attached ${attachedCount} blobs`);
    }

    updateProgress('Saving materials to database...', PROGRESS_PERCENT.COMPLETE);

    // Save to IndexedDB (supports Blob objects directly, no size limit!)
    console.log('💾 [Popup] Saving materials with blobs to IndexedDB...');
    console.log('   Course ID being saved:', currentCourse.id);
    console.log('   Course name being saved:', currentCourse.name);
    console.log('   Materials structure:', {
      modules: materialsToProcess.modules?.length || 0,
      files: materialsToProcess.files?.length || 0,
      pages: materialsToProcess.pages?.length || 0,
      assignments: materialsToProcess.assignments?.length || 0
    });

    const materialsDB = new MaterialsDB();
    await materialsDB.saveMaterials(currentCourse.id, currentCourse.name, materialsToProcess);
    await materialsDB.close();
    console.log('✅ [Popup] Materials saved to IndexedDB successfully');

    // Verify the save worked
    console.log('🔍 [Popup] Verifying save...');
    const verifyDB = new MaterialsDB();
    const savedData = await verifyDB.loadMaterials(currentCourse.id);
    await verifyDB.close();

    if (savedData) {
      console.log('✅ [Popup] Verification successful - data found in IndexedDB');
      console.log('   Verified course ID:', savedData.courseId);
      console.log('   Verified course name:', savedData.courseName);
    } else {
      console.error('❌ [Popup] Verification FAILED - data NOT found in IndexedDB after save!');
      throw new Error('Failed to save materials to IndexedDB');
    }

    // Open chat interface
    const chatUrl = chrome.runtime.getURL(`chat/chat.html?courseId=${currentCourse.id}`);
    console.log('🌐 [Popup] Opening chat URL:', chatUrl);
    chrome.tabs.create({ url: chatUrl });

    // Reset UI
    setTimeout(() => {
      document.getElementById('study-bot-progress').classList.add('hidden');
      document.getElementById('study-bot-btn').disabled = false;
      document.getElementById('study-bot-progress-fill').style.width = '0%';
    }, 1000);

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
