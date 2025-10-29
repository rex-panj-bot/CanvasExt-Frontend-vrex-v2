/**
 * Chat Interface - AI Study Assistant
 */

// Global variables
let wsClient = null; // WebSocket client for Python backend
let backendClient = null; // HTTP client for backend
let courseName = '';
let courseId = '';
let conversationHistory = [];
let processedMaterials = null; // Course materials for sidebar display
let currentSessionId = null; // Current chat session ID for saving
let availableCourses = []; // List of courses with materials

// DOM Elements
const elements = {
  courseName: document.getElementById('sidebar-course-name'),
  welcomeCourseName: document.getElementById('welcome-course-name'),
  materialsList: document.getElementById('materials-list'),
  messagesContainer: document.getElementById('messages-container'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  newChatBtn: document.getElementById('new-chat-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  exportChatBtn: document.getElementById('export-chat-btn'),
  clearChatBtn: document.getElementById('clear-chat-btn'),
  apiStatusIndicator: document.getElementById('api-status-indicator'),
  apiStatusText: document.getElementById('api-status-text'),
  tokenInfo: document.getElementById('token-info'),
  loadingBanner: document.getElementById('loading-banner'),
  loadingBannerText: document.getElementById('loading-banner-text'),

  // Settings modal
  settingsModal: document.getElementById('settings-modal'),
  closeSettings: document.getElementById('close-settings')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

/**
 * Setup polling for background loading progress from chrome.storage.local
 */
function setupBackgroundLoadingListener() {
  console.log('📡 [CHAT] Setting up background loading polling for course:', courseId);

  // Show loading banner
  showLoadingBanner('Loading course materials...');

  // Poll chrome.storage.local for download task updates
  const pollInterval = setInterval(() => {
    chrome.storage.local.get(['downloadTask'], async (result) => {
      const task = result.downloadTask;

      if (!task) {
        console.log('⚠️ [CHAT] No download task found in storage');
        return;
      }

      // Check if this task is for our course
      if (task.courseId !== courseId) {
        console.log('📥 [CHAT] Ignoring task for different course:', task.courseId, 'vs', courseId);
        return;
      }

      console.log('📥 [CHAT] Download task status:', task.status, task.progress);

      if (task.status === 'downloading' || task.status === 'uploading') {
        // Show progress
        const progress = task.progress;
        if (progress) {
          const percent = progress.filesTotal > 0
            ? Math.round((progress.filesCompleted / progress.filesTotal) * 100)
            : 0;
          showLoadingBanner(`${progress.message} (${percent}%)`);
        }

      } else if (task.status === 'complete') {
        console.log('✅ [CHAT] Loading complete!');
        clearInterval(pollInterval); // Stop polling
        showLoadingBanner('Materials loaded! Updating display...', 'success');

        // Update IndexedDB with downloaded files
        try {
          if (task.downloadedFiles && task.downloadedFiles.length > 0) {
            console.log('💾 [CHAT] Updating IndexedDB with downloaded files...');

            // Load current materials
            const materialsDB = new MaterialsDB();
            const materialsData = await materialsDB.loadMaterials(courseId);

            if (materialsData) {
              // Create blob map
              const blobMap = new Map();
              task.downloadedFiles.forEach(df => {
                blobMap.set(df.name, df.blob);
              });

              // Attach blobs to materials
              const materials = materialsData.materials;
              for (const items of Object.values(materials)) {
                if (!Array.isArray(items)) continue;
                items.forEach((item) => {
                  const itemName = item.display_name || item.filename || item.name || item.title;
                  if (itemName && blobMap.has(itemName)) {
                    item.blob = blobMap.get(itemName);
                  }
                });
              }

              // Save updated materials
              await materialsDB.saveMaterials(courseId, task.courseName, materials);
              console.log('✅ [CHAT] IndexedDB updated with blobs');
            }

            await materialsDB.close();
          }

          // Reload materials from IndexedDB (now with blobs)
          await loadMaterials();

          // Clear the download task from storage
          chrome.storage.local.remove(['downloadTask'], () => {
            console.log('🧹 [CHAT] Cleared download task from storage');
          });

          hideLoadingBanner();

        } catch (error) {
          console.error('❌ [CHAT] Error updating materials:', error);
          showLoadingBanner('Materials loaded but error updating display', 'error');
          setTimeout(() => hideLoadingBanner(), 3000);
        }

      } else if (task.status === 'error') {
        console.error('❌ [CHAT] Loading error:', task.error);
        clearInterval(pollInterval); // Stop polling
        showLoadingBanner(`Error: ${task.error || 'Unknown error'}`, 'error');
        setTimeout(() => hideLoadingBanner(), 5000);
      }
    });
  }, 500); // Poll every 500ms

  // Stop polling after 5 minutes (safety timeout)
  setTimeout(() => {
    clearInterval(pollInterval);
    console.log('⏱️ [CHAT] Background loading poll timeout');
  }, 5 * 60 * 1000);
}

/**
 * Show loading banner at top of chat
 */
function showLoadingBanner(message, type = 'info') {
  if (!elements.loadingBanner) return;

  elements.loadingBanner.classList.remove('hidden');
  elements.loadingBanner.classList.remove('success', 'error', 'info');
  elements.loadingBanner.classList.add(type);

  if (elements.loadingBannerText) {
    elements.loadingBannerText.textContent = message;
  }
}

/**
 * Hide loading banner
 */
function hideLoadingBanner() {
  if (elements.loadingBanner) {
    elements.loadingBanner.classList.add('hidden');
  }
}

async function init() {
  console.log('Chat interface initializing...');

  // Check for API key first (required to use the chat)
  const hasApiKey = await checkAndPromptForApiKey();
  if (!hasApiKey) {
    return; // Stop initialization until API key is provided
  }

  // Initialize theme
  initTheme();

  // Get course ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  courseId = urlParams.get('courseId');

  if (!courseId) {
    showError('No course selected. Please go back and select a course.');
    return;
  }

  // Generate session ID for this chat
  currentSessionId = `session_${courseId}_${Date.now()}`;

  // Check if we're in loading mode (background loading in progress)
  const isLoading = urlParams.get('loading') === 'true';

  // Setup background loading listener
  if (isLoading) {
    setupBackgroundLoadingListener();
  }

  // Load materials from storage
  await loadMaterials();

  // Load API key and initialize Claude
  await loadAPIKey();

  // Load available courses for switcher
  await loadAvailableCourses();

  // Load recent chats for this course
  await loadRecentChats();

  // Setup event listeners
  setupEventListeners();

  // Initialize web search toggle
  await initWebSearchToggle();

  // Auto-resize textarea
  setupTextareaResize();
}

async function loadMaterials() {
  try {
    // Load from IndexedDB (single source of truth)
    const materialsDB = new MaterialsDB();
    let materialsData = await materialsDB.loadMaterials(courseId);

    // If no data found, show clear error message
    if (!materialsData) {
      console.error('No materials found for course:', courseId);

      // Check if ANY courses exist in IndexedDB
      const allCourses = await materialsDB.listCourses();
      await materialsDB.close();

      if (allCourses.length > 0) {
        showError(`No materials found for course ${courseId}. You have scanned ${allCourses.length} other course(s). Please go back to the popup and scan this course first.`);
      } else {
        showError('No materials found. Please go back to the popup and scan course materials first.');
      }
      return;
    }

    await materialsDB.close();

    courseName = materialsData.courseName;
    processedMaterials = materialsData.materials || {
      modules: [],
      files: [],
      pages: [],
      assignments: [],
      errors: []
    };

    // Update UI
    elements.courseName.textContent = courseName;
    elements.welcomeCourseName.textContent = courseName;
    document.title = `Study Assistant - ${courseName}`;

    // Display materials in sidebar
    displayMaterials();

    console.log('Materials loaded successfully');
  } catch (error) {
    console.error('Error loading materials:', error);
    showError('Failed to load course materials: ' + error.message);
  }
}

/**
 * Display materials with module-based organization
 */
function displayMaterials() {
  const materialsList = elements.materialsList;

  if (!materialsList) {
    console.error('materials-list element not found!');
    return;
  }

  if (!processedMaterials) {
    console.error('processedMaterials is null or undefined');
    return;
  }

  materialsList.innerHTML = '';

  // Track files shown in modules to avoid duplicates
  const filesShownInModules = new Set();

  // 1. Display Modules (if any) with their files
  if (processedMaterials.modules && processedMaterials.modules.length > 0) {
    const modulesSection = document.createElement('div');
    modulesSection.className = 'materials-section';
    modulesSection.innerHTML = `
      <div class="section-header">
        <span class="section-title">Course Modules</span>
      </div>
    `;

    processedMaterials.modules.forEach((module, moduleIdx) => {
      // Get module items that are Files with original indices
      const moduleFilesWithIndices = [];
      if (module.items) {
        module.items.forEach((item, originalItemIdx) => {
          if (item.type === 'File' && item.url) {
            moduleFilesWithIndices.push({ file: item, originalItemIdx });
          }
        });
      }

      if (moduleFilesWithIndices.length === 0) return; // Skip modules with no files

      // Track these files
      moduleFilesWithIndices.forEach(({ file }) => {
        if (file.content_id) {
          filesShownInModules.add(file.content_id.toString());
        }
      });

      const moduleDiv = document.createElement('div');
      moduleDiv.className = 'material-module';
      moduleDiv.innerHTML = `
        <div class="module-header" data-module-idx="${moduleIdx}">
          <input type="checkbox" class="module-checkbox" id="module-${moduleIdx}" checked>
          <svg class="module-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="module-name">${module.name || `Module ${moduleIdx + 1}`}</span>
          <span class="module-count">${moduleFilesWithIndices.length}</span>
        </div>
        <div class="module-items">
          ${moduleFilesWithIndices.map(({ file, originalItemIdx }) => `
            <div class="material-item" data-module-idx="${moduleIdx}" data-item-idx="${originalItemIdx}">
              <input type="checkbox"
                     class="material-checkbox"
                     id="module-${moduleIdx}-item-${originalItemIdx}"
                     data-module-idx="${moduleIdx}"
                     data-item-idx="${originalItemIdx}"
                     data-file-url="${file.url || ''}"
                     checked>
              <label class="material-label" title="${file.title || file.name}">
                ${file.title || file.name}
              </label>
            </div>
          `).join('')}
        </div>
      `;

      modulesSection.appendChild(moduleDiv);

      // Setup module collapse/expand
      const header = moduleDiv.querySelector('.module-header');
      const itemsDiv = moduleDiv.querySelector('.module-items');
      const moduleCheckbox = moduleDiv.querySelector('.module-checkbox');
      const chevron = moduleDiv.querySelector('.module-chevron');

      header.addEventListener('click', (e) => {
        if (e.target !== moduleCheckbox) {
          itemsDiv.classList.toggle('collapsed');
          moduleDiv.classList.toggle('collapsed');
          chevron.classList.toggle('rotated');
        }
      });

      // Module checkbox selects/deselects all files in module
      moduleCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const checkboxes = itemsDiv.querySelectorAll('.material-checkbox');
        checkboxes.forEach(cb => cb.checked = moduleCheckbox.checked);
      });

      // Update module checkbox when individual items change
      const itemCheckboxes = itemsDiv.querySelectorAll('.material-checkbox');
      itemCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
          const allChecked = Array.from(itemCheckboxes).every(icb => icb.checked);
          const noneChecked = Array.from(itemCheckboxes).every(icb => !icb.checked);
          moduleCheckbox.checked = allChecked;
          moduleCheckbox.indeterminate = !allChecked && !noneChecked;
        });
      });
    });

    materialsList.appendChild(modulesSection);
  }

  // 2. Display standalone Files (not in modules)
  if (processedMaterials.files && processedMaterials.files.length > 0) {
    // Filter out files already shown in modules and keep track of original indices
    const standaloneFilesWithIndices = [];
    processedMaterials.files.forEach((file, originalIndex) => {
      const fileId = file.id?.toString() || file.content_id?.toString();
      const isDuplicate = filesShownInModules.has(fileId);

      if (!isDuplicate) {
        standaloneFilesWithIndices.push({ file, originalIndex });
      }
    });

    if (standaloneFilesWithIndices.length > 0) {
      const filesSection = document.createElement('div');
      filesSection.className = 'materials-section';
      filesSection.innerHTML = `
        <div class="section-header">
          <span class="section-title">Course Files</span>
          <span class="section-count">${standaloneFilesWithIndices.length}</span>
        </div>
      `;

      const filesDiv = document.createElement('div');
      filesDiv.className = 'section-items';
      filesDiv.innerHTML = standaloneFilesWithIndices.map(({ file, originalIndex }) => `
        <div class="material-item" data-category="files" data-index="${originalIndex}">
          <input type="checkbox"
                 class="material-checkbox"
                 id="file-${originalIndex}"
                 data-category="files"
                 data-index="${originalIndex}"
                 data-file-url="${file.url || ''}"
                 checked>
          <label class="material-label" title="${file.display_name || file.name}">
            ${file.display_name || file.name}
          </label>
        </div>
      `).join('');

      filesSection.appendChild(filesDiv);
      materialsList.appendChild(filesSection);
    }
  }

  // 3. Display Pages (HTML content from Canvas)
  if (processedMaterials.pages && processedMaterials.pages.length > 0) {

    const pagesSection = document.createElement('div');
    pagesSection.className = 'materials-section';
    pagesSection.innerHTML = `
      <div class="section-header">
        <span class="section-title">Course Pages</span>
        <span class="section-count">${processedMaterials.pages.length}</span>
      </div>
    `;

    const pagesDiv = document.createElement('div');
    pagesDiv.className = 'section-items';
    pagesDiv.innerHTML = processedMaterials.pages.map((page, pageIdx) => `
      <div class="material-item" data-category="pages" data-index="${pageIdx}">
        <input type="checkbox"
               class="material-checkbox"
               id="page-${pageIdx}"
               data-category="pages"
               data-index="${pageIdx}"
               checked>
        <label class="material-label" title="${page.title}">
          ${page.title}
        </label>
      </div>
    `).join('');

    pagesSection.appendChild(pagesDiv);
    materialsList.appendChild(pagesSection);
  }

  // 4. Display Assignments (descriptions and details)
  if (processedMaterials.assignments && processedMaterials.assignments.length > 0) {

    const assignmentsSection = document.createElement('div');
    assignmentsSection.className = 'materials-section';
    assignmentsSection.innerHTML = `
      <div class="section-header">
        <span class="section-title">Assignments</span>
        <span class="section-count">${processedMaterials.assignments.length}</span>
      </div>
    `;

    const assignmentsDiv = document.createElement('div');
    assignmentsDiv.className = 'section-items';
    assignmentsDiv.innerHTML = processedMaterials.assignments.map((assignment, assignmentIdx) => `
      <div class="material-item" data-category="assignments" data-index="${assignmentIdx}">
        <input type="checkbox"
               class="material-checkbox"
               id="assignment-${assignmentIdx}"
               data-category="assignments"
               data-index="${assignmentIdx}"
               checked>
        <label class="material-label" title="${assignment.name}">
          ${assignment.name}
        </label>
      </div>
    `).join('');

    assignmentsSection.appendChild(assignmentsDiv);
    materialsList.appendChild(assignmentsSection);
  }


  // Setup select all/deselect all buttons
  document.getElementById('select-all-materials')?.addEventListener('click', () => {
    document.querySelectorAll('.material-checkbox, .module-checkbox').forEach(cb => cb.checked = true);
  });

  document.getElementById('deselect-all-materials')?.addEventListener('click', () => {
    document.querySelectorAll('.material-checkbox, .module-checkbox').forEach(cb => cb.checked = false);
  });

  // Setup delete button handlers using event delegation
  materialsList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-material-btn');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();

      const materialItem = deleteBtn.closest('.material-item');
      const category = materialItem.getAttribute('data-category');
      const index = parseInt(materialItem.getAttribute('data-index'));

      if (processedMaterials && processedMaterials[category]) {
        const material = processedMaterials[category][index];
        const materialName = material.name || material.display_name;

        processedMaterials[category].splice(index, 1);

        chrome.storage.local.set({
          [`course_materials_${courseId}`]: processedMaterials
        }, () => {
          console.log(`Deleted material: ${materialName}`);
          displayMaterials();
          showTemporaryMessage(`Removed "${materialName}" from AI memory`);
        });
      }
    }

    // Handle clicking on file name label to open in new tab
    const label = e.target.closest('.material-label');
    if (label && !deleteBtn) {  // Only if not clicking delete button
      e.preventDefault();
      e.stopPropagation();

      const materialItem = label.closest('.material-item');
      const moduleIdx = materialItem.getAttribute('data-module-idx');
      const itemIdx = materialItem.getAttribute('data-item-idx');
      const category = materialItem.getAttribute('data-category');
      const index = materialItem.getAttribute('data-index');

      let fileName = null;
      let fileItem = null;

      // Handle module items
      if (moduleIdx !== null && itemIdx !== null) {
        const module = processedMaterials.modules?.[parseInt(moduleIdx)];
        if (module && module.items) {
          fileItem = module.items[parseInt(itemIdx)];
          if (fileItem) {
            fileName = fileItem.title || fileItem.name;
          }
        }
      }
      // Handle standalone files, pages, assignments
      else if (category && index !== null) {
        fileItem = processedMaterials[category]?.[parseInt(index)];
        if (fileItem) {
          fileName = fileItem.name || fileItem.display_name || fileItem.title;
        }
      }

      // Open file from blob or Canvas URL
      if (fileItem) {
        // Check if this is an assignment or page - ALWAYS open Canvas URL for these
        if (fileItem.type === 'assignment' || fileItem.type === 'page') {
          // Open in Canvas (assignments and pages should never open text blob)
          if (fileItem.html_url) {
            chrome.tabs.create({ url: fileItem.html_url });
          } else {
            showTemporaryMessage(`Cannot open "${fileName}" - Canvas URL not available.`);
          }
        } else if (fileItem.blob) {
          // Open from IndexedDB blob (files, pages, etc.)
          const blobUrl = URL.createObjectURL(fileItem.blob);
          chrome.tabs.create({ url: blobUrl });

          // Clean up blob URL after a delay
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        } else if (fileItem.html_url) {
          // Fallback: open Canvas URL if available
          chrome.tabs.create({ url: fileItem.html_url });
        } else {
          // No blob or URL available
          showTemporaryMessage(`Cannot open "${fileName}" - file data not available. Please re-scan course materials.`);
        }
      } else {
        showTemporaryMessage('File not found in materials list');
      }
    }
  });
}

