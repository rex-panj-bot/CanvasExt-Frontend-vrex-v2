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
let isGenerating = false; // Track if AI is currently generating
let currentStreamAbort = null; // AbortController for current generation

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
  showLoadingBanner('Uploading course materials...');

  // Track if we ever found a task
  let taskFound = false;

  // Poll chrome.storage.local for upload/download task updates
  const pollInterval = setInterval(() => {
    chrome.storage.local.get(['uploadTask', 'downloadTask'], async (result) => {
      // Check for upload task first (new approach), then fall back to download task (legacy)
      const task = result.uploadTask || result.downloadTask;
      const taskType = result.uploadTask ? 'upload' : 'download';

      if (!task) {
        console.log('⚠️ [CHAT] No upload/download task found in storage');

        // If we never found a task after a few seconds, hide the banner
        if (!taskFound) {
          setTimeout(() => {
            if (!taskFound) {
              console.log('⏱️ [CHAT] No task found, hiding banner');
              hideLoadingBanner();
              clearInterval(pollInterval);
            }
          }, 2000);
        }
        return;
      }

      taskFound = true;

      // Check if this task is for our course
      if (task.courseId !== courseId) {
        console.log(`📥 [CHAT] Ignoring ${taskType} task for different course:`, task.courseId, 'vs', courseId);
        return;
      }

      console.log(`📥 [CHAT] ${taskType} task status:`, task.status);

      if (task.status === 'uploading') {
        // Show upload progress with individual file count
        const percent = task.totalFiles > 0
          ? Math.round((task.uploadedFiles / task.totalFiles) * 100)
          : 0;
        showLoadingBanner(`Uploading ${task.uploadedFiles}/${task.totalFiles} files (${percent}%)`);

      } else if (task.status === 'downloading') {
        // Show download progress (legacy)
        const progress = task.progress;
        if (progress) {
          const percent = progress.filesTotal > 0
            ? Math.round((progress.filesCompleted / progress.filesTotal) * 100)
            : 0;
          showLoadingBanner(`${progress.message} (${percent}%)`);
        }

      } else if (task.status === 'complete') {
        console.log(`✅ [CHAT] ${taskType} complete!`);
        clearInterval(pollInterval); // Stop polling
        showLoadingBanner('All files uploaded! Ready to chat.', 'success');

        // Clear the task from storage
        const taskKey = taskType === 'upload' ? 'uploadTask' : 'downloadTask';
        chrome.storage.local.remove([taskKey], () => {
          console.log(`🧹 [CHAT] Cleared ${taskType} task from storage`);
        });

        // Hide banner after 2 seconds
        setTimeout(() => hideLoadingBanner(), 2000);

      } else if (task.status === 'error') {
        console.error(`❌ [CHAT] ${taskType} error:`, task.error);
        clearInterval(pollInterval); // Stop polling
        showLoadingBanner(`Error: ${task.error || 'Unknown error'}`, 'error');
        setTimeout(() => hideLoadingBanner(), 5000);
      }
    });
  }, 1000); // Poll every 1 second

  // Stop polling after 10 minutes (safety timeout)
  setTimeout(() => {
    clearInterval(pollInterval);
    console.log('⏱️ [CHAT] Background loading poll timeout');
  }, 10 * 60 * 1000);
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

  // Setup background loading listener (only if we're in loading mode)
  if (isLoading) {
    setupBackgroundLoadingListener();
  } else {
    // Not in loading mode, just load materials normally
    console.log('📂 [CHAT] Loading materials from IndexedDB (no background download)');
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

  // Check if settings should be opened (from URL parameter or message)
  const openSettings = urlParams.get('openSettings');
  if (openSettings === 'true') {
    showSettingsModal();
  }

  // Listen for messages to open settings
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openSettings') {
      showSettingsModal();
    }
  });
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

    // Ensure courseName is a string (defensive check)
    courseName = typeof materialsData.courseName === 'string'
      ? materialsData.courseName
      : 'Unknown Course';

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

    // Load syllabus selector
    await loadSyllabusSelector();

    console.log('Materials loaded successfully');
  } catch (error) {
    console.error('Error loading materials:', error);
    showError('Failed to load course materials: ' + error.message);
  }
}

/**
 * Show first-time user hint about file selection
 */
async function showFirstTimeHint() {
  try {
    const { hasSeenFileSelectionHint } = await chrome.storage.local.get(['hasSeenFileSelectionHint']);

    if (!hasSeenFileSelectionHint) {
      const hint = document.createElement('div');
      hint.className = 'first-time-hint';
      hint.innerHTML = `
        <div class="hint-content">
          <strong>💡 Tip:</strong> Click files to select for AI context. Use the open button (↗) to view files.
          <button class="hint-close">Got it!</button>
        </div>
      `;

      const materialsList = document.querySelector('.materials-list');
      if (materialsList) {
        materialsList.insertAdjacentElement('beforebegin', hint);

        // Close button
        const closeBtn = hint.querySelector('.hint-close');
        closeBtn.addEventListener('click', async () => {
          hint.style.animation = 'slideOut 0.3s ease-out';
          setTimeout(() => hint.remove(), 300);
          await chrome.storage.local.set({ hasSeenFileSelectionHint: true });
        });

        // Auto-hide after 10 seconds
        setTimeout(async () => {
          if (hint.parentElement) {
            hint.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => hint.remove(), 300);
            await chrome.storage.local.set({ hasSeenFileSelectionHint: true });
          }
        }, 10000);
      }
    }
  } catch (error) {
    console.error('Error showing first-time hint:', error);
  }
}

/**
 * Display materials with module-based organization
 */
