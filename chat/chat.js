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
let currentMode = null; // Current study mode: null, 'learn', 'reinforce', or 'test'
let modePromptUsed = false; // Track if mode prompt has been applied (only use once per mode activation)
let modeResponseCache = {}; // Cache mode conversations by topic: { "exam 1": { learn: [{role, content}...], reinforce: [{role, content}...], test: [{role, content}...] } }
let currentModeTopic = null; // Store the current topic being used in mode
let isShowingFirstTimeHint = false; // Flag to prevent duplicate tip notifications

// Mode-specific prompt templates
const modePrompts = {
  learn: `Act as an expert university professor and instructional designer. Your task is to create a comprehensive, in-depth, and holistic study guide for a college student on the topic of {userInput}.

The study guide must be exceptionally clear, well-structured, and designed for maximum comprehension and retention. Follow these instructions precisely:

Start with the Big Picture: Begin with a concise, high-level overview (2-3 sentences) that explains why this topic is important, its real-world applications, and what its core principles are.

Define Key Concepts: Identify all critical vocabulary, theories, concepts, and key figures. For each one, provide:

A clear, easy-to-understand definition.

A real-world analogy or example to make it memorable.

The context of why it's important.

Create a Hierarchical Outline: Organize the entire topic into a logical, hierarchical structure using headings, subheadings, and nested bullet points. Break down complex processes into sequential, step-by-step explanations. This should be the main body of the study guide.

Connect the Dots: Explicitly explain the relationships between different concepts. Use phrases like "This is important because..." or "This connects to [another concept] by..." to help build a robust mental model.

Identify Common Pitfalls: Include a dedicated section titled "Common Misconceptions & Pitfalls." List 2-3 common points of confusion for students and provide a clear explanation to correct them.

Advanced Connections: Add a brief section on "Advanced Connections" that explains how this topic relates to broader themes in the field or sets the foundation for more advanced courses.

Check Your Understanding: Conclude with 3-4 quick comprehension questions (not a full test) that a student can use to self-assess their understanding as they read the guide.

Visual Structure & Formatting: Use Markdown extensively for maximum clarity and readability:
- Use ## headings for major sections and ### for subsections
- **Bold** all key terms, concepts, and important vocabulary
- Use bullet points and numbered lists with proper spacing
- Use markdown tables for comparisons, data, or side-by-side information
- Use code blocks with triple backticks for formulas, syntax, or technical examples
- Add blank lines between major sections for visual breathing room
- Use blockquotes (>) for important notes or tips

Generate a detailed, beautifully formatted guide that a student could use as their primary resource to learn this material from the ground up.`,

  reinforce: `You are creating active recall exercises and reinforcement activities specifically about: {userInput}

Act as a friendly and encouraging cognitive science tutor. Your goal is to help me strengthen my memory and understanding of the topic "{userInput}" using active recall exercises. Do not simply give me a summary. Instead, create an interactive reinforcement session focused on this specific topic.

Follow these steps:

1. Generate "Fill-in-the-Blank" Questions: Create a list of 5-7 critical sentences from the topic with key terms or concepts removed (represented by [BLANK]). This will force me to retrieve specific terminology. Number each question (1, 2, 3, etc.).

2. Pose Conceptual Questions: Ask me 3-4 open-ended questions that require me to explain a core concept in my own words. These questions should start with "Explain how...", "What is the significance of...", or "Compare and contrast...". Number these questions continuing from where fill-in-blank left off.

3. Create a Quick Matching Challenge: Present a two-column list formatted clearly with line breaks.

**Column A: Terms**
1. [Term 1]
2. [Term 2]
3. [Term 3]
4. [Term 4]
5. [Term 5]

**Column B: Definitions (Scrambled)**
A. [Definition for term X]
B. [Definition for term Y]
C. [Definition for term Z]
D. [Definition for term W]
E. [Definition for term V]

Use proper markdown formatting with line breaks between each item so it's easy to read.

4. Wait for Response: After presenting all exercises, end with an encouraging prompt like, "Take your time to answer these from memory! When you're ready, share your answers and I'll provide detailed feedback."

5. **ANSWER KEY** (REQUIRED): Immediately after the exercises and prompt, you MUST include a complete answer key section with the heading "--- ANSWER KEY ---". For each question, provide:
   - The correct answer
   - A detailed explanation of why it's correct
   - For matching: Show the correct pairs (1-A, 2-B, etc.)

Your entire output should be: exercises → encouraging prompt → answer key. Do NOT skip the answer key.`,

  test: `You are creating a practice test and assessment specifically about: {userInput}

Act as a meticulous and fair university examiner. Your task is to create a practice test to assess my knowledge and application of the material related to the topic "{userInput}". The test should mirror the style and difficulty of a real college-level exam and focus specifically on this topic.

The test must contain the following sections:

Part A: Multiple Choice Questions (3 questions):

Design questions where the options are plausible and test for common misconceptions.

One of these questions should be a scenario-based question that requires applying a concept.

**FORMATTING REQUIREMENT**: Put each answer choice on a SEPARATE LINE with clear spacing. Example:
**Question 1**: What is the time complexity of binary search?

A) O(n)
B) O(log n)
C) O(n²)
D) O(1)

Part B: Short Answer Questions (2 questions):

Design questions that require more than just recalling a definition. They should ask for analysis, comparison, or a brief explanation of a process.

Each question should be answerable in 2-4 sentences.

Number each question clearly with bolding: **1.**, **2.**, etc.

Part C: Application Problem (1 question):

Provide a brief case study, a data set, or a problem scenario.

Ask me to analyze the situation and use my knowledge to solve the problem or draw a conclusion.

**GENERAL FORMATTING REQUIREMENTS**:
- Use markdown headings (##) for section titles
- Bold question numbers and key terms
- Add blank lines between questions for readability
- Use code blocks for any formulas or code examples
- Use tables for structured data or comparisons

After presenting all the questions, clearly state: "--- End of Test. Provide your answers before scrolling down for the Answer Key. ---"

Finally, provide a comprehensive Answer Key below that separation line. For each question in the key, you must:

Clearly state the correct answer.

Provide a detailed explanation for why it is the correct answer.

For multiple-choice questions, briefly explain why the other options (distractors) are incorrect.`
};

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

        // Update progress bar
        const progressFill = document.getElementById('loading-progress-fill');
        if (progressFill) {
          progressFill.style.width = percent + '%';
        }

      } else if (task.status === 'downloading') {
        // Show download progress (legacy)
        const progress = task.progress;
        if (progress) {
          const percent = progress.filesTotal > 0
            ? Math.round((progress.filesCompleted / progress.filesTotal) * 100)
            : 0;
          showLoadingBanner(`${progress.message} (${percent}%)`);

          // Update progress bar
          const progressFill = document.getElementById('loading-progress-fill');
          if (progressFill) {
            progressFill.style.width = percent + '%';
          }
        }

      } else if (task.status === 'complete') {
        console.log(`✅ [CHAT] ${taskType} complete!`);
        clearInterval(pollInterval); // Stop polling
        showLoadingBanner('All files uploaded! Ready to chat.', 'success');

        // Set progress bar to 100%
        const progressFill = document.getElementById('loading-progress-fill');
        if (progressFill) {
          progressFill.style.width = '100%';
        }

        // CRITICAL: Reload materials from IndexedDB to get hash-based IDs
        // Background worker has updated IndexedDB with doc_id and hash fields
        console.log('🔄 Reloading materials with hash-based IDs...');
        await loadMaterials();
        console.log('✅ Materials reloaded with hash-based IDs');

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

  // Reset progress bar
  const progressFill = document.getElementById('loading-progress-fill');
  if (progressFill) {
    progressFill.style.width = '0%';
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

  // HASH-BASED: Sync materials with backend to ensure hash-based IDs are present
  await syncMaterialsWithBackend();

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
 * HASH-BASED: Sync materials with backend to get hash-based IDs
 * Calls service worker which fetches from backend and merges into IndexedDB
 */
async function syncMaterialsWithBackend() {
  try {
    console.log('🔄 Syncing materials with backend...');

    const response = await chrome.runtime.sendMessage({
      type: 'SYNC_BACKEND_MATERIALS',
      payload: { courseId }
    });

    if (response && response.success) {
      console.log('✅ Materials synced with backend');

      // Reload materials after sync to get updated data
      await loadMaterials();
    } else {
      console.warn('⚠️ Backend sync failed:', response?.error);
    }
  } catch (error) {
    console.error('❌ Error syncing with backend:', error);
    // Don't block the UI - sync is best-effort
  }
}

/**
 * Show first-time user hint about file selection
 */
async function showFirstTimeHint() {
  try {
    // Check if already showing or has been shown to prevent duplicates
    if (isShowingFirstTimeHint) {
      return;
    }

    const { hasSeenFileSelectionHint } = await chrome.storage.local.get(['hasSeenFileSelectionHint']);

    if (!hasSeenFileSelectionHint) {
      // Set flag immediately to prevent duplicate calls
      isShowingFirstTimeHint = true;

      const hint = document.createElement('div');
      hint.className = 'first-time-hint';
      hint.innerHTML = `
        <div class="hint-content">
          <strong>Tip:</strong> Click files to select for AI context. Use the open button (↗) to view files.
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

  // Helper function to update module checkbox state based on selected items
  function updateModuleCheckboxState(moduleDiv) {
    const moduleCheckbox = moduleDiv.querySelector('.module-checkbox');
    const itemsDiv = moduleDiv.querySelector('.module-items');
    const materialItems = itemsDiv.querySelectorAll('.material-item');

    const selectedItems = Array.from(materialItems).filter(item => item.getAttribute('data-selected') === 'true');
    const allSelected = selectedItems.length === materialItems.length;
    const someSelected = selectedItems.length > 0 && selectedItems.length < materialItems.length;

    if (allSelected) {
      moduleCheckbox.checked = true;
      moduleCheckbox.indeterminate = false;
    } else if (someSelected) {
      moduleCheckbox.checked = false;
      moduleCheckbox.indeterminate = true; // Show dash/minus
    } else {
      moduleCheckbox.checked = false;
      moduleCheckbox.indeterminate = false;
    }
  }

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

  // Setup select all/deselect all checkbox (combined into one)
  const selectAllCheckbox = document.getElementById('select-all-materials-checkbox');

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      console.log('[DEBUG] Select All checkbox toggled:', isChecked);

      // Select or deselect all material items
      const selectedValue = isChecked ? 'true' : 'false';
      document.querySelectorAll('.material-item').forEach(item => item.setAttribute('data-selected', selectedValue));

      // Update all module checkboxes to match
      document.querySelectorAll('.module-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
        checkbox.indeterminate = false;
      });

      console.log('[DEBUG] Select All checkbox complete');
    });
  }

  // Function to update the select all checkbox state
  function updateSelectAllCheckboxState() {
    if (!selectAllCheckbox) return;

    const allItems = document.querySelectorAll('.material-item');
    const selectedItems = Array.from(allItems).filter(item => item.getAttribute('data-selected') === 'true');

    const allSelected = selectedItems.length === allItems.length && allItems.length > 0;
    const someSelected = selectedItems.length > 0 && selectedItems.length < allItems.length;
    const noneSelected = selectedItems.length === 0;

    console.log('[DEBUG] Updating Select All checkbox:', {
      totalItems: allItems.length,
      selectedItems: selectedItems.length,
      allSelected,
      someSelected,
      noneSelected
    });

    if (allSelected) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else if (someSelected) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true; // Show minus
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
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
            // Update module checkbox for each affected module
            const itemModuleDiv = allItems[i].closest('.material-module');
            if (itemModuleDiv) {
              updateModuleCheckboxState(itemModuleDiv);
            }
          }
        }
      } else {
        // Normal click - toggle selection
        const isSelected = materialItem.getAttribute('data-selected') === 'true';
        materialItem.setAttribute('data-selected', isSelected ? 'false' : 'true');
      }

      // Update module checkbox state after selection change
      const moduleDiv = materialItem.closest('.material-module');
      if (moduleDiv) {
        updateModuleCheckboxState(moduleDiv);
      }

      // Update select all checkbox state
      updateSelectAllCheckboxState();

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
          // HASH-BASED: Open file through extension's PDF viewer
          // This shows Chrome extension icon/URL instead of GCS URL

          console.log('🔍 [CHAT] Opening file through PDF viewer');
          console.log('🔍 [CHAT] File item data:', {
            fileName,
            hash: fileItem.hash,
            doc_id: fileItem.doc_id,
            type: fileItem.type,
            fullFileItem: fileItem
          });

          // Use hash if available, otherwise fall back to filename
          let fileIdentifier = fileName;
          if (fileItem.hash) {
            fileIdentifier = fileItem.hash;
            console.log(`✅ [CHAT] Using hash as fileIdentifier: ${fileIdentifier.substring(0, 16)}...`);
          } else if (fileItem.doc_id) {
            // Extract hash from doc_id if available
            const parts = fileItem.doc_id.split('_');
            console.log(`🔍 [CHAT] doc_id parts after split:`, parts);
            if (parts.length === 2) {
              fileIdentifier = parts[1];
              console.log(`✅ [CHAT] Extracted hash from doc_id: ${fileIdentifier.substring(0, 16)}...`);
            } else {
              console.warn(`⚠️ [CHAT] File "${fileName}" has unexpected doc_id format: ${fileItem.doc_id}`);
              console.warn(`⚠️ [CHAT] Falling back to filename (may fail)`);
            }
          } else {
            console.warn(`⚠️ [CHAT] File "${fileName}" missing both hash and doc_id fields`);
            console.warn(`⚠️ [CHAT] Using filename as identifier (may fail)`);
          }

          console.log('🔍 [CHAT] Final fileIdentifier:', fileIdentifier);
          console.log('🔍 [CHAT] courseId:', courseId);

          // Open through extension's PDF viewer (shows extension icon/URL)
          const viewerUrl = chrome.runtime.getURL('pdf-viewer.html') +
            `?course=${encodeURIComponent(courseId)}` +
            `&file=${encodeURIComponent(fileIdentifier)}` +
            `&name=${encodeURIComponent(fileName)}`;

          console.log('🔍 [CHAT] Constructed viewer URL:', viewerUrl);
          console.log('✅ [CHAT] Creating new tab with PDF viewer...');

          chrome.tabs.create({ url: viewerUrl });
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
            if (item.type === 'File' && item.doc_id) {
              // Use original filename for display, doc_id for identification
              const displayName = item.original_name || item.title || item.name;
              fileOptions.push({
                docId: item.doc_id,  // Hash-based ID
                name: displayName    // Original filename
              });
            }
          });
        }
      });
    }

    // Collect standalone files
    if (processedMaterials.files) {
      processedMaterials.files.forEach(file => {
        if (file.doc_id) {
          // Use original filename for display, doc_id for identification
          const displayName = file.original_name || file.name || file.display_name;
          fileOptions.push({
            docId: file.doc_id,  // Hash-based ID
            name: displayName    // Original filename
          });
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
    const syllabusCurrentEl = document.getElementById('syllabus-current');
    if (data.success && data.syllabus_id) {
      syllabusSelect.value = data.syllabus_id;
      if (syllabusCurrentEl) {
        syllabusCurrentEl.textContent = 'selected';
        syllabusCurrentEl.style.color = 'var(--green-primary)';
      }
      console.log('📚 Loaded syllabus:', data.syllabus_name);
    } else {
      if (syllabusCurrentEl) {
        syllabusCurrentEl.textContent = '';
        syllabusCurrentEl.style.color = 'var(--text-secondary)';
      }
    }

    // Handle selection change - auto-save
    syllabusSelect.addEventListener('change', async () => {
      const selectedSyllabusId = syllabusSelect.value;

      // Update status text immediately
      const syllabusCurrentEl = document.getElementById('syllabus-current');
      if (syllabusCurrentEl) {
        if (selectedSyllabusId) {
          syllabusCurrentEl.textContent = 'selected';
          syllabusCurrentEl.style.color = 'var(--green-primary)';
        } else {
          syllabusCurrentEl.textContent = '';
          syllabusCurrentEl.style.color = 'var(--text-secondary)';
        }
      }

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
          // CRITICAL: For materials that have stored_name, use it (has correct extension)
          // For materials without stored_name, use original name and add .pdf if missing
          if (fileItem.stored_name) {
            materialName = fileItem.stored_name;
          } else {
            materialName = fileItem.title || fileItem.name;
            // If no extension, add .pdf (most common case)
            if (materialName && !materialName.match(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i)) {
              materialName = materialName + '.pdf';
            }
          }
        }
      }
    }
    // Handle standalone files, pages, assignments
    else if (category && index !== null) {
      const fileItem = processedMaterials[category]?.[parseInt(index)];
      if (fileItem) {
        // CRITICAL: For materials that have stored_name, use it (has correct extension)
        // For materials without stored_name, use original name and add .pdf if missing
        if (fileItem.stored_name) {
          materialName = fileItem.stored_name;
        } else {
          materialName = fileItem.name || fileItem.display_name || fileItem.title;
          // If no extension, add .pdf (most common case)
          if (materialName && !materialName.match(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i)) {
            materialName = materialName + '.pdf';
          }
        }
      }
    }

    // HASH-BASED: Get doc_id from material object
    let docId = null;

    // Try to get material object to check for doc_id/id field
    let materialObj = null;
    if (moduleIdx !== null && itemIdx !== null) {
      // Module item
      const module = processedMaterials.modules?.[parseInt(moduleIdx)];
      materialObj = module?.items?.[parseInt(itemIdx)];
    } else if (category && index !== null) {
      // Standalone file
      materialObj = processedMaterials[category]?.[parseInt(index)];
    }

    // CRITICAL: Materials MUST have doc_id or id field (hash-based)
    if (materialObj && (materialObj.doc_id || materialObj.id)) {
      docId = materialObj.doc_id || materialObj.id;
      console.log(`📄 Selected: "${materialName}" → ID: "${docId}"`);
    } else {
      console.error(`❌ Material missing hash-based ID: "${materialName}"`, materialObj);
      console.error(`   This file may not have been uploaded with the hash-based system`);
      console.error(`   Please re-upload course files after purging GCS`);
      // Skip this file - don't add to docIds
      return;
    }

    if (docId) {
      docIds.push(docId);
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
          // HASH-BASED: MUST have doc_id or id field
          if (item.doc_id || item.id) {
            return item.doc_id || item.id;
          }
          // If no hash-based ID, this is a problem
          console.error('❌ Syllabus found but missing hash-based ID', item);
          console.error('   Please re-upload course files after purging GCS');
          return null;
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
      showError('Python backend is not running. Please start the backend server.');
      return;
    }

    // Connect WebSocket
    try {
      // Set up connection state change handler
      wsClient.onConnectionStateChange = (state) => {
        switch (state) {
          case 'connected':
            elements.sendBtn.disabled = false;
            break;
          case 'reconnecting':
            break;
          case 'stale':
            break;
          case 'offline':
            elements.sendBtn.disabled = true;
            break;
        }
      };

      await wsClient.connect(courseId);
      elements.sendBtn.disabled = false;
      console.log('Connected to backend');
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      showError('Failed to connect to backend: ' + error.message);
    }
  } catch (error) {
    console.error('Error connecting to backend:', error);
    showError('Failed to initialize backend connection: ' + error.message);
  }
}

/**
 * Update input placeholder based on current mode
 */
function updatePlaceholder() {
  const defaultPlaceholder = "Ask a question about your course materials...";
  const modePlaceholder = "What are you studying for?";

  if (elements.messageInput) {
    // If in a mode but prompt already used, show default placeholder
    // Otherwise show mode-specific placeholder
    if (currentMode && !modePromptUsed) {
      elements.messageInput.placeholder = modePlaceholder;
    } else {
      elements.messageInput.placeholder = defaultPlaceholder;
    }
  }
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

  // Compact mode buttons with toggle/switch behavior
  document.querySelectorAll('.mode-btn-compact').forEach(btn => {
    btn.addEventListener('click', () => {
      const btnText = btn.textContent.trim().toLowerCase();
      const clickedMode = btnText; // 'learn', 'reinforce', or 'test'

      // Get smart file selection toggle
      const smartFileToggle = document.getElementById('smart-file-icon-toggle');

      // Toggle logic: if same button clicked, deactivate mode
      if (currentMode === clickedMode) {
        currentMode = null;
        modePromptUsed = false;
        btn.classList.remove('active');

        // Turn off smart file selection when exiting mode
        if (smartFileToggle) {
          smartFileToggle.classList.remove('active');
        }
      } else {
        // Switch to new mode or activate mode
        // Remove active class from all buttons
        document.querySelectorAll('.mode-btn-compact').forEach(b => b.classList.remove('active'));

        // Set new mode and add active class
        currentMode = clickedMode;
        modePromptUsed = false; // Reset flag when entering/switching modes
        btn.classList.add('active');

        // Turn on smart file selection by default for study modes
        if (smartFileToggle) {
          smartFileToggle.classList.add('active');
          console.log('Smart File Selection enabled for study mode:', clickedMode);

          // Show toast notification
          showToast('Smart Select is ON. Toggle off to use your manual selection.', 5000);
        }
      }

      // Update placeholder based on mode
      updatePlaceholder();

      // Focus on input
      elements.messageInput.focus();
    });
  });

  // New chat
  elements.newChatBtn.addEventListener('click', () => {
    // Generate new session ID
    currentSessionId = `session_${courseId}_${Date.now()}`;
    conversationHistory = [];
    elements.messagesContainer.innerHTML = '';
    elements.messagesContainer.appendChild(createWelcomeMessage());
    // Reset mode prompt flag so it can be used again in new chat
    modePromptUsed = false;
    // Clear mode response cache for fresh start
    modeResponseCache = {};
    currentModeTopic = null;
    console.log('🗑️ Cleared mode response cache for new chat');
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
      'This will PERMANENTLY delete all your uploaded files from our servers, all chat history, and all course materials. This action cannot be undone. Continue?'
    );
    if (confirmed) {
      try {
        // Get Canvas user ID for backend deletion
        const canvasUserId = await StorageManager.getCanvasUserId();

        if (canvasUserId) {
          // Delete all user data from backend (GCS, database)
          const backendUrl = 'https://web-production-9aaba7.up.railway.app';
          console.log(`🗑️  Deleting all backend data for user ${canvasUserId}...`);

          const response = await fetch(`${backendUrl}/users/${canvasUserId}/data`, {
            method: 'DELETE'
          });

          if (response.ok) {
            const result = await response.json();
            console.log('✅ Backend data deleted:', result);
          } else {
            console.error('❌ Failed to delete backend data:', response.status);
            // Continue with local cleanup even if backend fails
          }
        } else {
          console.warn('⚠️  No Canvas user ID found, skipping backend deletion');
        }

        // Clear local storage (IndexedDB, chrome.storage.local)
        const materialsDB = new MaterialsDB();
        const courseIds = await materialsDB.listCourses();
        for (const courseId of courseIds) {
          await materialsDB.deleteMaterials(courseId);
        }
        await materialsDB.close();

        await StorageManager.clearAll();
        console.log('✅ All local data cleared');

        // Redirect to popup to set up Canvas authentication
        window.location.href = '../popup/popup-v2.html';
      } catch (error) {
        console.error('❌ Error clearing all data:', error);
        alert('An error occurred while clearing data. Please try again.');
      }
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

  // Course switcher dropdown toggle (28px thin dropdown with click-outside-to-close)
  const courseSwitcherBtn = document.getElementById('course-switcher-sidebar-btn');
  const courseDropdown = document.getElementById('course-dropdown-sidebar');

  if (courseSwitcherBtn && courseDropdown) {
    // Toggle dropdown on button click
    courseSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = courseDropdown.classList.contains('hidden');
      courseDropdown.classList.toggle('hidden');
      courseSwitcherBtn.classList.toggle('active');

      // Focus management for accessibility
      if (!isHidden) {
        courseSwitcherBtn.focus();
      }
    });

    // Close dropdown when clicking outside (click-outside-to-close)
    document.addEventListener('click', (e) => {
      const courseSwitcherHeader = e.target.closest('.course-switcher-header');
      if (!courseSwitcherHeader && !courseDropdown.classList.contains('hidden')) {
        courseDropdown.classList.add('hidden');
        courseSwitcherBtn.classList.remove('active');
      }
    });

    // Close dropdown on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !courseDropdown.classList.contains('hidden')) {
        courseDropdown.classList.add('hidden');
        courseSwitcherBtn.classList.remove('active');
        courseSwitcherBtn.focus();
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

  // Materials search/filter functionality
  const materialsSearchInput = document.getElementById('materials-search');
  const materialsSearchClear = document.getElementById('materials-search-clear');

  if (materialsSearchInput) {
    materialsSearchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();

      // Show/hide clear button
      if (materialsSearchClear) {
        materialsSearchClear.classList.toggle('hidden', searchTerm === '');
      }

      // Filter materials
      const materialItems = document.querySelectorAll('.material-item');
      let visibleCount = 0;

      materialItems.forEach(item => {
        const fileNameLabel = item.querySelector('.material-label');
        const fileName = fileNameLabel?.textContent.toLowerCase() || '';
        const matches = searchTerm === '' || fileName.includes(searchTerm);
        item.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
      });

      // Also filter module headers if they exist
      const moduleHeaders = document.querySelectorAll('.module-header');
      moduleHeaders.forEach(header => {
        const moduleItems = header.nextElementSibling?.querySelectorAll('.material-item') || [];
        const hasVisibleItems = Array.from(moduleItems).some(item => item.style.display !== 'none');
        const moduleContainer = header.parentElement;
        if (moduleContainer) {
          moduleContainer.style.display = hasVisibleItems ? '' : 'none';
        }
      });
    });

    // Clear search
    if (materialsSearchClear) {
      materialsSearchClear.addEventListener('click', () => {
        materialsSearchInput.value = '';
        materialsSearchInput.dispatchEvent(new Event('input'));
        materialsSearchInput.focus();
      });
    }
  }

  // Toggle icon buttons functionality
  const webSearchIconToggle = document.getElementById('web-search-icon-toggle');
  const smartFileIconToggle = document.getElementById('smart-file-icon-toggle');

  // Web Search toggle
  if (webSearchIconToggle) {
    webSearchIconToggle.addEventListener('click', async () => {
      webSearchIconToggle.classList.toggle('active');

      // Save state to storage
      const isActive = webSearchIconToggle.classList.contains('active');
      await chrome.storage.local.set({ enable_web_search: isActive });

      // Sync with settings modal toggle
      const settingsToggle = document.getElementById('web-search-toggle');
      if (settingsToggle) {
        settingsToggle.checked = isActive;
      }
    });

    // Position tooltip dynamically
    const webSearchTooltip = webSearchIconToggle.querySelector('.toggle-icon-tooltip');
    if (webSearchTooltip) {
      webSearchIconToggle.addEventListener('mouseenter', () => {
        const rect = webSearchIconToggle.getBoundingClientRect();
        webSearchTooltip.style.left = `${rect.left + rect.width / 2}px`;
        webSearchTooltip.style.top = `${rect.top - 8}px`;
        webSearchTooltip.style.transform = 'translate(-50%, -100%)';
      });
    }
  }

  // Smart File Selection toggle
  if (smartFileIconToggle) {
    smartFileIconToggle.addEventListener('click', () => {
      smartFileIconToggle.classList.toggle('active');
    });

    // Position tooltip dynamically
    const smartFileTooltip = smartFileIconToggle.querySelector('.toggle-icon-tooltip');
    if (smartFileTooltip) {
      smartFileIconToggle.addEventListener('mouseenter', () => {
        const rect = smartFileIconToggle.getBoundingClientRect();
        smartFileTooltip.style.left = `${rect.left + rect.width / 2}px`;
        smartFileTooltip.style.top = `${rect.top - 8}px`;
        smartFileTooltip.style.transform = 'translate(-50%, -100%)';
      });
    }
  }

  // File upload handler
  const uploadBtn = document.getElementById('upload-files-btn');
  const fileInput = document.getElementById('file-upload-input');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', handleFileUpload);
  }

  // Drag and drop file upload on sidebar
  const sidebarContent = document.querySelector('.sidebar-content');
  if (sidebarContent) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      sidebarContent.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Highlight drop area when dragging over
    ['dragenter', 'dragover'].forEach(eventName => {
      sidebarContent.addEventListener(eventName, () => {
        sidebarContent.classList.add('drag-over');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      sidebarContent.addEventListener(eventName, () => {
        sidebarContent.classList.remove('drag-over');
      }, false);
    });

    // Handle dropped files
    sidebarContent.addEventListener('drop', handleFileDrop, false);
  }

  /**
   * Handle files dropped on sidebar
   */
  async function handleFileDrop(e) {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);

    if (files.length === 0) return;

    console.log(`📤 User dropped ${files.length} file(s):`, files.map(f => f.name));

    // Create a synthetic event to pass to handleFileUpload
    const syntheticEvent = {
      target: {
        files: files,
        value: ''
      }
    };

    await handleFileUpload(syntheticEvent);
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
      // Handle clicking on the module checkbox to select/deselect all files in module
      const moduleCheckbox = moduleHeader.querySelector('.module-checkbox');
      if (e.target === moduleCheckbox) {
        e.stopPropagation(); // Don't trigger collapse/expand

        const moduleDiv = moduleHeader.closest('.material-module');
        const itemsDiv = moduleDiv.querySelector('.module-items');
        const materialItems = itemsDiv.querySelectorAll('.material-item');

        // Toggle all files in this module
        const isChecked = moduleCheckbox.checked;
        materialItems.forEach(item => {
          item.setAttribute('data-selected', isChecked ? 'true' : 'false');
        });

        // Update the select-all checkbox state inline
        const selectAllCheckbox = document.getElementById('select-all-materials-checkbox');
        if (selectAllCheckbox) {
          const allMaterialItems = document.querySelectorAll('.material-item');
          const selectedItems = Array.from(allMaterialItems).filter(item => item.getAttribute('data-selected') === 'true');
          const allSelected = selectedItems.length === allMaterialItems.length && allMaterialItems.length > 0;
          const someSelected = selectedItems.length > 0 && selectedItems.length < allMaterialItems.length;

          if (allSelected) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
          } else if (someSelected) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
          } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
          }
        }

        console.log(`Module checkbox ${isChecked ? 'checked' : 'unchecked'}: ${materialItems.length} files ${isChecked ? 'selected' : 'deselected'}`);
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
      console.log('[DEBUG] Module checkbox change detected!', e.target.id, 'checked:', e.target.checked);
      e.stopPropagation();
      const moduleDiv = e.target.closest('.material-module');
      console.log('[DEBUG] Module div found:', moduleDiv);
      const itemsDiv = moduleDiv.querySelector('.module-items');
      const materialItems = itemsDiv.querySelectorAll('.material-item');
      console.log('[DEBUG] Found', materialItems.length, 'material items to toggle');

      // Set data-selected attribute on all material items
      const selectedValue = e.target.checked ? 'true' : 'false';
      materialItems.forEach(item => {
        item.setAttribute('data-selected', selectedValue);
      });

      // Update select all checkbox state
      updateSelectAllCheckboxState();

      console.log('[DEBUG] Module checkbox toggling complete - set all items to', selectedValue);
    }
  });

  // Individual material checkbox - update module checkbox state using event delegation
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('material-checkbox')) {
      console.log('[DEBUG] Material checkbox change detected!', e.target.id, 'checked:', e.target.checked);
      const moduleDiv = e.target.closest('.material-module');
      if (moduleDiv) {
        const itemsDiv = moduleDiv.querySelector('.module-items');
        const moduleCheckbox = moduleDiv.querySelector('.module-checkbox');
        const itemCheckboxes = itemsDiv.querySelectorAll('.material-checkbox');

        const allChecked = Array.from(itemCheckboxes).every(cb => cb.checked);
        const noneChecked = Array.from(itemCheckboxes).every(cb => !cb.checked);

        console.log('[DEBUG] Updating module checkbox - allChecked:', allChecked, 'noneChecked:', noneChecked);
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

  // Reset progress bar
  const progressFill = document.getElementById('loading-progress-fill');
  if (progressFill) {
    progressFill.style.width = '0%';
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

  // Mark last message as stopped and display system message
  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    lastMessage.content += '\n\n_(Generation stopped by user)_';
  }

  // Display system message in UI
  addMessage('system', 'Response stopped by user');
}

/**
 * Send a message to the AI assistant via Python backend
 */
async function sendMessage() {
  const userInput = elements.messageInput.value.trim();

  if (!userInput) return;
  if (!wsClient || !wsClient.isReady()) {
    showError('Not connected to backend. Please check that the server is running.');
    return;
  }

  // Build the full prompt if in a mode (only on first message)
  let message = userInput;
  let displayMessage = userInput; // What to show in the chat bubble

  if (currentMode && !modePromptUsed && modePrompts[currentMode]) {
    // Store the topic for this mode session (case-insensitive)
    currentModeTopic = userInput.toLowerCase().trim();

    // Replace {userInput} placeholder with actual user input
    message = modePrompts[currentMode].replace(/{userInput}/g, userInput);
    displayMessage = userInput; // Still show just the user's input in the chat

    // Check if we're in Reinforce or Test mode and have cached previous mode conversations
    if (currentMode === 'reinforce' && modeResponseCache[currentModeTopic]?.learn) {
      // Reinforce mode: Inject full Learn conversation
      const learnConversation = modeResponseCache[currentModeTopic].learn;
      const conversationText = learnConversation.map(msg =>
        `${msg.role === 'user' ? 'Student' : 'Assistant'}: ${msg.content}`
      ).join('\n\n');

      let splitPattern = '\n\nFollow these steps:';
      const promptParts = message.split(splitPattern);

      if (promptParts.length === 2) {
        message = promptParts[0] +
                  `\n\n**IMPORTANT CONTEXT:** Previously, you had this complete conversation with the student about this topic:\n\n` +
                  `--- BEGIN PREVIOUS LEARN MODE CONVERSATION ---\n${conversationText}\n--- END PREVIOUS LEARN MODE CONVERSATION ---\n\n` +
                  `You MUST base your exercises directly on the concepts, terminology, and information covered in that conversation above.\n\n` +
                  splitPattern + promptParts[1];
      }

      console.log(`🔗 Injected Learn conversation (${learnConversation.length} messages) into Reinforce mode`);
      showToast('Using Learn mode context', 3000);

    } else if (currentMode === 'test' && modeResponseCache[currentModeTopic]) {
      // Test mode: Inject both Learn AND Reinforce conversations
      const contexts = [];

      if (modeResponseCache[currentModeTopic].learn) {
        const learnConversation = modeResponseCache[currentModeTopic].learn;
        const learnText = learnConversation.map(msg =>
          `${msg.role === 'user' ? 'Student' : 'Assistant'}: ${msg.content}`
        ).join('\n\n');
        contexts.push(`--- LEARN MODE CONVERSATION ---\n${learnText}`);
      }

      if (modeResponseCache[currentModeTopic].reinforce) {
        const reinforceConversation = modeResponseCache[currentModeTopic].reinforce;
        const reinforceText = reinforceConversation.map(msg =>
          `${msg.role === 'user' ? 'Student' : 'Assistant'}: ${msg.content}`
        ).join('\n\n');
        contexts.push(`--- REINFORCE MODE CONVERSATION ---\n${reinforceText}`);
      }

      if (contexts.length > 0) {
        let splitPattern = '\n\nThe test must contain the following sections:';
        const promptParts = message.split(splitPattern);

        if (promptParts.length === 2) {
          message = promptParts[0] +
                    `\n\n**IMPORTANT CONTEXT:** Previously, you had these conversations with the student about this topic:\n\n` +
                    contexts.join('\n\n') + '\n\n' +
                    `You MUST base your test directly on the concepts, terminology, and information covered in those conversations above.\n\n` +
                    splitPattern + promptParts[1];
        }

        console.log(`🔗 Injected ${contexts.length} mode conversation(s) into Test mode`);
        showToast('Using Learn & Reinforce mode context', 3000);
      }
    }

    // Mark that the mode prompt has been used
    modePromptUsed = true;
    console.log(`📝 Applied ${currentMode} mode prompt. Subsequent messages will be normal conversation.`);

    // Update placeholder to normal after first mode message
    if (elements.messageInput) {
      elements.messageInput.placeholder = "Ask a question about your course materials...";
    }
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

  // Add user message (show the original user input, not the full prompt)
  addMessage('user', displayMessage);

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
    const smartFileIconToggle = document.getElementById('smart-file-icon-toggle');
    const useSmartSelection = smartFileIconToggle ? smartFileIconToggle.classList.contains('active') : false;

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
          // Remove emoji and file size information from loading message
          const cleanedMessage = chunk
            .replace(/📤\s*/, '')  // Remove emoji
            .replace(/\*\*/g, '')   // Remove bold markdown
            .replace(/\s*\(~[\d.]+MB\)/g, '');  // Remove file size
          showLoadingBanner(cleanedMessage);
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
    // IMPORTANT: Store the displayMessage (user's actual input) not the full mode prompt
    // This prevents mode instructions from persisting in history after mode is deselected
    conversationHistory.push({ role: 'user', content: displayMessage });
    conversationHistory.push({ role: 'assistant', content: assistantMessage });

    // Cache the full conversation if we're in a mode and have a topic
    if (currentMode && currentModeTopic) {
      // Initialize cache for this topic if it doesn't exist
      if (!modeResponseCache[currentModeTopic]) {
        modeResponseCache[currentModeTopic] = {};
      }

      // Store the entire conversation for this mode (only the messages from this mode session)
      // Filter conversation to only include messages from when this mode started
      const modeConversation = [];

      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        modeConversation.unshift(msg);

        // Check if this is the user message that started the mode (contains the topic)
        if (msg.role === 'user' && msg.content.includes(currentModeTopic)) {
          break;
        }
      }

      modeResponseCache[currentModeTopic][currentMode] = modeConversation;
      console.log(`💾 Cached ${currentMode} conversation (${modeConversation.length} messages) for topic: "${currentModeTopic}"`);
    }

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
  // Regex to match: [Source: DocumentName, Page X] or [Source: DocumentName, Pages X-Y] or [Source: DocumentName, Page X, Y, Z]
  const citationRegex = /\[Source:\s*([^,]+),\s*Pages?\s*([0-9,\s\-]+)\]/gi;

  return content.replace(citationRegex, (match, docName, pageInfo) => {
    // Clean up document name (trim whitespace)
    const cleanDocName = docName.trim();

    // Parse page info - handle ranges (5-7), lists (5, 6, 7), or single pages (5)
    const pages = [];

    // Split by comma first
    const parts = pageInfo.split(',');
    for (const part of parts) {
      const trimmedPart = part.trim();

      // Check if it's a range (e.g., "5-7")
      if (trimmedPart.includes('-')) {
        const [start, end] = trimmedPart.split('-').map(p => parseInt(p.trim()));
        if (!isNaN(start) && !isNaN(end)) {
          // Add all pages in range
          for (let i = start; i <= end; i++) {
            pages.push(i);
          }
        }
      } else {
        // Single page
        const page = parseInt(trimmedPart);
        if (!isNaN(page)) {
          pages.push(page);
        }
      }
    }

    // Create a citation block for each page
    if (pages.length === 0) {
      // Fallback if no pages parsed
      return match;
    } else if (pages.length === 1) {
      // Single page - one citation block
      return `<a href="#" class="citation-link" data-doc-name="${cleanDocName}" data-page="${pages[0]}" title="Open ${cleanDocName} at page ${pages[0]}">${cleanDocName}, p.${pages[0]}</a>`;
    } else {
      // Multiple pages - create multiple citation blocks next to each other
      return pages.map(page =>
        `<a href="#" class="citation-link" data-doc-name="${cleanDocName}" data-page="${page}" title="Open ${cleanDocName} at page ${page}">${cleanDocName}, p.${page}</a>`
      ).join(' ');
    }
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
 * Enhance academic content formatting in HTML
 * Detects patterns like multiple choice options, matching questions, etc.
 */
function enhanceAcademicFormatting(html) {
  try {
    // Wrap multiple choice options in styled containers
    // Detects paragraphs starting with A), B), C), D), E)
    html = html.replace(/<p>([A-E])\)\s*([^<]+)<\/p>/gi, (match, letter, content) => {
      return `<p class="multiple-choice-option"><strong>${letter})</strong> ${content}</p>`;
    });

    // Detect and enhance matching questions
    // Look for "Column A" or "Column B" patterns
    if (html.includes('Column A') && html.includes('Column B')) {
      // Try to wrap consecutive lists after Column A/B headings in a two-column container
      html = html.replace(
        /(<(?:h3|h4|p|strong)[^>]*>.*?Column A.*?<\/(?:h3|h4|p|strong)>)(.*?)(<(?:h3|h4|p|strong)[^>]*>.*?Column B.*?<\/(?:h3|h4|p|strong)>)(.*?)(?=<(?:h[1-6]|p(?!<)|div))/gis,
        (match, colAHeader, colAContent, colBHeader, colBContent) => {
          return `
            <div class="matching-container">
              <div class="matching-column">
                ${colAHeader}
                ${colAContent}
              </div>
              <div class="matching-column">
                ${colBHeader}
                ${colBContent}
              </div>
            </div>
          `;
        }
      );
    }

    // Add special class to paragraphs with question numbers
    html = html.replace(/<p><strong>(\d+)\.<\/strong>\s*/gi, '<p class="question-number"><strong>$1.</strong> ');

    return html;
  } catch (e) {
    console.error('Error enhancing academic formatting:', e);
    return html;
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

    // HASH-BASED: Open file from backend/GCS with page parameter using content hash
    // Backend will append #page=X to the GCS signed URL
    const backendUrl = 'https://web-production-9aaba7.up.railway.app';

    // Use hash if available, otherwise fall back to filename
    let fileIdentifier = fileName;
    if (fileItem.hash) {
      fileIdentifier = fileItem.hash;
      console.log(`Opening citation with hash: ${fileIdentifier.substring(0, 16)}... at page ${pageNum}`);
    } else {
      console.warn(`File "${fileName}" missing hash field - using filename (may fail)`);
    }

    const fileUrl = `${backendUrl}/pdfs/${encodeURIComponent(courseId)}/${encodeURIComponent(fileIdentifier)}?page=${pageNum}`;
    chrome.tabs.create({ url: fileUrl });
  } catch (error) {
    console.error('Error opening cited document:', error);
    showError(`Error opening document: ${error.message}`);
  }
}

function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}-message`;

  // System messages have a simpler layout
  if (role === 'system') {
    messageDiv.innerHTML = `
      <div class="message-content">
        <div class="message-text">${content}</div>
      </div>
    `;
    elements.messagesContainer.appendChild(messageDiv);
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    return;
  }

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
  let renderedContent = role === 'assistant' ? marked.parse(processedContent) : content;

  // Step 4: Enhance academic formatting (for assistant messages only)
  if (role === 'assistant') {
    renderedContent = enhanceAcademicFormatting(renderedContent);
  }

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
          <button class="copy-message-btn" data-content="${content.replace(/"/g, '&quot;')}">Copy</button>
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
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
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

    // Render markdown and enhance academic formatting
    let renderedContent = marked.parse(processedContent);
    renderedContent = enhanceAcademicFormatting(renderedContent);

    textDiv.innerHTML = renderedContent;
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

/**
 * Show a toast notification that auto-dismisses
 * @param {string} message - Message to display
 * @param {number} duration - Duration in milliseconds (default 5000)
 */
function showToast(message, duration = 5000) {
  // Check if toast already exists, remove it
  let existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Show toast with animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  // Hide and remove toast after duration
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');

    // Remove from DOM after animation completes
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, duration);
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
  chrome.storage.local.get(['theme-preference'], (result) => {
    const savedTheme = result['theme-preference'] || 'dark';
    applyTheme(savedTheme);
  });

  // Set up theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Listen for storage changes (theme sync between popup and chat)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['theme-preference']) {
      const newTheme = changes['theme-preference'].newValue;
      if (newTheme) {
        applyTheme(newTheme);
      }
    }
  });
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);

  // Save theme preference
  chrome.storage.local.set({ 'theme-preference': newTheme });
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
  const iconToggle = document.getElementById('web-search-icon-toggle');
  const settingsToggle = document.getElementById('web-search-toggle');

  if (!iconToggle) return;

  // Load saved state
  const settings = await chrome.storage.local.get(['enable_web_search']);
  const isEnabled = settings.enable_web_search || false;

  // Set initial state
  if (isEnabled) {
    iconToggle.classList.add('active');
  }
  if (settingsToggle) {
    settingsToggle.checked = isEnabled;
  }

  // Listen for changes on settings modal toggle (to keep them in sync)
  if (settingsToggle) {
    settingsToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({
        enable_web_search: settingsToggle.checked
      });

      // Sync with icon toggle
      if (settingsToggle.checked) {
        iconToggle.classList.add('active');
      } else {
        iconToggle.classList.remove('active');
      }
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