/**
 * Show a temporary success message
 */
function showTemporaryMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'temp-message';
  messageDiv.textContent = message;
  messageDiv.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    background: var(--success);
    color: white;
    padding: 12px 20px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    font-family: Inter, sans-serif;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(messageDiv);

  setTimeout(() => {
    messageDiv.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => messageDiv.remove(), 300);
  }, 3000);
}


/**
 * Get currently selected materials from checkboxes
 */
function getSelectedMaterials() {
  const selected = {};
  const checkedBoxes = document.querySelectorAll('.material-checkbox:checked');

  checkedBoxes.forEach(checkbox => {
    const category = checkbox.dataset.category;
    const index = parseInt(checkbox.dataset.index);

    if (processedMaterials && processedMaterials[category] && processedMaterials[category][index]) {
      if (!selected[category]) {
        selected[category] = [];
      }
      selected[category].push(processedMaterials[category][index]);
    }
  });

  return selected;
}

/**
 * Convert selected materials to backend document IDs
 * Handles both module-based files and standalone files
 */
function getSelectedDocIds() {
  const docIds = [];
  const checkedBoxes = document.querySelectorAll('.material-checkbox:checked');

  checkedBoxes.forEach((checkbox, idx) => {
    const moduleIdx = checkbox.dataset.moduleIdx;
    const itemIdx = checkbox.dataset.itemIdx;
    const category = checkbox.dataset.category;
    const index = checkbox.dataset.index;

    let materialName = null;

    // Handle module items
    if (moduleIdx !== undefined && itemIdx !== undefined) {
      const module = processedMaterials.modules?.[parseInt(moduleIdx)];
      if (module && module.items) {
        const item = module.items[parseInt(itemIdx)];
        if (item) {
          // Use stored_name if available (has correct extension), otherwise use title
          materialName = item.stored_name || item.title || item.name;
        }
      }
    }
    // Handle standalone files, pages, assignments
    else if (category && index !== undefined) {
      const item = processedMaterials[category]?.[parseInt(index)];
      if (item) {
        // Use stored_name if available (has correct extension), otherwise use name
        materialName = item.stored_name || item.name || item.display_name || item.title;
      }
    }

    if (materialName) {
      // Remove file extension for document ID
      const cleanName = materialName.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');

      // Sanitize: replace forward slashes (GCS doesn't allow them in blob names)
      // Must match backend sanitization in storage_manager.py
      const sanitizedName = cleanName.replace(/\//g, '-');

      const docId = `${courseId}_${sanitizedName}`;
      docIds.push(docId);
      console.log(`📄 Selected: "${materialName}" → ID: "${docId}"`);
    }
  });

  console.log(`📋 Total selected document IDs: ${docIds.length}`, docIds);
  return docIds;
}

/**
 * Get syllabus ID if available
 */
function getSyllabusId() {
  const selected = getSelectedMaterials();

  for (const category in selected) {
    if (Array.isArray(selected[category])) {
      for (const item of selected[category]) {
        const name = (item.name || item.display_name || '').toLowerCase();
        if (name.includes('syllabus')) {
          let materialName = item.name || item.display_name;
          if (materialName.endsWith('.pdf')) {
            materialName = materialName.slice(0, -4);
          }
          return `${courseId}_${materialName}`;
        }
      }
    }
  }

  return null;
}

/**
 * Upload materials to backend
 */
async function uploadMaterialsToBackend() {
  try {
    // Check if materials are loaded
    if (!processedMaterials) {
      console.error('No materials loaded yet, cannot upload to backend');
      return;
    }

    // Collect all files from materials
    const filesToUpload = [];

    // Collect from modules (if course has modules)
    if (processedMaterials.modules && Array.isArray(processedMaterials.modules)) {
      for (const module of processedMaterials.modules) {
        if (module.items && Array.isArray(module.items)) {
          for (const item of module.items) {
            if (item.blob && item.title) {
              filesToUpload.push({
                blob: item.blob,
                name: item.title
              });
            }
          }
        }
      }
    }

    // Collect from standalone files
    if (processedMaterials.files && Array.isArray(processedMaterials.files)) {
      for (const file of processedMaterials.files) {
        if (file.blob && (file.name || file.display_name)) {
          filesToUpload.push({
            blob: file.blob,
            name: file.name || file.display_name
          });
        }
      }
    }

    if (filesToUpload.length === 0) {
      console.warn('No files to upload');
      return;
    }

    // Upload using websocket client
    await backendClient.uploadPDFs(courseId, filesToUpload);
    console.log('Files uploaded successfully');
  } catch (error) {
    console.error('Error uploading materials to backend:', error);
    throw error;
  }
}

/**
 * Initialize connection to Python backend
 */
async function loadAPIKey() {
  try {
    // Initialize Python backend clients
    backendClient = new BackendClient('https://web-production-9aaba7.up.railway.app');
    wsClient = new WebSocketClient('wss://web-production-9aaba7.up.railway.app');

    // Test backend connection
    const isBackendReady = await backendClient.healthCheck();

    if (!isBackendReady) {
      setAPIStatus('error', 'Backend Offline');
      showError('Python backend is not running. Please start the backend server.');
      return;
    }

    // Connect WebSocket
    try {
      await wsClient.connect(courseId);
      setAPIStatus('connected', 'Backend Connected');
      elements.sendBtn.disabled = false;
      console.log('Connected to backend');
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      setAPIStatus('error', 'Backend Connection Failed');
      showError('Failed to connect to backend: ' + error.message);
    }
  } catch (error) {
    console.error('Error connecting to backend:', error);
    setAPIStatus('error', 'Backend Error');
    showError('Failed to initialize backend connection: ' + error.message);
  }
}

function setAPIStatus(status, text) {
  elements.apiStatusIndicator.className = `status-indicator ${status}`;
  elements.apiStatusText.textContent = text;
}

function setupEventListeners() {
  // Send message
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Starter questions
  document.querySelectorAll('.starter-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const question = btn.textContent;
      elements.messageInput.value = question;
      sendMessage();
    });
  });

  // Suggested prompts
  document.querySelectorAll('.suggested-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt') || btn.textContent;
      elements.messageInput.value = prompt;
      elements.messageInput.focus();
      // Auto-send the message
      sendMessage();
    });
  });

  // New chat
  elements.newChatBtn.addEventListener('click', () => {
    // Generate new session ID
    currentSessionId = `session_${courseId}_${Date.now()}`;
    conversationHistory = [];
    elements.messagesContainer.innerHTML = '';
    elements.messagesContainer.appendChild(createWelcomeMessage());
    // Refresh recent chats
    loadRecentChats();
  });

  // Settings
  elements.settingsBtn.addEventListener('click', showSettingsModal);
  elements.closeSettings.addEventListener('click', hideSettingsModal);

  // Save settings
  document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
    const webSearchToggle = document.getElementById('web-search-toggle');
    await chrome.storage.local.set({
      enable_web_search: webSearchToggle.checked
    });
    hideSettingsModal();
  });

  // Export chat
  elements.exportChatBtn.addEventListener('click', exportChat);

  // Clear chat
  elements.clearChatBtn.addEventListener('click', () => {
    conversationHistory = [];
    elements.messagesContainer.innerHTML = '';
    elements.messagesContainer.appendChild(createWelcomeMessage());
  });

  // Recent chats panel toggle
  const panelToggleBtn = document.getElementById('panel-toggle-btn');
  const recentChatsPanel = document.getElementById('recent-chats-panel');

  if (panelToggleBtn && recentChatsPanel) {
    panelToggleBtn.addEventListener('click', () => {
      recentChatsPanel.classList.toggle('collapsed');
    });
  }

  // Course switcher dropdown toggle
  const courseSwitcherBtn = document.getElementById('course-switcher-sidebar-btn');
  const courseDropdown = document.getElementById('course-dropdown-sidebar');

  if (courseSwitcherBtn && courseDropdown) {
    courseSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      courseDropdown.classList.toggle('hidden');
      courseSwitcherBtn.classList.toggle('active');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.course-switcher-sidebar')) {
        courseDropdown.classList.add('hidden');
        courseSwitcherBtn.classList.remove('active');
      }
    });
  }

  // Enable send button when input has text
  elements.messageInput.addEventListener('input', () => {
    elements.sendBtn.disabled = !elements.messageInput.value.trim();
  });

  // Citation links - use event delegation on messages container
  elements.messagesContainer.addEventListener('click', (e) => {
    const citationLink = e.target.closest('.citation-link');
    if (citationLink) {
      e.preventDefault();
      const docName = citationLink.dataset.docName;
      const page = citationLink.dataset.page;
      if (docName && page) {
        openCitedDocument(docName, parseInt(page));
      }
    }
  });

  // Sidebar resize
  setupSidebarResize();
}