function displayMaterials() {
  // Always get fresh reference from DOM to avoid stale references after cloning
  const materialsList = document.querySelector('.materials-list');

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
      moduleDiv.className = 'material-module collapsed'; // Start collapsed
      moduleDiv.innerHTML = `
        <div class="module-header" data-module-idx="${moduleIdx}">
          <input type="checkbox" class="module-checkbox" id="module-${moduleIdx}">
          <svg class="module-chevron rotated" width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="module-name">${module.name || `Module ${moduleIdx + 1}`}</span>
          <span class="module-count">${moduleFilesWithIndices.length}</span>
        </div>
        <div class="module-items collapsed">
          ${moduleFilesWithIndices.map(({ file, originalItemIdx }) => `
            <div class="material-item" data-module-idx="${moduleIdx}" data-item-idx="${originalItemIdx}" data-selected="false">
              <label class="material-label" title="${file.title || file.name}">
                ${file.title || file.name}
              </label>
              <button class="open-material-btn" title="Open file" data-module-idx="${moduleIdx}" data-item-idx="${originalItemIdx}">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M11 2H13C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2H5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M10 7L13 4M13 4V7M13 4H10" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="delete-material-btn" title="Remove from AI memory" data-module-idx="${moduleIdx}" data-item-idx="${originalItemIdx}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          `).join('')}
        </div>
      `;

      modulesSection.appendChild(moduleDiv);
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
        <div class="material-item" data-category="files" data-index="${originalIndex}" data-selected="false">
          <label class="material-label" title="${file.display_name || file.name}">
            ${file.display_name || file.name}
          </label>
          <button class="open-material-btn" title="Open file" data-category="files" data-index="${originalIndex}">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M11 2H13C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2H5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 7L13 4M13 4V7M13 4H10" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="delete-material-btn" title="Remove from AI memory" data-category="files" data-index="${originalIndex}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
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
      <div class="material-item" data-category="pages" data-index="${pageIdx}" data-selected="false">
        <label class="material-label" title="${page.title}">
          ${page.title}
        </label>
        <button class="open-material-btn" title="Open page" data-category="pages" data-index="${pageIdx}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M11 2H13C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2H5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 7L13 4M13 4V7M13 4H10" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="delete-material-btn" title="Remove from AI memory" data-category="pages" data-index="${pageIdx}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
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
      <div class="material-item" data-category="assignments" data-index="${assignmentIdx}" data-selected="false">
        <label class="material-label" title="${assignment.name}">
          ${assignment.name}
        </label>
        <button class="open-material-btn" title="Open assignment" data-category="assignments" data-index="${assignmentIdx}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M11 2H13C13.5523 2 14 2.44772 14 3V13C14 13.5523 13.5523 14 13 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2H5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 7L13 4M13 4V7M13 4H10" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="delete-material-btn" title="Remove from AI memory" data-category="assignments" data-index="${assignmentIdx}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `).join('');

    assignmentsSection.appendChild(assignmentsDiv);
    materialsList.appendChild(assignmentsSection);
  }


  // Show first-time user hint
  showFirstTimeHint();

  // Setup select all/deselect all buttons (remove old listeners first)
  const selectAllBtn = document.getElementById('select-all-materials');
  const deselectAllBtn = document.getElementById('deselect-all-materials');

  if (selectAllBtn) {
    selectAllBtn.replaceWith(selectAllBtn.cloneNode(true));
    document.getElementById('select-all-materials').addEventListener('click', () => {
      document.querySelectorAll('.material-item').forEach(item => item.setAttribute('data-selected', 'true'));
    });
  }

  if (deselectAllBtn) {
    deselectAllBtn.replaceWith(deselectAllBtn.cloneNode(true));
    document.getElementById('deselect-all-materials').addEventListener('click', () => {
      document.querySelectorAll('.material-item').forEach(item => item.setAttribute('data-selected', 'false'));
    });
  }

  // Setup delete button handlers using event delegation
  // Remove old listener by cloning the element
  // Get fresh reference from DOM to avoid stale references
  const currentMaterialsList = document.querySelector('.materials-list');
  const newMaterialsList = currentMaterialsList.cloneNode(true);
  currentMaterialsList.parentNode.replaceChild(newMaterialsList, currentMaterialsList);

  // Now add the listener to the fresh element
  document.querySelector('.materials-list').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-material-btn');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();

      const materialItem = deleteBtn.closest('.material-item');
      const category = materialItem.getAttribute('data-category');
      const index = materialItem.getAttribute('data-index');
      const moduleIdx = materialItem.getAttribute('data-module-idx');
      const itemIdx = materialItem.getAttribute('data-item-idx');

      let material = null;
      let materialName = '';
      let fileId = null;

      // Get material info based on type (module item or standalone)
      if (moduleIdx !== null && itemIdx !== null) {
        // Module item
        const module = processedMaterials.modules?.[parseInt(moduleIdx)];
        if (module && module.items) {
          material = module.items[parseInt(itemIdx)];
          materialName = material?.title || material?.name || 'this file';
          // Try multiple possible ID fields
          fileId = material?.id || material?.content_id || material?.file_id || material?.url;
        }
      } else if (category && index !== null) {
        // Standalone file, page, or assignment
        material = processedMaterials[category]?.[parseInt(index)];
        materialName = material?.name || material?.display_name || material?.title || 'this file';
        // Try multiple possible ID fields
        fileId = material?.id || material?.content_id || material?.file_id || material?.url;
      }

      if (!material) {
        console.error('Material not found');
        return;
      }

      if (!fileId) {
        console.error('File ID not found for material:', material);
        console.error('Available fields:', Object.keys(material));
        // Generate a unique ID based on the material's properties
        fileId = `${category || 'module'}_${materialName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
        console.warn('Using generated fileId:', fileId);
      }

      console.log('🗑️ Deleting file:', { fileId, materialName, courseId });

      // Check if user has disabled confirmation
      const prefs = await chrome.storage.local.get(['skipDeleteConfirmation']);
      const skipConfirmation = prefs.skipDeleteConfirmation || false;

      let confirmed = true;
      if (!skipConfirmation) {
        // Show confirmation dialog with "Don't ask again" option
        const result = await showConfirmDialog(
          `Remove "${materialName}"?`,
          'This will remove the file from AI memory. You can restore it from Settings later.',
          { showDontAskAgain: true, dontAskAgainKey: 'skipDeleteConfirmation' }
        );

        confirmed = result.confirmed;

        // Save preference if user checked "Don't ask again"
        if (result.dontAskAgain) {
          await chrome.storage.local.set({ skipDeleteConfirmation: true });
          console.log('Saved preference: skip delete confirmation');
        }
      }

      if (!confirmed) return;

      try {
        // Send soft delete to backend
        if (fileId) {
          const response = await fetch(
            `https://web-production-9aaba7.up.railway.app/courses/${courseId}/materials/${fileId}`,
            { method: 'DELETE' }
          );

          if (!response.ok) {
            throw new Error(`Failed to delete: ${response.statusText}`);
          }

          console.log(`Soft deleted ${materialName} (ID: ${fileId})`);

          // Store in soft_deleted_files for restore functionality
          const result = await chrome.storage.local.get(['soft_deleted_files']);
          const deletedFiles = result.soft_deleted_files || {};

          deletedFiles[fileId] = {
            name: materialName,
            courseId: String(courseId), // Ensure consistent string format
            deletedAt: Date.now(),
            materialData: material
          };

          await chrome.storage.local.set({ soft_deleted_files: deletedFiles });
          console.log('🗑️ Stored in soft_deleted_files for restore:', {
            fileId,
            name: materialName,
            courseId: String(courseId),
            totalDeletedFiles: Object.keys(deletedFiles).length
          });
        }

        // Remove from frontend immediately
        if (moduleIdx !== null && itemIdx !== null) {
          // Remove from module items
          const module = processedMaterials.modules[parseInt(moduleIdx)];
          console.log(`Removing module item at module ${moduleIdx}, item ${itemIdx}`);
          module.items.splice(parseInt(itemIdx), 1);
          console.log(`Module now has ${module.items.length} items`);
        } else if (category && index !== null) {
          // Remove from category array
          console.log(`Removing ${category} item at index ${index}`);
          const originalLength = processedMaterials[category].length;
          processedMaterials[category].splice(parseInt(index), 1);
          console.log(`${category} reduced from ${originalLength} to ${processedMaterials[category].length} items`);
        }

        // Update IndexedDB with the modified materials
        const materialsDB = new MaterialsDB();
        await materialsDB.saveMaterials(courseId, courseName, processedMaterials);
        await materialsDB.close();
        console.log('Updated IndexedDB with removed file');

        // Re-render the materials list immediately
        displayMaterials();
        console.log('Re-rendered materials list');
        showTemporaryMessage(`Removed "${materialName}". Restore from Settings if needed.`);

      } catch (error) {
        console.error('Error deleting material:', error);
        showTemporaryMessage(`Error removing file: ${error.message}`);
      }
    }

    // Handle clicking on file name label to toggle selection
    const label = e.target.closest('.material-label');
    if (label && !deleteBtn && !e.target.closest('.open-material-btn')) {  // Only if not clicking delete or open button
      e.preventDefault();
      e.stopPropagation();

      const materialItem = label.closest('.material-item');

      // Check if shift key is pressed for range selection
      if (e.shiftKey && window._lastSelectedItem) {
        // Get all material items
        const allItems = Array.from(document.querySelectorAll('.material-item'));
        const currentIndex = allItems.indexOf(materialItem);
        const lastIndex = allItems.indexOf(window._lastSelectedItem);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          const targetState = window._lastSelectedItem.getAttribute('data-selected') === 'true';

          // Select/deselect all items in range
          for (let i = start; i <= end; i++) {
            allItems[i].setAttribute('data-selected', targetState ? 'true' : 'false');
          }
        }
      } else {
        // Normal click - toggle selection
        const isSelected = materialItem.getAttribute('data-selected') === 'true';
        materialItem.setAttribute('data-selected', isSelected ? 'false' : 'true');
      }

      // Store last selected item for shift-click
      window._lastSelectedItem = materialItem;
    }

    // Handle open button click
    const openBtn = e.target.closest('.open-material-btn');
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();

      const materialItem = openBtn.closest('.material-item');
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

      // Open file by fetching from backend GCS on-demand
      if (fileItem) {
        // Check if this is an assignment or page - ALWAYS open Canvas URL for these
        const isAssignment = fileItem.type === 'assignment' || category === 'assignments';
        const isPage = fileItem.type === 'page' || category === 'pages';

        if (isAssignment || isPage) {
          // Open in Canvas (assignments and pages should never open as files)
          if (fileItem.html_url) {
            chrome.tabs.create({ url: fileItem.html_url });
          } else {
            showTemporaryMessage(`Cannot open "${fileName}" - Canvas URL not available.`);
          }
        } else {
          // Open file from backend/GCS
          const backendUrl = 'https://web-production-9aaba7.up.railway.app';
          const fileUrl = `${backendUrl}/pdfs/${encodeURIComponent(courseId)}/${encodeURIComponent(fileName)}`;
          chrome.tabs.create({ url: fileUrl });
        }
      } else {
        showTemporaryMessage('File not found in materials list');
      }
    }
  });
}

