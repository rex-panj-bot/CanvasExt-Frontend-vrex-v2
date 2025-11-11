/**
 * Settings Page - API Key and Web Search Management
 */

// Initialize theme based on saved preference
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// Initialize theme before DOM loads
initializeTheme();

// Storage keys
const STORAGE_KEYS = {
  API_KEY: 'gemini_api_key',
  WEB_SEARCH: 'enable_web_search',
  CURRENT_COURSE: 'current_course_id'
};

// DOM Elements
const elements = {
  apiKeyInput: document.getElementById('apiKeyInput'),
  saveKeyBtn: document.getElementById('saveKeyBtn'),
  clearKeyBtn: document.getElementById('clearKeyBtn'),
  changeKeyBtn: document.getElementById('changeKeyBtn'),
  apiKeyDisplay: document.getElementById('apiKeyDisplay'),
  apiKeyForm: document.getElementById('apiKeyForm'),
  maskedKey: document.getElementById('maskedKey'),
  statusMessage: document.getElementById('statusMessage'),
  showGuideBtn: document.getElementById('showGuideBtn'),
  setupGuide: document.getElementById('setupGuide'),
  webSearchToggle: document.getElementById('webSearchToggle'),
  syllabusStatus: document.getElementById('syllabusStatus'),
  syllabusSelector: document.getElementById('syllabusSelector'),
  syllabusSelect: document.getElementById('syllabusSelect'),
  saveSyllabusBtn: document.getElementById('saveSyllabusBtn')
};

/**
 * Initialize settings page
 */
async function init() {
  await loadSettings();
  await loadSyllabusSettings();
  await loadDeletedFiles();
  attachEventListeners();
}

/**
 * Load existing settings from storage
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.API_KEY, STORAGE_KEYS.WEB_SEARCH]);

    // Load API key
    const apiKey = result[STORAGE_KEYS.API_KEY];
    if (apiKey) {
      showApiKeyDisplay(apiKey);
    } else {
      showApiKeyForm();
    }

    // Load web search setting
    const webSearchEnabled = result[STORAGE_KEYS.WEB_SEARCH] || false;
    elements.webSearchToggle.checked = webSearchEnabled;

  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

/**
 * Attach event listeners
 */
function attachEventListeners() {
  // API Key buttons
  elements.saveKeyBtn.addEventListener('click', saveApiKey);
  elements.clearKeyBtn.addEventListener('click', clearApiKey);
  elements.changeKeyBtn.addEventListener('click', showApiKeyForm);
  elements.showGuideBtn.addEventListener('click', toggleGuide);

  // Web search toggle
  elements.webSearchToggle.addEventListener('change', saveWebSearchSetting);

  // Theme toggle icon
  const settingsThemeToggle = document.getElementById('settings-theme-toggle');
  if (settingsThemeToggle) {
    settingsThemeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';

      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      chrome.storage.local.set({ theme: newTheme });
    });
  }

  // Enter key to save
  elements.apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveApiKey();
    }
  });
}

/**
 * Save API key
 */
async function saveApiKey() {
  const apiKey = elements.apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus('Please enter an API key', 'error');
    return;
  }

  // Basic validation - Google Gemini API keys start with "AIza"
  if (!apiKey.startsWith('AIza')) {
    showStatus('Invalid API key format. Google Gemini API keys start with "AIza"', 'error');
    return;
  }

  if (apiKey.length < 39) {
    showStatus('API key seems too short. Please check you copied the complete key.', 'error');
    return;
  }

  try {
    // Test the API key
    showStatus('Testing API key...', 'info');
    const isValid = await testApiKey(apiKey);

    if (!isValid) {
      showStatus('API key is invalid or quota exceeded. Please check your key.', 'error');
      return;
    }

    // Save to storage
    await chrome.storage.local.set({ [STORAGE_KEYS.API_KEY]: apiKey });

    showStatus('API key saved successfully! ✓', 'success');
    setTimeout(() => {
      showApiKeyDisplay(apiKey);
    }, 1500);

  } catch (error) {
    console.error('Error saving API key:', error);
    showStatus('Error saving API key: ' + error.message, 'error');
  }
}

/**
 * Test API key validity
 */