function setupTextareaResize() {
  elements.messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  });
}

function setupSidebarResize() {
  const sidebar = document.querySelector('.sidebar');
  const resizeHandle = document.getElementById('sidebar-resize-handle');

  if (!sidebar || !resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    sidebar.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const newWidth = startWidth + deltaX;

    // Constrain between min and max width
    const minWidth = 200;
    const maxWidth = 600;
    const constrainedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

    sidebar.style.width = `${constrainedWidth}px`;

    // Update CSS variable for consistency
    document.documentElement.style.setProperty('--sidebar-width', `${constrainedWidth}px`);
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      sidebar.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Save the new width to localStorage
      const newWidth = sidebar.offsetWidth;
      localStorage.setItem('sidebar-width', newWidth);
    }
  });

  // Load saved width on init
  const savedWidth = localStorage.getItem('sidebar-width');
  if (savedWidth) {
    sidebar.style.width = `${savedWidth}px`;
    document.documentElement.style.setProperty('--sidebar-width', `${savedWidth}px`);
  }
}

/**
 * Show loading banner with message
 */
function showLoadingBanner(message) {
  if (elements.loadingBanner && elements.loadingBannerText) {
    elements.loadingBannerText.textContent = message;
    elements.loadingBanner.classList.remove('hidden');
  }
}