/**
 * Load syllabus selector dropdown with available files
 */
async function loadSyllabusSelector() {
  try {
    const syllabusSelect = document.getElementById('syllabus-select');

    if (!syllabusSelect) return;

    // Check if syllabus is already detected
    const response = await fetch(`https://web-production-9aaba7.up.railway.app/courses/${courseId}/syllabus`);
    const data = await response.json();

    // Build list of all files for dropdown
    const fileOptions = [];

    // Collect files from modules
    if (processedMaterials.modules) {
      processedMaterials.modules.forEach(module => {
        if (module.items) {
          module.items.forEach(item => {
            if (item.type === 'File' && item.url) {
              const name = item.stored_name || item.title || item.name;
              const cleanName = name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf)$/i, '');
              const docId = `${courseId}_${cleanName.replace(/\//g, '-')}`;
              fileOptions.push({ docId, name });
            }
          });
        }
      });
    }

    // Collect standalone files
    if (processedMaterials.files) {
      processedMaterials.files.forEach(file => {
        const name = file.stored_name || file.name || file.display_name;
        if (name) {
          const cleanName = name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf)$/i, '');
          const docId = `${courseId}_${cleanName.replace(/\//g, '-')}`;
          fileOptions.push({ docId, name });
        }
      });
    }

    // Populate dropdown
    syllabusSelect.innerHTML = '<option value="">-- Select syllabus --</option>';
    fileOptions.forEach(file => {
      const option = document.createElement('option');
      option.value = file.docId;
      option.textContent = file.name;
      syllabusSelect.appendChild(option);
    });

    // Set current syllabus if detected
    if (data.success && data.syllabus_id) {
      syllabusSelect.value = data.syllabus_id;
      console.log('📚 Loaded syllabus:', data.syllabus_name);
    }

    // Handle selection change - auto-save
    syllabusSelect.addEventListener('change', async () => {
      const selectedSyllabusId = syllabusSelect.value;

      if (!selectedSyllabusId) return;

      try {
        console.log('💾 Saving syllabus selection:', selectedSyllabusId);

        const saveResponse = await fetch(`https://web-production-9aaba7.up.railway.app/courses/${courseId}/syllabus?syllabus_id=${encodeURIComponent(selectedSyllabusId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const saveData = await saveResponse.json();

        if (saveData.success) {
          console.log('✅ Syllabus saved:', saveData.syllabus_name);
          showTemporaryMessage(`Syllabus set: ${saveData.syllabus_name}`);
        } else {
          console.error('❌ Failed to save syllabus:', saveData.error);
          showTemporaryMessage('Failed to save syllabus selection');
        }
      } catch (error) {
        console.error('Error saving syllabus:', error);
        showTemporaryMessage('Error saving syllabus');
      }
    });

  } catch (error) {
    console.error('Error loading syllabus selector:', error);
  }
}

/**
 * Handle file upload from user's computer
 */
async function handleFileUpload(event) {
  const files = Array.from(event.target.files);

  if (files.length === 0) return;

  console.log(`📤 User uploading ${files.length} file(s):`, files.map(f => f.name));

  // Show loading banner
  showLoadingBanner(`Uploading ${files.length} file(s)...`, 'info');

  try {
    // Prepare files for upload
    const filesToUpload = files.map(file => ({
      blob: file,
      name: file.name
    }));

    // Upload to backend
    await backendClient.uploadPDFs(courseId, filesToUpload);

    console.log('✅ Files uploaded successfully');
    showLoadingBanner('Files uploaded! Adding to materials...', 'success');

    // Wait a bit for backend processing
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Add uploaded files to the materials list in IndexedDB
    const materialsDB = new MaterialsDB();
    const materialsData = await materialsDB.loadMaterials(courseId);

    if (materialsData) {
      // Add new files to the files array
      if (!materialsData.materials.files) {
        materialsData.materials.files = [];
      }

      files.forEach(file => {
        materialsData.materials.files.push({
          name: file.name,
          display_name: file.name,
          stored_name: file.name,
          type: 'file',
          blob: file, // Store the file blob
          uploaded_by_user: true, // Mark as user-uploaded
          uploaded_at: new Date().toISOString()
        });
      });

      // Save updated materials back to IndexedDB
      await materialsDB.saveMaterials(courseId, courseName, materialsData.materials);
      console.log('✅ [CHAT] Added uploaded files to IndexedDB');
    }

    await materialsDB.close();

    // Refresh the materials display
    processedMaterials = materialsData.materials;
    displayMaterials();

    hideLoadingBanner();
    showTemporaryMessage(`Successfully uploaded and added ${files.length} file(s)!`);

    // Clear file input
    event.target.value = '';

  } catch (error) {
    console.error('❌ File upload error:', error);
    showLoadingBanner(`Upload failed: ${error.message}`, 'error');
    setTimeout(() => hideLoadingBanner(), 3000);
  }
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
 * Get currently selected materials from data-selected attribute
 */
function getSelectedMaterials() {
  const selected = {};
  const selectedItems = document.querySelectorAll('.material-item[data-selected="true"]');

  selectedItems.forEach(item => {
    const category = item.getAttribute('data-category');
    const index = parseInt(item.getAttribute('data-index'));

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
  const selectedItems = document.querySelectorAll('.material-item[data-selected="true"]');

  selectedItems.forEach((item, idx) => {
    const moduleIdx = item.getAttribute('data-module-idx');
    const itemIdx = item.getAttribute('data-item-idx');
    const category = item.getAttribute('data-category');
    const index = item.getAttribute('data-index');

    let materialName = null;

    // Handle module items
    if (moduleIdx !== null && itemIdx !== null) {
      const module = processedMaterials.modules?.[parseInt(moduleIdx)];
      if (module && module.items) {
        const fileItem = module.items[parseInt(itemIdx)];
        if (fileItem) {
          // Use stored_name if available (has correct extension), otherwise use title
          materialName = fileItem.stored_name || fileItem.title || fileItem.name;
        }
      }
    }
    // Handle standalone files, pages, assignments
    else if (category && index !== null) {
      const fileItem = processedMaterials[category]?.[parseInt(index)];
      if (fileItem) {
        // Use stored_name if available (has correct extension), otherwise use name
        materialName = fileItem.stored_name || fileItem.name || fileItem.display_name || fileItem.title;
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
      // Set up connection state change handler
      wsClient.onConnectionStateChange = (state) => {
        switch (state) {
          case 'connected':
            setAPIStatus('connected', 'Backend Connected');
            elements.sendBtn.disabled = false;
            break;
          case 'reconnecting':
            setAPIStatus('warning', 'Reconnecting...');
            break;
          case 'stale':
            setAPIStatus('warning', 'Connection Unstable');
            break;
          case 'offline':
            setAPIStatus('error', 'Offline');
            elements.sendBtn.disabled = true;
            break;
        }
      };

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

  // Stop generation
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', stopGeneration);
  }

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

  // Compact mode buttons
  document.querySelectorAll('.mode-btn-compact').forEach(btn => {
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

  // Change Canvas Authentication
  document.getElementById('change-canvas-auth-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'Change Canvas Login',
      'This will clear your current Canvas session and you will need to log in again. Continue?'
    );
    if (confirmed) {
      await StorageManager.clearAll();
      // Redirect to popup to set up Canvas authentication
      window.location.href = '../popup/popup-v2.html';
    }
  });

  // Clear All Data
  document.getElementById('clear-all-data-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog(
      'Clear All Data',
      'This will delete all stored data including your Canvas session, course materials, and chat history. This action cannot be undone. Continue?'
    );
    if (confirmed) {
      await StorageManager.clearAll();
      // Redirect to popup to set up Canvas authentication
      window.location.href = '../popup/popup-v2.html';
    }
  });

  // Test API Key
  document.getElementById('test-api-key-btn')?.addEventListener('click', async () => {
    const apiKeyInput = document.getElementById('settings-api-key-input');
    const statusElement = document.getElementById('settings-api-key-status');
    const apiKey = apiKeyInput?.value?.trim();

    if (!apiKey) {
      showStatusMessage(statusElement, 'Please enter an API key', 'error');
      return;
    }

    showStatusMessage(statusElement, 'Testing API key...', 'info');

    try {
      const isValid = await testGeminiApiKey(apiKey);
      if (isValid) {
        showStatusMessage(statusElement, '✅ API key is valid!', 'success');
      } else {
        showStatusMessage(statusElement, '❌ API key is invalid', 'error');
      }
    } catch (error) {
      console.error('Error testing API key:', error);
      showStatusMessage(statusElement, 'Error testing API key', 'error');
    }
  });

  // Save API Key
  document.getElementById('save-api-key-btn')?.addEventListener('click', async () => {
    const apiKeyInput = document.getElementById('settings-api-key-input');
    const statusElement = document.getElementById('settings-api-key-status');
    const successElement = document.getElementById('settings-success');

    const apiKey = apiKeyInput?.value?.trim();

    if (!apiKey) {
      showStatusMessage(statusElement, 'Please enter an API key', 'error');
      return;
    }

    // Save API key
    await chrome.storage.local.set({ gemini_api_key: apiKey });

    showStatusMessage(successElement, 'API key saved successfully!', 'success');

    // Clear status after a short delay
    setTimeout(() => {
      statusElement.textContent = '';
      statusElement.className = 'status-message';
    }, 2000);
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

  // Refresh materials button
  const refreshMaterialsBtn = document.getElementById('refresh-materials-btn');
  if (refreshMaterialsBtn) {
    refreshMaterialsBtn.addEventListener('click', async () => {
      try {
        // Show loading state
        refreshMaterialsBtn.disabled = true;
        refreshMaterialsBtn.style.opacity = '0.5';

        // Reload materials from Canvas
        await loadMaterials();

        // Show success feedback (brief rotation animation is already in CSS)
        setTimeout(() => {
          refreshMaterialsBtn.disabled = false;
          refreshMaterialsBtn.style.opacity = '1';
        }, 500);
      } catch (error) {
        console.error('Error refreshing materials:', error);
        refreshMaterialsBtn.disabled = false;
        refreshMaterialsBtn.style.opacity = '1';
      }
    });
  }

  // Enable send button when input has text
  elements.messageInput.addEventListener('input', () => {
    elements.sendBtn.disabled = !elements.messageInput.value.trim();
  });

  // Position tooltips dynamically to avoid clipping
  const tooltipToggles = document.querySelectorAll('.toggle-compact.toggle-with-tooltip');
  tooltipToggles.forEach(toggle => {
    const tooltip = toggle.querySelector('.toggle-tooltip');
    if (tooltip) {
      toggle.addEventListener('mouseenter', () => {
        const rect = toggle.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - 8}px`;
        tooltip.style.transform = 'translate(-50%, -100%)';
      });
    }
  });

  // File upload handler
  const uploadBtn = document.getElementById('upload-files-btn');
  const fileInput = document.getElementById('file-upload-input');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', handleFileUpload);
  }

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

  // Module collapse/expand - use event delegation on materials list
  document.addEventListener('click', (e) => {
    const moduleHeader = e.target.closest('.module-header');
    if (moduleHeader) {
      // Don't toggle if clicking on the checkbox itself
      const moduleCheckbox = moduleHeader.querySelector('.module-checkbox');
      if (e.target === moduleCheckbox) {
        return;
      }

      const moduleDiv = moduleHeader.closest('.material-module');
      const itemsDiv = moduleDiv.querySelector('.module-items');
      const chevron = moduleDiv.querySelector('.module-chevron');

      if (moduleDiv && itemsDiv && chevron) {
        itemsDiv.classList.toggle('collapsed');
        moduleDiv.classList.toggle('collapsed');
        chevron.classList.toggle('rotated');
      }
    }
  });

  // Module checkbox - select/deselect all items in module using event delegation
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('module-checkbox')) {
      e.stopPropagation();
      const moduleDiv = e.target.closest('.material-module');
      const itemsDiv = moduleDiv.querySelector('.module-items');
      const checkboxes = itemsDiv.querySelectorAll('.material-checkbox');
      checkboxes.forEach(cb => cb.checked = e.target.checked);
    }
  });

  // Individual material checkbox - update module checkbox state using event delegation
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('material-checkbox')) {
      const moduleDiv = e.target.closest('.material-module');
      if (moduleDiv) {
        const itemsDiv = moduleDiv.querySelector('.module-items');
        const moduleCheckbox = moduleDiv.querySelector('.module-checkbox');
        const itemCheckboxes = itemsDiv.querySelectorAll('.material-checkbox');

        const allChecked = Array.from(itemCheckboxes).every(cb => cb.checked);
        const noneChecked = Array.from(itemCheckboxes).every(cb => !cb.checked);

        moduleCheckbox.checked = allChecked;
        moduleCheckbox.indeterminate = !allChecked && !noneChecked;
      }
    }
  });

  // Keyboard delete handler for mass deletion of selected files
  document.addEventListener('keydown', async (e) => {
    // Only trigger if Delete or Backspace is pressed and focus is not in an input/textarea
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {

      const selectedItems = document.querySelectorAll('.material-item[data-selected="true"]');

      if (selectedItems.length === 0) return;

      e.preventDefault(); // Prevent browser back navigation on Backspace

      // Check if user has disabled confirmation
      const prefs = await chrome.storage.local.get(['skipDeleteConfirmation']);
      const skipConfirmation = prefs.skipDeleteConfirmation || false;

      let confirmed = true;
      if (!skipConfirmation) {
        const fileCount = selectedItems.length;
        const result = await showConfirmDialog(
          `Remove ${fileCount} selected file${fileCount > 1 ? 's' : ''}?`,
          'This will remove the files from AI memory. You can restore them from Settings later.',
          { showDontAskAgain: true, dontAskAgainKey: 'skipDeleteConfirmation' }
        );

        confirmed = result.confirmed;

        if (result.dontAskAgain) {
          await chrome.storage.local.set({ skipDeleteConfirmation: true });
        }
      }

      if (!confirmed) return;

      // Delete each selected file
      let successCount = 0;
      let errorCount = 0;

      for (const materialItem of selectedItems) {
        const category = materialItem.getAttribute('data-category');
        const index = materialItem.getAttribute('data-index');
        const moduleIdx = materialItem.getAttribute('data-module-idx');
        const itemIdx = materialItem.getAttribute('data-item-idx');

        let material = null;
        let materialName = '';
        let fileId = null;

        // Get material info based on type
        if (moduleIdx !== null && itemIdx !== null) {
          const module = processedMaterials.modules?.[parseInt(moduleIdx)];
          if (module && module.items) {
            material = module.items[parseInt(itemIdx)];
            materialName = material?.title || material?.name || 'this file';
            fileId = material?.id || material?.content_id || material?.file_id || material?.url;
          }
        } else if (category && index !== null) {
          material = processedMaterials[category]?.[parseInt(index)];
          materialName = material?.name || material?.display_name || material?.title || 'this file';
          fileId = material?.id || material?.content_id || material?.file_id || material?.url;
        }

        if (!material || !fileId) {
          errorCount++;
          continue;
        }

        try {
          // Send soft delete to backend
          const response = await fetch(
            `https://web-production-9aaba7.up.railway.app/courses/${courseId}/materials/${fileId}`,
            { method: 'DELETE' }
          );

          if (!response.ok) {
            throw new Error(`Failed to delete: ${response.statusText}`);
          }

          // Store in soft_deleted_files for restore functionality
          const result = await chrome.storage.local.get(['soft_deleted_files']);
          const deletedFiles = result.soft_deleted_files || {};

          deletedFiles[fileId] = {
            name: materialName,
            courseId: String(courseId),
            deletedAt: Date.now(),
            materialData: material
          };

          await chrome.storage.local.set({ soft_deleted_files: deletedFiles });

          // Remove from frontend data
          if (moduleIdx !== null && itemIdx !== null) {
            const module = processedMaterials.modules[parseInt(moduleIdx)];
            module.items.splice(parseInt(itemIdx), 1);
          } else if (category && index !== null) {
            processedMaterials[category].splice(parseInt(index), 1);
          }

          successCount++;
        } catch (error) {
          console.error('Error deleting material:', error);
          errorCount++;
        }
      }

      // Update IndexedDB with the modified materials
      if (successCount > 0) {
        const materialsDB = new MaterialsDB();
        await materialsDB.saveMaterials(courseId, courseName, processedMaterials);
        await materialsDB.close();

        // Re-render the materials list
        displayMaterials();

        showTemporaryMessage(
          `Removed ${successCount} file${successCount > 1 ? 's' : ''}${errorCount > 0 ? `, ${errorCount} failed` : ''}. Restore from Settings if needed.`
        );
      } else if (errorCount > 0) {
        showTemporaryMessage(`Error removing files: ${errorCount} failed`);
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
 * Stop AI generation
 */
function stopGeneration() {
  console.log('🛑 Stopping generation...');

  if (wsClient && isGenerating) {
    wsClient.stopStreaming();
  }

  isGenerating = false;

  // Show/hide buttons
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.classList.add('hidden');
  elements.sendBtn.disabled = false;

  hideLoadingBanner();

  // Mark last message as stopped
  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    lastMessage.content += '\n\n_(Generation stopped by user)_';
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

  // Show stop button, hide send button
  const stopBtn = document.getElementById('stop-btn');
  if (stopBtn) {
    stopBtn.classList.remove('hidden');
    elements.sendBtn.classList.add('hidden');
  }

  isGenerating = true;

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

    // Generate chat title if this is the first message
    if (conversationHistory.length === 2) {
      generateChatTitle(message);
    }

    // Show usage info
    if (elements.tokenInfo) {
      elements.tokenInfo.textContent = `Mode: Python Backend`;
    }

  } catch (error) {
    console.error('Error sending message:', error);
    removeTypingIndicator(typingId);
    hideLoadingBanner();

    // Show error message with retry button
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message assistant-message error-message';
    errorDiv.innerHTML = `
      <div class="message-avatar">⚠️</div>
      <div class="message-content">
        <div class="message-text">
          <h3>Error</h3>
          <p>${error.message}</p>
          <button class="retry-btn" data-retry-message="${message}">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 8C2 4.686 4.686 2 8 2C11.314 2 14 4.686 14 8C14 11.314 11.314 14 8 14C5.79 14 3.83 12.868 2.757 11.2" stroke-linecap="round"/>
              <path d="M2 11.2V7.2M2 11.2H6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Retry Query
          </button>
        </div>
      </div>
    `;

    elements.messagesContainer.appendChild(errorDiv);
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;

    // Add retry click handler
    const retryBtn = errorDiv.querySelector('.retry-btn');
    retryBtn.addEventListener('click', () => {
      // Remove error message
      errorDiv.remove();

      // Put message back in input
      elements.messageInput.value = message;
      elements.messageInput.style.height = 'auto';
      elements.messageInput.style.height = elements.messageInput.scrollHeight + 'px';

      // Auto-send
      sendMessage();
    });

  } finally {
    isGenerating = false;

    // Hide stop button, show send button
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) stopBtn.classList.add('hidden');
    elements.sendBtn.classList.remove('hidden');
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
 * Render LaTeX math expressions using KaTeX
 * Supports both inline math ($...$) and display math ($$...$$)
 */
function renderMath(content) {
  if (!window.katex) {
    console.warn('KaTeX not loaded, skipping math rendering');
    return content;
  }

  try {
    // First, protect code blocks from math processing
    const codeBlocks = [];
    let protectedContent = content.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Render display math ($$...$$)
    protectedContent = protectedContent.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
      try {
        return katex.renderToString(math.trim(), {
          displayMode: true,
          throwOnError: false,
          output: 'html'
        });
      } catch (e) {
        console.error('KaTeX display math error:', e);
        return match; // Return original if rendering fails
      }
    });

    // Render inline math ($...$)
    protectedContent = protectedContent.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
      try {
        return katex.renderToString(math.trim(), {
          displayMode: false,
          throwOnError: false,
          output: 'html'
        });
      } catch (e) {
        console.error('KaTeX inline math error:', e);
        return match; // Return original if rendering fails
      }
    });

    // Restore code blocks
    protectedContent = protectedContent.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
      return codeBlocks[parseInt(index)];
    });

    return protectedContent;
  } catch (e) {
    console.error('Math rendering error:', e);
    return content;
  }
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
 * Open a cited document from GCS with page anchor
 */