async function testApiKey(apiKey) {
  try {
    // Make a simple test request to Gemini API
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);

    if (response.status === 200) {
      return true;
    } else if (response.status === 400 || response.status === 403) {
      return false;
    } else {
      // For other errors, assume key might be valid but rate limited
      console.warn('API test returned status:', response.status);
      return true;
    }
  } catch (error) {
    console.error('Error testing API key:', error);
    // If network error, assume key might be valid
    return true;
  }
}

/**
 * Clear API key
 */
async function clearApiKey() {
  if (!confirm('Are you sure you want to remove your API key?')) {
    return;
  }

  try {
    await chrome.storage.local.remove(STORAGE_KEYS.API_KEY);
    showStatus('API key removed', 'info');
    showApiKeyForm();
    elements.apiKeyInput.value = '';
  } catch (error) {
    console.error('Error clearing API key:', error);
    showStatus('Error removing API key', 'error');
  }
}

/**
 * Save web search setting
 */
async function saveWebSearchSetting() {
  const enabled = elements.webSearchToggle.checked;

  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.WEB_SEARCH]: enabled });
    console.log('Web search setting saved:', enabled);
  } catch (error) {
    console.error('Error saving web search setting:', error);
  }
}

/**
 * Show API key display (masked)
 */
function showApiKeyDisplay(apiKey) {
  const masked = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
  elements.maskedKey.textContent = masked;

  elements.apiKeyDisplay.style.display = 'block';
  elements.apiKeyForm.style.display = 'none';
  elements.clearKeyBtn.style.display = 'inline-block';
}

/**
 * Show API key form
 */
function showApiKeyForm() {
  elements.apiKeyDisplay.style.display = 'none';
  elements.apiKeyForm.style.display = 'block';
  elements.apiKeyInput.focus();
}

/**
 * Toggle setup guide
 */