/**
 * Hide loading banner
 */
function hideLoadingBanner() {
  if (elements.loadingBanner) {
    elements.loadingBanner.classList.add('hidden');
  }
}

/**
 * Send a message to the AI assistant via Python backend
 */
async function sendMessage() {
  const message = elements.messageInput.value.trim();

  if (!message) return;
  if (!wsClient || !wsClient.isReady()) {
    showError('Not connected to backend. Please check that the server is running.');
    return;
  }

  // Clear input
  elements.messageInput.value = '';
  elements.messageInput.style.height = 'auto';
  elements.sendBtn.disabled = true;

  // Add user message
  addMessage('user', message);

  // Add typing indicator
  const typingId = addTypingIndicator();

  try {
    let assistantMessage = '';
    let hasReceivedChunks = false;

    // Get selected documents from checkboxes
    const selectedDocIds = getSelectedDocIds();
    const syllabusId = getSyllabusId();

    console.log(`🚀 Sending query to backend:`);
    console.log(`   Selected docs: ${selectedDocIds.length}`, selectedDocIds);
    console.log(`   Syllabus ID: ${syllabusId || 'none'}`);

    // Load user settings
    const settings = await chrome.storage.local.get(['gemini_api_key', 'enable_web_search']);
    const apiKey = settings.gemini_api_key || null;
    const enableWebSearch = settings.enable_web_search || false;

    // Check if smart file selection is enabled
    const smartFileSelectionToggle = document.getElementById('smart-file-selection-toggle');
    const useSmartSelection = smartFileSelectionToggle ? smartFileSelectionToggle.checked : false;

    console.log(`   Web search: ${enableWebSearch ? 'enabled' : 'disabled'}`);
    console.log(`   Smart Selection: ${useSmartSelection ? 'enabled' : 'disabled'}`);
    console.log(`   API key: ${apiKey ? 'user-provided' : 'default'}`);

    await wsClient.sendQuery(
      message,
      conversationHistory,
      selectedDocIds,
      syllabusId,
      currentSessionId,  // Session ID for chat history
      apiKey,  // User's Gemini API key
      enableWebSearch,  // Web search toggle
      useSmartSelection,  // Smart file selection toggle
      // onChunk callback for streaming text
      (chunk) => {
        // Check if this is a loading message (starts with 📤)
        if (chunk.startsWith('📤')) {
          showLoadingBanner(chunk);
          return; // Don't add to assistant message
        }

        // First actual content chunk received
        if (!hasReceivedChunks) {
          hasReceivedChunks = true;
          hideLoadingBanner();
        }

        assistantMessage += chunk;
        updateTypingIndicator(typingId, assistantMessage);
      },
      // onComplete callback
      () => {
        hideLoadingBanner();
      },
      // onError callback
      (error) => {
        console.error('Backend error:', error);
        hideLoadingBanner();
        throw error;
      }
    );

    // Remove typing indicator and add final message
    removeTypingIndicator(typingId);
    hideLoadingBanner();
    addMessage('assistant', assistantMessage);

    // Add to conversation history
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: assistantMessage });

    // Save conversation
    await saveConversation();

    // Show usage info
    elements.tokenInfo.textContent = `Mode: Python Backend`;

  } catch (error) {
    console.error('Error sending message:', error);
    removeTypingIndicator(typingId);
    addMessage('assistant', `Sorry, I encountered an error: ${error.message}`);
  } finally {
    elements.sendBtn.disabled = false;
  }
}