async function openCitedDocument(docName, pageNum) {
  try {
    const normalizedDocName = normalizeFilename(docName);

    // Find the file in processedMaterials
    let fileItem = null;
    let fileName = null;

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
                fileName = item.title || item.display_name || item.name;
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
        const fileNameCheck = file.name || file.display_name || '';
        if (fileNameCheck) {
          const normalizedFileName = normalizeFilename(fileNameCheck);

          // Try exact match first, then partial match
          if (normalizedFileName === normalizedDocName || normalizedFileName.includes(normalizedDocName) || normalizedDocName.includes(normalizedFileName)) {
            fileItem = file;
            fileName = fileNameCheck;
            break;
          }
        }
      }
    }

    if (!fileItem || !fileName) {
      showError(`File not found: ${docName}`);
      return;
    }

    // Open file from backend/GCS with page parameter
    // Backend will append #page=X to the GCS signed URL
    const backendUrl = 'https://web-production-9aaba7.up.railway.app';
    const fileUrl = `${backendUrl}/pdfs/${encodeURIComponent(courseId)}/${encodeURIComponent(fileName)}?page=${pageNum}`;

    console.log(`Opening citation: ${fileName} at page ${pageNum}`);
    chrome.tabs.create({ url: fileUrl });
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

  // For assistant messages: render math, parse citations, then render markdown
  let processedContent = content;
  if (role === 'assistant') {
    // Step 1: Render math (LaTeX → HTML)
    processedContent = renderMath(processedContent);
    // Step 2: Parse citations
    processedContent = parseCitations(processedContent);
  }

  // Step 3: Render markdown
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
    // Render math and parse citations in streaming content too
    let processedContent = renderMath(content);
    processedContent = parseCitations(processedContent);
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
 * Generate AI title for chat based on first message
 */