function toggleGuide() {
  const isVisible = elements.setupGuide.style.display !== 'none';
  elements.setupGuide.style.display = isVisible ? 'none' : 'block';
  elements.showGuideBtn.textContent = isVisible ? 'How do I get an API key?' : 'Hide guide';
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${type}`;
  elements.statusMessage.style.display = 'block';

  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      elements.statusMessage.style.display = 'none';
    }, 5000);
  }
}

/**
 * Load syllabus settings for current course
 */
async function loadSyllabusSettings() {
  try {
    // Get current course ID
    const result = await chrome.storage.local.get([STORAGE_KEYS.CURRENT_COURSE]);
    const courseId = result[STORAGE_KEYS.CURRENT_COURSE];

    if (!courseId) {
      elements.syllabusStatus.innerHTML = '<p style="color: #999; font-size: 14px;">No course selected. Please go to the main screen and select a course first.</p>';
      return;
    }

    // Get backend URL
    const backendUrl = 'https://canvasext-backend-production.up.railway.app';

    // Fetch current syllabus
    const syllabusResponse = await fetch(`${backendUrl}/courses/${courseId}/syllabus`);
    const syllabusData = await syllabusResponse.json();

    // Get all materials for the course
    const materialsResponse = await fetch(`${backendUrl}/chats/${courseId}`);
    const materialsData = await materialsResponse.json();

    if (!materialsData.success || !materialsData.summaries) {
      elements.syllabusStatus.innerHTML = '<p style="color: #999; font-size: 14px;">No course materials found. Please scan course first.</p>';
      return;
    }

    // Populate dropdown with all files
    elements.syllabusSelect.innerHTML = '<option value="">-- No Syllabus --</option>';
    materialsData.summaries.forEach(file => {
      const option = document.createElement('option');
      option.value = file.doc_id;
      option.textContent = file.filename;
      elements.syllabusSelect.appendChild(option);
    });

    // Set current syllabus if exists
    if (syllabusData.success && syllabusData.syllabus_id) {
      elements.syllabusSelect.value = syllabusData.syllabus_id;
      const source = syllabusData.source === 'stored' ? '✅ Saved' : '🔍 Auto-detected';
      elements.syllabusStatus.innerHTML = `<p style="color: #28a745; font-size: 14px;"><strong>Current Syllabus:</strong> ${syllabusData.syllabus_name} (${source})</p>`;
    } else {
      elements.syllabusStatus.innerHTML = '<p style="color: #999; font-size: 14px;">No syllabus set. Select one below.</p>';
    }

    // Show selector
    elements.syllabusSelector.style.display = 'block';

    // Add save handler
    elements.saveSyllabusBtn.onclick = async () => {
      const selectedSyllabusId = elements.syllabusSelect.value;

      if (!selectedSyllabusId) {
        // Clear syllabus
        elements.syllabusStatus.innerHTML = '<p style="color: #999; font-size: 14px;">No syllabus selected.</p>';
        return;
      }

      try {
        const response = await fetch(`${backendUrl}/courses/${courseId}/syllabus?syllabus_id=${encodeURIComponent(selectedSyllabusId)}`, {
          method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
          elements.syllabusStatus.innerHTML = `<p style="color: #28a745; font-size: 14px;"><strong>✅ Syllabus saved:</strong> ${data.syllabus_name}</p>`;
        } else {
          elements.syllabusStatus.innerHTML = `<p style="color: #dc3545; font-size: 14px;">❌ Error: ${data.error}</p>`;
        }
      } catch (error) {
        console.error('Error saving syllabus:', error);
        elements.syllabusStatus.innerHTML = '<p style="color: #dc3545; font-size: 14px;">❌ Failed to save syllabus. Please try again.</p>';
      }
    };

  } catch (error) {
    console.error('Error loading syllabus settings:', error);
    elements.syllabusStatus.innerHTML = '<p style="color: #dc3545; font-size: 14px;">❌ Failed to load syllabus settings.</p>';
  }
}

/**
 * Load deleted files for current course
 */
async function loadDeletedFiles() {
  const deletedFilesStatus = document.getElementById('deletedFilesStatus');
  const noDeletedFiles = document.getElementById('noDeletedFiles');
  const deletedFilesList = document.getElementById('deletedFilesList');
  const bulkActions = document.getElementById('bulkActions');

  try {
    // Get current course ID
    const result = await chrome.storage.local.get([STORAGE_KEYS.CURRENT_COURSE]);
    const courseId = result[STORAGE_KEYS.CURRENT_COURSE];

    if (!courseId) {
      noDeletedFiles.textContent = 'No course selected. Please go to the main screen and select a course first.';
      noDeletedFiles.style.display = 'block';
      return;
    }

    // Get backend URL
    const backendUrl = 'https://web-production-9aaba7.up.railway.app';

    // Fetch deleted files
    const response = await fetch(`${backendUrl}/courses/${courseId}/deleted-materials`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch deleted files');
    }

    const deletedFiles = data.deleted_files || [];

    if (deletedFiles.length === 0) {
      noDeletedFiles.style.display = 'block';
      deletedFilesList.style.display = 'none';
      bulkActions.style.display = 'none';
      return;
    }

    // Render deleted files list
    noDeletedFiles.style.display = 'none';
    deletedFilesList.style.display = 'block';
    bulkActions.style.display = 'block';

    deletedFilesList.innerHTML = deletedFiles.map(file => {
      const deletedDate = new Date(file.deleted_at).toLocaleDateString();
      const metadata = file.metadata || {};
      const fileSize = metadata.size ? formatFileSize(metadata.size) : '';

      return `
        <div class="deleted-file-item" data-file-id="${file.doc_id}">
          <div class="deleted-file-info">
            <div class="deleted-file-name" title="${file.filename}">${file.filename}</div>
            <div class="deleted-file-meta">Deleted on ${deletedDate} ${fileSize ? '• ' + fileSize : ''}</div>
          </div>
          <div class="deleted-file-actions">
            <button class="btn-small btn-restore" onclick="restoreFile('${file.doc_id}', '${courseId}')">
              Restore
            </button>
            <button class="btn-small btn-delete-permanent" onclick="deleteFilePermanently('${file.doc_id}', '${courseId}', '${file.filename.replace(/'/g, "\\'")}')">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Setup bulk action handlers
    document.getElementById('restoreAllBtn').onclick = () => restoreAllFiles(courseId, deletedFiles);
    document.getElementById('deleteAllBtn').onclick = () => deleteAllFilesPermanently(courseId, deletedFiles);

  } catch (error) {
    console.error('Error loading deleted files:', error);
    showDeletedFilesStatus('Failed to load deleted files: ' + error.message, 'error');
  }
}