/**
 * Parse citations in AI response and convert to clickable links
 * Format: [Source: DocumentName, Page X]
 */
function parseCitations(content) {
  // Regex to match: [Source: DocumentName, Page X]
  const citationRegex = /\[Source:\s*([^,]+),\s*Page\s*(\d+)\]/gi;

  return content.replace(citationRegex, (match, docName, pageNum) => {
    // Clean up document name (trim whitespace)
    const cleanDocName = docName.trim();

    // Create citation link that will open the local file
    return `<a href="#" class="citation-link" data-doc-name="${cleanDocName}" data-page="${pageNum}" title="Open ${cleanDocName} at page ${pageNum}">📄 ${cleanDocName}, p.${pageNum}</a>`;
  });
}

/**
 * Normalize filename for flexible matching
 * Removes date prefixes, handles underscores/dashes, case-insensitive
 */
function normalizeFilename(name) {
  if (!name) return '';
  return name
    .replace(/^[A-Z]{3}_?\d+_/i, '')  // Remove date prefixes like "AUG_28_", "SEP_2_"
    .replace(/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i, '') // Remove extension
    .replace(/[_-]/g, ' ')  // Replace underscores and dashes with spaces
    .toLowerCase()
    .trim();
}

/**
 * Open a cited document from local storage
 */