async function generateChatTitle(firstMessage) {
  try {
    console.log('✨ Generating chat title...');

    const response = await fetch(`https://web-production-9aaba7.up.railway.app/chats/${courseId}/${currentSessionId}/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_message: firstMessage })
    });

    const data = await response.json();

    if (data.success && data.title) {
      console.log('✅ Generated title:', data.title);
      // Refresh recent chats to show new title
      await loadRecentChats();
    }
  } catch (error) {
    console.warn('Failed to generate chat title:', error);
    // Non-critical, fail silently
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
        if (courseData) {
          // Ensure courseName is a string (defensive check)
          let courseName = 'Unknown Course';
          if (typeof courseData.courseName === 'string') {
            courseName = courseData.courseName;
          } else if (typeof courseData.courseName === 'object' && courseData.courseName !== null) {
            courseName = courseData.courseName.name || courseData.courseName.courseName || 'Unknown Course';
            console.warn('⚠️ Course name was an object for courseId:', courseId, courseData.courseName);
          }

          availableCourses.push({
            id: courseData.courseId || courseId,
            name: courseName
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

  // Load Canvas URL
  const url = await StorageManager.getCanvasUrl();
  const canvasUrlSpan = document.getElementById('settings-canvas-url');
  if (canvasUrlSpan) {
    canvasUrlSpan.textContent = url || 'Not set';
  }

  // Load API key
  const settings = await chrome.storage.local.get(['gemini_api_key']);
  const apiKeyInput = document.getElementById('settings-api-key-input');
  if (apiKeyInput && settings.gemini_api_key) {
    apiKeyInput.value = settings.gemini_api_key;
  }

  // Load deleted files
  await loadDeletedFiles();
}

function hideSettingsModal() {
  elements.settingsModal.classList.add('hidden');
}

async function loadDeletedFiles() {
  const deletedFilesContainer = document.getElementById('deleted-files-list');
  if (!deletedFilesContainer) {
    console.warn('deleted-files-list element not found in DOM');
    return;
  }

  try {
    // Get soft-deleted files from storage
    const result = await chrome.storage.local.get(['soft_deleted_files']);
    const deletedFiles = result.soft_deleted_files || {};

    console.log('📁 [Settings] All deleted files from storage:', deletedFiles);
    console.log('📁 [Settings] Current courseId:', courseId);

    // Filter for current course (compare as strings for consistency)
    const courseDeletedFiles = Object.entries(deletedFiles)
      .filter(([fileId, data]) => {
        const matches = String(data.courseId) === String(courseId);
        console.log(`  File ${fileId}: courseId=${data.courseId} (${typeof data.courseId}), current=${courseId} (${typeof courseId}), matches=${matches}`);
        return matches;
      })
      .map(([fileId, data]) => ({ fileId, ...data }));

    console.log('📁 [Settings] Filtered deleted files for this course:', courseDeletedFiles);

    if (courseDeletedFiles.length === 0) {
      deletedFilesContainer.innerHTML = '<p class="no-deleted-files">No deleted files</p>';
      return;
    }

    // Create list of deleted files with restore/delete buttons
    deletedFilesContainer.innerHTML = courseDeletedFiles.map(file => `
      <div class="deleted-file-item" data-file-id="${file.fileId}">
        <div class="deleted-file-info">
          <span class="deleted-file-name">${escapeHtml(file.name)}</span>
          <span class="deleted-file-date">${new Date(file.deletedAt).toLocaleDateString()}</span>
        </div>
        <div class="deleted-file-actions">
          <button type="button" class="btn btn-small btn-secondary restore-file-btn" data-file-id="${file.fileId}">
            Restore
          </button>
          <button type="button" class="btn btn-small btn-danger hard-delete-file-btn" data-file-id="${file.fileId}">
            Delete Forever
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    deletedFilesContainer.querySelectorAll('.restore-file-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        restoreDeletedFile(btn.dataset.fileId);
      });
    });

    deletedFilesContainer.querySelectorAll('.hard-delete-file-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hardDeleteFile(btn.dataset.fileId);
      });
    });

  } catch (error) {
    console.error('Error loading deleted files:', error);
    deletedFilesContainer.innerHTML = '<p class="error-text">Error loading deleted files</p>';
  }
}

