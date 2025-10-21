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

  fileProcessor = new FileProcessor();

  // Check if user has any authentication configured
  const authMethod = await StorageManager.getAuthMethod();

  if (authMethod) {
    currentAuthMethod = authMethod;

    // Special handling for session auth
    if (authMethod === 'session') {
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
          showAuthMethodScreen();
        }
      } else {
        showAuthMethodScreen();
      }
    } else {
      // For OAuth and token methods, use existing logic
      const hasAuth = await StorageManager.hasAnyAuth();

      if (hasAuth) {
        await loadMainScreen();
      } else {
        showAuthMethodScreen();
      }
    }
  } else {
    showAuthMethodScreen();
  }

  setupEventListeners();

  // Display extension ID for OAuth setup
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

  // Back buttons
  document.getElementById('back-to-auth-method').addEventListener('click', () => showScreen('authMethod'));
  document.getElementById('oauth-back-btn').addEventListener('click', () => showScreen('authMethod'));
  document.getElementById('token-back-btn').addEventListener('click', () => showScreen('authMethod'));

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

  // Checkboxes
  ['include-syllabus', 'include-lectures', 'include-readings', 'include-assignments', 'include-pages'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateMaterialSummary);
  });

  // Detailed view toggle
  document.getElementById('toggle-detailed-view').addEventListener('click', toggleDetailedView);
}

function showScreen(screenName) {
  Object.values(screens).forEach(screen => screen.classList.add('hidden'));
  screens[screenName].classList.remove('hidden');
}

function showAuthMethodScreen() {
  showScreen('authMethod');
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

  if (!courseId) {
    document.getElementById('material-section').classList.add('hidden');
    return;
  }

  const courseName = document.getElementById('course-select').options[document.getElementById('course-select').selectedIndex].text;
  currentCourse = { id: courseId, name: courseName };

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

  document.getElementById('syllabus-count').textContent = summary.byCategory.syllabus || 0;
  document.getElementById('lectures-count').textContent = summary.byCategory.lectures || 0;
  document.getElementById('readings-count').textContent = summary.byCategory.readings || 0;
  document.getElementById('assignments-count').textContent = summary.byCategory.assignments || 0;
  document.getElementById('pages-count').textContent = summary.byCategory.pages || 0;
}

function getPreferencesFromUI() {
  return {
    includeSyllabus: document.getElementById('include-syllabus').checked,
    includeLectures: document.getElementById('include-lectures').checked,
    includeReadings: document.getElementById('include-readings').checked,
    includeAssignments: document.getElementById('include-assignments').checked,
    includePages: document.getElementById('include-pages').checked
  };
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
    const backendClient = new BackendClient('http://localhost:8000');
    const isBackendReady = await backendClient.healthCheck();

    if (!isBackendReady) {
      throw new Error('Backend not available. Please start the Python backend.');
    }

    // Get list of files already uploaded
    const statusResponse = await fetch(`http://localhost:8000/collections/${currentCourse.id}/status`);
    const status = await statusResponse.json();
    const uploadedFileIds = new Set(status.files || []);

    updateProgress('Collecting PDFs...', PROGRESS_PERCENT.COLLECTING);

    // Get PDF URLs that need to be uploaded
    const pdfFiles = [];
    for (const [category, items] of Object.entries(materialsToProcess)) {
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        // Only process PDFs
        const itemName = item.display_name || item.filename || item.name;
        if (!itemName || !itemName.toLowerCase().endsWith('.pdf')) continue;
        if (!item.url) continue;

        // Check if already uploaded (backend format: courseId_filename without .pdf)
        const fileId = `${currentCourse.id}_${itemName.replace('.pdf', '')}`;
        if (uploadedFileIds.has(fileId)) {
          console.log(`⏭️  Skipping ${itemName} (already uploaded)`);
          continue;
        }

        pdfFiles.push({
          url: item.url,
          name: itemName
        });
      }
    }

    if (pdfFiles.length === 0) {
      updateProgress('All files already uploaded!', 90);
      console.log('✅ All files already on backend, opening chat...');
    } else {
      updateProgress(`Downloading ${pdfFiles.length} new PDFs...`, PROGRESS_PERCENT.DOWNLOADING_START);

      // Download and upload PDFs
      const filesToUpload = [];
      const downloadProgressRange = PROGRESS_PERCENT.DOWNLOADING_END - PROGRESS_PERCENT.DOWNLOADING_START;

      for (let i = 0; i < pdfFiles.length; i++) {
        const pdf = pdfFiles[i];
        const progress = PROGRESS_PERCENT.DOWNLOADING_START + ((i / pdfFiles.length) * downloadProgressRange);
        updateProgress(`Downloading ${pdf.name}...`, progress);

        try {
          const blob = await canvasAPI.downloadFile(pdf.url);
          filesToUpload.push({ blob, name: pdf.name });
        } catch (error) {
          console.warn(`Failed to download ${pdf.name}:`, error);
        }
      }

      if (filesToUpload.length > 0) {
        updateProgress(`Uploading ${filesToUpload.length} PDFs to backend...`, PROGRESS_PERCENT.UPLOADING);
        await backendClient.uploadPDFs(currentCourse.id, filesToUpload);
        console.log(`✅ Uploaded ${filesToUpload.length} new PDFs`);
      }
    }

    updateProgress('Opening study assistant...', PROGRESS_PERCENT.COMPLETE);

    // Save course metadata and materials for chat interface
    const storageKey = `course_materials_${currentCourse.id}`;
    await chrome.storage.local.set({
      [storageKey]: {
        courseName: currentCourse.name,
        courseId: currentCourse.id,
        materials: materialsToProcess
      }
    });

    // Open chat interface
    const chatUrl = chrome.runtime.getURL(`chat/chat.html?courseId=${currentCourse.id}`);
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
 * Filter materials by simple view preferences (category checkboxes)
 */
function filterMaterialsByPreferences(materials, preferences) {
  const filtered = {
    modules: [],
    files: [],
    pages: [],
    assignments: [],
    errors: materials.errors || []
  };

  // Process files based on categorization
  if (materials.files && materials.files.length > 0) {
    materials.files.forEach(file => {
      const fileName = (file.display_name || file.name || '').toLowerCase();

      // Categorize and check if included
      if (preferences.includeSyllabus && fileName.includes('syllabus')) {
        filtered.files.push(file);
      } else if (preferences.includeLectures && (fileName.includes('lecture') || fileName.includes('slides') || fileName.includes('chapter'))) {
        filtered.files.push(file);
      } else if (preferences.includeReadings && (fileName.includes('reading') || fileName.includes('textbook'))) {
        filtered.files.push(file);
      } else if (preferences.includeLectures || preferences.includeReadings) {
        // Include other files if either lectures or readings is checked
        filtered.files.push(file);
      }
    });
  }

  // Assignments
  if (preferences.includeAssignments && materials.assignments) {
    filtered.assignments = materials.assignments;
  }

  // Pages
  if (preferences.includePages && materials.pages) {
    filtered.pages = materials.pages;
  }

  // Modules - always include if they exist
  if (materials.modules) {
    filtered.modules = materials.modules;
  }

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
  if (confirm('This will clear your current authentication. Continue?')) {
    await StorageManager.clearAll();
    showAuthMethodScreen();
  }
}

async function clearAllData() {
  if (confirm('Are you sure you want to clear all data? This will remove all authentication and settings.')) {
    await StorageManager.clearAll();
    showAuthMethodScreen();
  }
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