async function openCitedDocument(docName, pageNum) {
  try {
    const normalizedDocName = normalizeFilename(docName);

    // Find the file in processedMaterials
    let fileItem = null;

    // Check modules
    if (processedMaterials.modules) {
      for (const module of processedMaterials.modules) {
        if (module.items) {
          for (const item of module.items) {
            if (item.type === 'File' && item.title) {
              const normalizedTitle = normalizeFilename(item.title);

              // Try exact match first, then partial match
              if (normalizedTitle === normalizedDocName || normalizedTitle.includes(normalizedDocName) || normalizedDocName.includes(normalizedTitle)) {
                fileItem = item;
                break;
              }
            }
          }
        }
        if (fileItem) break;
      }
    }

    // Check standalone files
    if (!fileItem && processedMaterials.files) {
      for (const file of processedMaterials.files) {
        const fileName = file.name || file.display_name || '';
        if (fileName) {
          const normalizedFileName = normalizeFilename(fileName);

          // Try exact match first, then partial match
          if (normalizedFileName === normalizedDocName || normalizedFileName.includes(normalizedDocName) || normalizedDocName.includes(normalizedFileName)) {
            fileItem = file;
            break;
          }
        }
      }
    }

    if (!fileItem) {
      showError(`File not found: ${docName}`);
      return;
    }

    // Get the blob
    const blob = fileItem.blob;
    if (!blob) {
      showError(`File data not available: ${docName}`);
      return;
    }

    // Create object URL from blob
    const blobUrl = URL.createObjectURL(blob);

    // Open in new tab with page anchor (works for PDFs)
    const finalUrl = `${blobUrl}#page=${pageNum}`;
    window.open(finalUrl, '_blank');
  } catch (error) {
    console.error('Error opening cited document:', error);
    showError(`Error opening document: ${error.message}`);
  }
}

function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}-message`;

  const avatar = role === 'assistant' ? '🤖' : '👤';
  const roleName = role === 'assistant' ? 'AI Assistant' : 'You';

  // For assistant messages: parse citations first, then render markdown
  let processedContent = content;
  if (role === 'assistant') {
    processedContent = parseCitations(content);
  }

  // Render markdown
  const renderedContent = role === 'assistant' ? marked.parse(processedContent) : content;

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-role">${roleName}</span>
        <span class="message-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-text">${renderedContent}</div>
      ${role === 'assistant' ? `
        <div class="message-actions">
          <button class="copy-message-btn" data-content="${content.replace(/"/g, '&quot;')}">📋 Copy</button>
        </div>
      ` : ''}
    </div>
  `;

  elements.messagesContainer.appendChild(messageDiv);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;

  // Add copy functionality
  if (role === 'assistant') {
    const copyBtn = messageDiv.querySelector('.copy-message-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content);
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy';
      }, 2000);
    });
  }
}

function addTypingIndicator() {
  const id = `typing-${Date.now()}`;
  const messageDiv = document.createElement('div');
  messageDiv.id = id;
  messageDiv.className = 'message assistant-message';
  messageDiv.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-role">AI Assistant</span>
      </div>
      <div class="message-text">
        <div class="typing-status">
          <span class="typing-text">Thinking</span>
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  elements.messagesContainer.appendChild(messageDiv);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;

  return id;
}

function updateTypingIndicator(id, content) {
  const messageDiv = document.getElementById(id);
  if (messageDiv) {
    const textDiv = messageDiv.querySelector('.message-text');
    // Parse citations in streaming content too
    const processedContent = parseCitations(content);
    textDiv.innerHTML = marked.parse(processedContent);
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }
}

function removeTypingIndicator(id) {
  const messageDiv = document.getElementById(id);
  if (messageDiv) {
    messageDiv.remove();
  }
}