async function restoreDeletedFile(fileId) {
  try {
    // Get deleted files
    const result = await chrome.storage.local.get(['soft_deleted_files']);
    const deletedFiles = result.soft_deleted_files || {};

    if (!deletedFiles[fileId]) {
      console.error('File not found in deleted files:', fileId);
      return;
    }

    const fileData = deletedFiles[fileId];
    const materialData = fileData.materialData;

    // Send restore request to backend
    if (wsClient && wsClient.isConnected && wsClient.ws) {
      try {
        wsClient.ws.send(JSON.stringify({
          type: 'restore_file',
          file_id: fileId,
          course_id: courseId
        }));
      } catch (error) {
        console.error('Error sending restore request:', error);
      }
    }

    // Add the file back to processedMaterials
    if (materialData) {
      // Determine where to add it back based on its type
      if (materialData.module_name) {
        // It's a module item - find or create the module
        let module = processedMaterials.modules.find(m => m.name === materialData.module_name);
        if (!module) {
          // Module doesn't exist, create it
          module = {
            name: materialData.module_name,
            items: []
          };
          processedMaterials.modules.push(module);
        }
        module.items.push(materialData);
      } else if (materialData.type === 'file') {
        processedMaterials.files.push(materialData);
      } else if (materialData.type === 'page') {
        processedMaterials.pages.push(materialData);
      } else if (materialData.type === 'assignment') {
        processedMaterials.assignments.push(materialData);
      }

      // Update IndexedDB with restored material
      const materialsDB = new MaterialsDB();
      await materialsDB.saveMaterials(courseId, courseName, processedMaterials);
      await materialsDB.close();
      console.log('Updated IndexedDB with restored file');
    }

    // Remove from soft deleted
    delete deletedFiles[fileId];
    await chrome.storage.local.set({ soft_deleted_files: deletedFiles });

    // Refresh the deleted files list
    await loadDeletedFiles();

    // Show success message
    showStatusMessage(
      document.getElementById('settings-success'),
      `Restored "${fileData.name}"`,
      'success'
    );

    // Reload materials in sidebar
    await loadMaterials();

  } catch (error) {
    console.error('Error restoring file:', error);
    showStatusMessage(
      document.getElementById('settings-error'),
      'Error restoring file',
      'error'
    );
  }
}