/**
 * Restore a single file
 */
async function restoreFile(fileId, courseId) {
  const backendUrl = 'https://web-production-9aaba7.up.railway.app';

  try {
    showDeletedFilesStatus('Restoring file...', 'info');

    const response = await fetch(`${backendUrl}/courses/${courseId}/materials/${fileId}/restore`, {
      method: 'PUT'
    });

    const data = await response.json();

    if (data.success) {
      showDeletedFilesStatus('File restored successfully!', 'success');
      // Reload deleted files list
      await loadDeletedFiles();
    } else {
      throw new Error(data.error || 'Failed to restore file');
    }
  } catch (error) {
    console.error('Error restoring file:', error);
    showDeletedFilesStatus('Error restoring file: ' + error.message, 'error');
  }
}

/**
 * Permanently delete a single file
 */
async function deleteFilePermanently(fileId, courseId, fileName) {
  if (!confirm(`Are you sure you want to permanently delete "${fileName}"?\n\nThis action cannot be undone and will remove the file from cloud storage.`)) {
    return;
  }

  const backendUrl = 'https://web-production-9aaba7.up.railway.app';

  try {
    showDeletedFilesStatus('Permanently deleting file...', 'info');

    const response = await fetch(`${backendUrl}/courses/${courseId}/materials/${fileId}?permanent=true`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      showDeletedFilesStatus('File permanently deleted', 'success');
      // Reload deleted files list
      await loadDeletedFiles();
    } else {
      throw new Error(data.error || 'Failed to delete file');
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    showDeletedFilesStatus('Error deleting file: ' + error.message, 'error');
  }
}

/**
 * Restore all files
 */
async function restoreAllFiles(courseId, files) {
  if (!confirm(`Restore all ${files.length} files?`)) {
    return;
  }

  const backendUrl = 'https://web-production-9aaba7.up.railway.app';
  let successCount = 0;
  let errorCount = 0;

  showDeletedFilesStatus(`Restoring ${files.length} files...`, 'info');

  for (const file of files) {
    try {
      const response = await fetch(`${backendUrl}/courses/${courseId}/materials/${file.doc_id}/restore`, {
        method: 'PUT'
      });

      const data = await response.json();
      if (data.success) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error('Error restoring file:', file.filename, error);
      errorCount++;
    }
  }

  if (errorCount === 0) {
    showDeletedFilesStatus(`All ${successCount} files restored successfully!`, 'success');
  } else {
    showDeletedFilesStatus(`Restored ${successCount} files, ${errorCount} failed`, 'error');
  }

  // Reload deleted files list
  await loadDeletedFiles();
}

/**
 * Delete all files permanently
 */
async function deleteAllFilesPermanently(courseId, files) {
  if (!confirm(`Are you sure you want to PERMANENTLY delete all ${files.length} files?\n\nThis action cannot be undone and will remove all files from cloud storage.`)) {
    return;
  }

  const backendUrl = 'https://web-production-9aaba7.up.railway.app';
  let successCount = 0;
  let errorCount = 0;

  showDeletedFilesStatus(`Permanently deleting ${files.length} files...`, 'info');

  for (const file of files) {
    try {
      const response = await fetch(`${backendUrl}/courses/${courseId}/materials/${file.doc_id}?permanent=true`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error('Error deleting file:', file.filename, error);
      errorCount++;
    }
  }

  if (errorCount === 0) {
    showDeletedFilesStatus(`All ${successCount} files permanently deleted`, 'success');
  } else {
    showDeletedFilesStatus(`Deleted ${successCount} files, ${errorCount} failed`, 'error');
  }

  // Reload deleted files list
  await loadDeletedFiles();
}

/**
 * Show status message for deleted files section
 */
function showDeletedFilesStatus(message, type = 'info') {
  const statusElement = document.getElementById('deletedFilesStatus');
  statusElement.textContent = message;
  statusElement.className = `status-message ${type}`;
  statusElement.style.display = 'block';

  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      statusElement.style.display = 'none';
    }, 5000);
  }
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Make functions globally available for inline onclick handlers
window.restoreFile = restoreFile;
window.deleteFilePermanently = deleteFilePermanently;

// Initialize on page load
init();