function createWelcomeMessage() {
  const welcomeDiv = document.createElement('div');
  welcomeDiv.className = 'message assistant-message welcome-message';
  welcomeDiv.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-role">AI Assistant</span>
      </div>
      <div class="message-text">
        <h3>Hi! I'm your AI study assistant for ${courseName}.</h3>
        <p>I have access to all your course materials. Ask me anything!</p>
      </div>
    </div>
  `;

  // Add click handlers to starter questions
  welcomeDiv.querySelectorAll('.starter-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const question = btn.textContent.replace(/"/g, '');
      elements.messageInput.value = question;
      sendMessage();
    });
  });

  return welcomeDiv;
}

async function saveConversation() {
  try {
    const key = `chat_history_${courseId}`;
    await new Promise((resolve) => {
      chrome.storage.local.set({
        [key]: {
          courseId,
          courseName,
          history: conversationHistory,
          lastUpdated: Date.now()
        }
      }, resolve);
    });

    // Also refresh recent chats panel after saving
    await loadRecentChats();
  } catch (error) {
    console.error('Error saving conversation:', error);
  }
}

// ========== RECENT CHATS PANEL ==========

/**
 * Load recent chats from backend and display in panel
 */
async function loadRecentChats() {
  try {
    if (!backendClient) return;

    const response = await backendClient.getRecentChats(courseId, 20);

    if (!response.success) {
      console.error('Failed to load recent chats:', response.error);
      return;
    }

    const chats = response.chats || [];
    const chatsList = document.getElementById('recent-chats-list');

    if (chats.length === 0) {
      chatsList.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <p>No recent chats yet</p>
          <span>Start a conversation to see your chat history</span>
        </div>
      `;
      return;
    }

    // Render chats
    chatsList.innerHTML = chats.map(chat => {
      const date = new Date(chat.updated_at);
      const timeAgo = getTimeAgo(date);
      const isActive = chat.session_id === currentSessionId;

      return `
        <div class="chat-item ${isActive ? 'active' : ''}" data-session-id="${chat.session_id}">
          <div class="chat-item-content">
            <div class="chat-item-title">${escapeHtml(chat.title || 'Untitled Chat')}</div>
            <div class="chat-item-meta">
              <span class="chat-item-time">${timeAgo}</span>
              <span class="chat-item-count">${chat.message_count} messages</span>
            </div>
          </div>
          <div class="chat-item-actions">
            <button class="chat-action-btn delete-chat-btn" title="Delete chat" data-session-id="${chat.session_id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers to chat items
    chatsList.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking delete button
        if (e.target.closest('.delete-chat-btn')) return;

        const sessionId = item.dataset.sessionId;
        loadChatSession(sessionId);
      });
    });

    // Add delete handlers
    chatsList.querySelectorAll('.delete-chat-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sessionId = btn.dataset.sessionId;
        await deleteChatSession(sessionId);
      });
    });

  } catch (error) {
    console.error('Error loading recent chats:', error);
  }
}

/**
 * Load a specific chat session
 */
async function loadChatSession(sessionId) {
  try {
    const response = await backendClient.getChatSession(courseId, sessionId);

    if (!response.success) {
      showError('Failed to load chat session: ' + response.error);
      return;
    }

    const session = response.session;

    // Update current session
    currentSessionId = sessionId;

    // Clear current chat and load history
    elements.messagesContainer.innerHTML = '';

    // Load conversation history
    conversationHistory = session.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Display messages
    conversationHistory.forEach(msg => {
      addMessage(msg.role, msg.content);
    });

    // Refresh recent chats to update active state
    await loadRecentChats();
  } catch (error) {
    console.error('Error loading chat session:', error);
    showError('Failed to load chat: ' + error.message);
  }
}

/**
 * Delete a chat session
 */
async function deleteChatSession(sessionId) {
  try {
    const response = await backendClient.deleteChatSession(courseId, sessionId);

    if (!response.success) {
      showError('Failed to delete chat: ' + response.error);
      return;
    }

    // If deleting current session, start a new one
    if (sessionId === currentSessionId) {
      currentSessionId = `session_${courseId}_${Date.now()}`;
      conversationHistory = [];
      elements.messagesContainer.innerHTML = '';
      elements.messagesContainer.appendChild(createWelcomeMessage());
    }

    // Refresh recent chats list
    await loadRecentChats();
  } catch (error) {
    console.error('Error deleting chat session:', error);
    showError('Failed to delete chat: ' + error.message);
  }
}

// ========== COURSE SWITCHER ==========

/**
 * Load available courses from IndexedDB
 */
async function loadAvailableCourses() {
  try {
    const materialsDB = new MaterialsDB();
    await materialsDB.open();

    // Get all course IDs from IndexedDB
    const courseIds = await materialsDB.listCourses();

    availableCourses = [];

    // Load each course's metadata
    for (const courseId of courseIds) {
      try {
        const courseData = await materialsDB.loadMaterials(courseId);
        if (courseData && courseData.courseId && courseData.courseName) {
          availableCourses.push({
            id: courseData.courseId,
            name: courseData.courseName
          });
        }
      } catch (error) {
        console.warn(`Failed to load course ${courseId}:`, error);
      }
    }

    await materialsDB.close();

    // Populate course switcher dropdown
    populateCourseSwitcher();

  } catch (error) {
    console.error('Error loading available courses:', error);
  }
}

/**
 * Populate the course switcher dropdown
 */
function populateCourseSwitcher() {
  const courseList = document.getElementById('course-list-sidebar');

  if (!courseList) return;

  if (availableCourses.length === 0) {
    courseList.innerHTML = '<div class="loading-courses">No courses available</div>';
    return;
  }

  courseList.innerHTML = availableCourses.map(course => {
    const isActive = course.id === courseId;
    return `
      <div class="course-item ${isActive ? 'active' : ''}" data-course-id="${course.id}">
        <div class="course-item-icon">📚</div>
        <div class="course-item-name">${escapeHtml(course.name)}</div>
        ${isActive ? '<div class="course-item-badge">Current</div>' : ''}
      </div>
    `;
  }).join('');

  // Add click handlers
  courseList.querySelectorAll('.course-item').forEach(item => {
    item.addEventListener('click', () => {
      const newCourseId = item.dataset.courseId;
      if (newCourseId !== courseId) {
        switchCourse(newCourseId);
      }
    });
  });
}

/**
 * Switch to a different course
 */
async function switchCourse(newCourseId) {
  try {
    // Reload page with new course ID
    window.location.href = `chat.html?courseId=${newCourseId}`;
  } catch (error) {
    console.error('Error switching course:', error);
    showError('Failed to switch course: ' + error.message);
  }
}

// ========== HELPER FUNCTIONS ==========

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function showSettingsModal() {
  elements.settingsModal.classList.remove('hidden');

  // Load current settings
  const settings = await chrome.storage.local.get(['enable_web_search']);
  const webSearchToggle = document.getElementById('web-search-toggle');
  if (webSearchToggle) {
    webSearchToggle.checked = settings.enable_web_search || false;
  }
}

function hideSettingsModal() {
  elements.settingsModal.classList.add('hidden');
}


function showStatusMessage(element, message, type) {
  element.textContent = message;
  element.className = `status-message show ${type}`;

  setTimeout(() => {
    element.classList.remove('show');
  }, 3000);
}

function exportChat() {
  const chatText = conversationHistory.map(msg => {
    const role = msg.role === 'user' ? 'You' : 'AI Assistant';
    return `${role}:\n${msg.content}\n\n`;
  }).join('---\n\n');

  const blob = new Blob([`Chat History - ${courseName}\n\n${chatText}`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: `${courseName.replace(/[^a-z0-9]/gi, '_')}_chat_history.txt`,
    saveAs: true
  }, () => {
    URL.revokeObjectURL(url);
  });
}

function showError(message) {
  elements.messagesContainer.innerHTML = `
    <div class="message assistant-message">
      <div class="message-avatar">⚠️</div>
      <div class="message-content">
        <div class="message-text">
          <h3>Error</h3>
          <p>${message}</p>
        </div>
      </div>
    </div>
  `;
}

// ========== AGENTIC UI FUNCTIONS ==========

/**
 * Add a thinking/planning step indicator
 */
function addThinkingStep(message) {
  const stepDiv = document.createElement('div');
  stepDiv.className = 'agent-step thinking-step';
  stepDiv.innerHTML = `
    <div class="step-icon">🤔</div>
    <div class="step-content">
      <div class="step-message">${message}</div>
    </div>
  `;

  elements.messagesContainer.appendChild(stepDiv);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;

  return stepDiv.id = `step-${Date.now()}`;
}

/**
 * Add an agent step (tool execution)
 */
function addAgentStep(toolName, message) {
  const stepId = `step-${Date.now()}`;
  const stepDiv = document.createElement('div');
  stepDiv.id = stepId;
  stepDiv.className = 'agent-step tool-step';
  stepDiv.innerHTML = `
    <div class="step-icon">🔧</div>
    <div class="step-content">
      <div class="step-title">${toolName}</div>
      <div class="step-message">${message}</div>
      <div class="step-result hidden"></div>
    </div>
  `;

  elements.messagesContainer.appendChild(stepDiv);
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;

  return stepId;
}

/**
 * Update an agent step with results
 */
function updateAgentStep(stepId, message, result) {
  const stepDiv = document.getElementById(stepId);
  if (!stepDiv) return;

  const messageEl = stepDiv.querySelector('.step-message');
  const resultEl = stepDiv.querySelector('.step-result');

  if (messageEl) {
    messageEl.textContent = message;
  }

  if (resultEl && result) {
    resultEl.classList.remove('hidden');

    // Format result based on type
    let resultHTML = '';
    if (result.results_count !== undefined) {
      resultHTML = `<strong>Found ${result.results_count} results</strong>`;
    } else if (result.relevant_materials_count !== undefined) {
      resultHTML = `<strong>Found ${result.relevant_materials_count} relevant materials</strong>`;
    } else if (result.total_materials !== undefined) {
      resultHTML = `<strong>Total: ${result.total_materials} materials</strong>`;
    } else {
      resultHTML = '<strong>✓ Completed</strong>';
    }

    resultEl.innerHTML = resultHTML;
  }

  // Add checkmark to step icon
  stepDiv.classList.add('completed');
  const icon = stepDiv.querySelector('.step-icon');
  if (icon) {
    icon.textContent = '✅';
  }
}

function clearMaterials() {
  localStorage.removeItem('canvasMaterials');
  localStorage.removeItem('canvasCourseName');
  location.reload();
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

/**
 * Initialize web search toggle
 */
async function initWebSearchToggle() {
  const inlineToggle = document.getElementById('web-search-toggle-inline');
  const settingsToggle = document.getElementById('web-search-toggle');

  if (!inlineToggle) return;

  // Load saved state
  const settings = await chrome.storage.local.get(['enable_web_search']);
  const isEnabled = settings.enable_web_search || false;

  // Set initial state
  inlineToggle.checked = isEnabled;
  if (settingsToggle) {
    settingsToggle.checked = isEnabled;
  }

  // Listen for changes on inline toggle
  inlineToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({
      enable_web_search: inlineToggle.checked
    });

    // Sync with settings modal toggle
    if (settingsToggle) {
      settingsToggle.checked = inlineToggle.checked;
    }
  });

  // Listen for changes on settings modal toggle (to keep them in sync)
  if (settingsToggle) {
    settingsToggle.addEventListener('change', () => {
      inlineToggle.checked = settingsToggle.checked;
    });
  }
}

/**
 * Check if user has API key, show modal if not
 */
async function checkAndPromptForApiKey() {
  const result = await chrome.storage.local.get(['gemini_api_key']);
  const apiKey = result.gemini_api_key;

  if (apiKey && apiKey.trim()) {
    return true;
  }

  // No API key found - show modal
  showApiKeyModal();
  return false;
}

/**
 * Show API key setup modal
 */
function showApiKeyModal() {
  const modal = document.getElementById('apiKeyModal');
  const input = document.getElementById('apiKeyModalInput');
  const saveBtn = document.getElementById('saveApiKeyModalBtn');
  const settingsBtn = document.getElementById('openSettingsModalBtn');
  const status = document.getElementById('apiKeyModalStatus');

  if (!modal) {
    console.error('API key modal not found in DOM');
    return;
  }

  modal.classList.remove('hidden');
  input.focus();

  // Save button click
  saveBtn.onclick = async () => {
    const apiKey = input.value.trim();

    if (!apiKey) {
      showModalStatus('Please enter your Google Gemini API key', 'error');
      return;
    }

    if (!apiKey.startsWith('AIza')) {
      showModalStatus('Invalid API key format. Google Gemini keys start with "AIza"', 'error');
      return;
    }

    if (apiKey.length < 39) {
      showModalStatus('API key seems too short. Please check the complete key.', 'error');
      return;
    }

    try {
      showModalStatus('Validating API key with Google...', 'info');

      // Test the API key
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);

      if (response.status === 200) {
        // Save the API key
        await chrome.storage.local.set({ gemini_api_key: apiKey });
        showModalStatus('✅ API key saved successfully!', 'success');

        // Close modal and reload page after short delay
        setTimeout(() => {
          modal.classList.add('hidden');
          window.location.reload();
        }, 1500);
      } else if (response.status === 400 || response.status === 403) {
        showModalStatus('Invalid API key. Please check and try again.', 'error');
      } else {
        // Save anyway for other errors (might be network issues)
        await chrome.storage.local.set({ gemini_api_key: apiKey });
        showModalStatus('API key saved (could not validate - will try during use)', 'success');

        setTimeout(() => {
          modal.classList.add('hidden');
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error('Error validating API key:', error);
      // Save anyway if network error
      await chrome.storage.local.set({ gemini_api_key: apiKey });
      showModalStatus('API key saved (validation failed - will try during use)', 'success');

      setTimeout(() => {
        modal.classList.add('hidden');
        window.location.reload();
      }, 1500);
    }
  };

  // Settings button - open full settings page
  settingsBtn.onclick = () => {
    window.open(chrome.runtime.getURL('popup/settings.html'), '_blank');
  };

  // Enter key to save
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });
}

/**
 * Show status message in modal
 */
function showModalStatus(message, type) {
  const status = document.getElementById('apiKeyModalStatus');
  if (!status) return;

  status.textContent = message;
  status.className = `modal-status ${type}`;
  status.classList.remove('hidden');
}