async function hardDeleteFile(fileId) {
  // Check if user has disabled confirmation
  const prefs = await chrome.storage.local.get(['skipHardDeleteConfirmation']);
  const skipConfirmation = prefs.skipHardDeleteConfirmation || false;

  let confirmed = true;
  if (!skipConfirmation) {
    // Show confirmation dialog with "Don't ask again" option
    const result = await showConfirmDialog(
      'Permanently Delete File',
      'This will permanently remove this file from storage. This action cannot be undone. Continue?',
      { showDontAskAgain: true, dontAskAgainKey: 'skipHardDeleteConfirmation' }
    );

    confirmed = result.confirmed;

    // Save preference if user checked "Don't ask again"
    if (result.dontAskAgain) {
      await chrome.storage.local.set({ skipHardDeleteConfirmation: true });
      console.log('Saved preference: skip hard delete confirmation');
    }
  }

  if (!confirmed) return;

  try {
    // Get deleted files
    const result = await chrome.storage.local.get(['soft_deleted_files']);
    const deletedFiles = result.soft_deleted_files || {};

    if (!deletedFiles[fileId]) {
      console.error('File not found in deleted files:', fileId);
      return;
    }

    const fileData = deletedFiles[fileId];

    // Send hard delete to backend via HTTP (to delete from GCS)
    try {
      const response = await fetch(
        `https://web-production-9aaba7.up.railway.app/courses/${courseId}/materials/${fileId}/hard-delete`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error(`Failed to delete from storage: ${response.statusText}`);
      }

      console.log(`Hard deleted ${fileData.name} from GCS`);
    } catch (error) {
      console.error('Error deleting from GCS:', error);
      // Continue anyway to remove from local storage
    }

    // Also send via WebSocket if connected
    if (wsClient && wsClient.isConnected && wsClient.ws) {
      try {
        wsClient.ws.send(JSON.stringify({
          type: 'hard_delete_file',
          file_id: fileId,
          course_id: courseId
        }));
      } catch (error) {
        console.error('Error sending hard delete request:', error);
      }
    }

    // Remove from storage
    delete deletedFiles[fileId];
    await chrome.storage.local.set({ soft_deleted_files: deletedFiles });

    // Refresh the deleted files list
    await loadDeletedFiles();

    // Show success message
    showStatusMessage(
      document.getElementById('settings-success'),
      `Permanently deleted "${fileData.name}"`,
      'success'
    );

  } catch (error) {
    console.error('Error permanently deleting file:', error);
    showStatusMessage(
      document.getElementById('settings-error'),
      'Error deleting file',
      'error'
    );
  }
}


function showStatusMessage(element, message, type) {
  element.textContent = message;
  element.className = `status-message show ${type}`;

  setTimeout(() => {
    element.classList.remove('show');
  }, 3000);
}

/**
 * Show confirmation dialog
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Object} options - Optional configuration
 * @param {boolean} options.showDontAskAgain - Show "Don't ask again" checkbox
 * @param {string} options.dontAskAgainKey - Storage key for the preference
 * @returns {Promise<{confirmed: boolean, dontAskAgain: boolean}>}
 */
function showConfirmDialog(title, message, options = {}) {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: var(--surface, #1a1a1a);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    `;

    const dontAskAgainHtml = options.showDontAskAgain ? `
      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-secondary, #aaa); font-size: 14px;">
          <input type="checkbox" id="dont-ask-again" style="cursor: pointer; accent-color: var(--blue-primary, #3b82f6);">
          Don't ask again
        </label>
      </div>
    ` : '';

    dialog.innerHTML = `
      <h3 style="margin: 0 0 12px 0; font-size: 18px; color: var(--text-primary, #fff);">${title}</h3>
      <p style="margin: 0 0 24px 0; color: var(--text-secondary, #aaa); line-height: 1.5;">${message}</p>
      ${dontAskAgainHtml}
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="confirm-cancel" style="
          padding: 10px 20px;
          border: 1px solid var(--border, #333);
          background: transparent;
          color: var(--text-secondary, #aaa);
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
        ">Cancel</button>
        <button id="confirm-ok" style="
          padding: 10px 20px;
          border: none;
          background: var(--error, #ef4444);
          color: white;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        ">Remove</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Handle buttons
    const handleClose = (confirmed) => {
      const dontAskAgain = options.showDontAskAgain
        ? dialog.querySelector('#dont-ask-again')?.checked || false
        : false;

      overlay.remove();

      // For backward compatibility, resolve with boolean if no options were provided
      if (!options.showDontAskAgain) {
        resolve(confirmed);
      } else {
        resolve({ confirmed, dontAskAgain });
      }
    };

    dialog.querySelector('#confirm-cancel').onclick = () => handleClose(false);
    dialog.querySelector('#confirm-ok').onclick = () => handleClose(true);
    overlay.onclick = (e) => {
      if (e.target === overlay) handleClose(false);
    };
  });
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