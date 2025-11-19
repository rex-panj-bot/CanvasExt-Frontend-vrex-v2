/**
 * Background Service Worker
 * Handles message passing and background operations
 */

console.log('Canvas Material Extractor: Service worker loaded');

/**
 * Update extension icon based on theme
 */
async function updateIconForTheme(scheme) {
  const isDark = scheme === 'dark';
  // File naming: lightmodelogo = dark lines, darkmodelogo = light lines
  // DARK browser needs darkmodelogo (light lines for visibility)
  // LIGHT browser needs lightmodelogo (dark lines for visibility)
  const logoFile = isDark ? 'darkmodelogo.png' : 'lightmodelogo.png';

  console.log(`🎨 [UPDATE ICON] ===============================================`);
  console.log(`🎨 [UPDATE ICON] Scheme: "${scheme}"`);
  console.log(`🎨 [UPDATE ICON] Is dark mode: ${isDark}`);
  console.log(`🎨 [UPDATE ICON] Logo file: "${logoFile}"`);
  console.log(`🎨 [UPDATE ICON] Logic: ${isDark ? 'DARK browser → darkmodelogo (light lines)' : 'LIGHT browser → lightmodelogo (dark lines)'}`);
  console.log(`🎨 [UPDATE ICON] ===============================================`);

  try {
    // Method 1: Try loading as ImageData (most reliable for service workers)
    const imagePath = `icons/${logoFile}`;
    const imageUrl = chrome.runtime.getURL(imagePath);

    console.log(`🎨 [UPDATE ICON] Fetching image from: ${imageUrl}`);

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    console.log(`🎨 [UPDATE ICON] Original image size: ${bitmap.width}x${bitmap.height}`);

    // Chrome requires SQUARE icons - resize to 128x128
    const size = 128;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Stretch the image to fill the entire 128x128 square
    // This ensures the icon fills the toolbar space properly
    ctx.drawImage(bitmap, 0, 0, size, size);

    const imageData = ctx.getImageData(0, 0, size, size);

    console.log(`🎨 [UPDATE ICON] Stretched to square: ${size}x${size}`);

    // Set the icon using ImageData
    await chrome.action.setIcon({ imageData: imageData });
    console.log(`✅ [UPDATE ICON SUCCESS] Toolbar icon updated to ${logoFile} using ImageData`);

  } catch (error) {
    console.error('❌ [UPDATE ICON ERROR] Failed with ImageData method:', error);

    // Method 2: Fallback to path-based method
    console.log('🔄 [UPDATE ICON RETRY] Trying path-based method...');
    try {
      await chrome.action.setIcon({
        path: {
          '16': `icons/${logoFile}`,
          '48': `icons/${logoFile}`,
          '128': `icons/${logoFile}`
        }
      });
      console.log(`✅ [UPDATE ICON RETRY SUCCESS] Icon updated using path`);
    } catch (pathError) {
      console.error('❌ [UPDATE ICON RETRY FAILED]:', pathError);
    }
  }
}

/**
 * Initialize icon based on stored preference or system default
 */
async function initializeIcon() {
  console.log('🎨 [INIT] Starting icon initialization...');

  // Try to get stored preference
  const result = await chrome.storage.local.get(['theme-preference']);
  const storedTheme = result['theme-preference'];

  console.log(`🎨 [INIT] Stored theme preference: ${storedTheme || 'none'}`);

  if (storedTheme) {
    console.log(`🎨 [INIT] Using stored theme: ${storedTheme}`);
    updateIconForTheme(storedTheme);
  } else {
    // Default to dark mode if no preference stored (assuming dark browser UI is more common)
    console.log('🎨 [INIT] No theme preference found, defaulting to dark mode');
    updateIconForTheme('dark');
  }
}

// Initialize icon immediately when service worker loads
initializeIcon();

// Also initialize on install/startup events
chrome.runtime.onInstalled.addListener(() => {
  console.log('🎨 Service worker installed, initializing icon');
  initializeIcon();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('🎨 Browser started, initializing icon');
  initializeIcon();
  // Check for incomplete uploads and resume
  checkAndResumeUploads();
});

// Listen for theme preference changes (when theme-manager.js updates storage)
chrome.storage.onChanged.addListener((changes, areaName) => {
  console.log(`📦 [STORAGE LISTENER] Storage changed in ${areaName}:`, Object.keys(changes));

  if (areaName === 'local' && changes['theme-preference']) {
    const oldTheme = changes['theme-preference'].oldValue;
    const newTheme = changes['theme-preference'].newValue;
    console.log(`🎨 [STORAGE LISTENER] Theme preference changed: "${oldTheme}" → "${newTheme}"`);
    console.log(`🎨 [STORAGE LISTENER] Calling updateIconForTheme('${newTheme}')...`);
    updateIconForTheme(newTheme);
  }
});

// Store current course info
let currentCourseInfo = null;

// Store upload files in memory (not in chrome.storage to avoid quota issues)
let uploadFilesQueue = null;

/**
 * Check for incomplete uploads and resume them (called on service worker startup)
 */
async function checkAndResumeUploads() {
  try {
    // Check chrome.storage.local for active upload task
    const result = await chrome.storage.local.get(['uploadTask']);
    const task = result.uploadTask;

    if (!task || task.status !== 'uploading') {
      console.log('✅ No incomplete uploads to resume');
      return;
    }

    // Check if task is stale (older than 10 minutes)
    const ageMinutes = (Date.now() - task.startTime) / 1000 / 60;
    if (ageMinutes > 10) {
      console.log(`⚠️ Upload task is stale (${ageMinutes.toFixed(1)} minutes old), cleaning up...`);
      await chrome.storage.local.remove(['uploadTask']);
      await deleteUploadQueueFromDB(task.courseId);
      return;
    }

    // Load queue from IndexedDB
    const queueData = await loadUploadQueueFromDB(task.courseId);
    if (!queueData || !queueData.files) {
      console.warn('⚠️ Upload task found but no queue in IndexedDB, marking as error');
      await chrome.storage.local.set({
        uploadTask: {
          ...task,
          status: 'error',
          error: 'Upload queue lost during service worker restart'
        }
      });
      return;
    }

    console.log(`🔄 Resuming upload for course ${task.courseId}: ${task.uploadedFiles}/${task.totalFiles} files uploaded, batch ${task.currentBatch}/${task.totalBatches}`);

    // Restore queue to memory
    uploadFilesQueue = queueData.files;

    // Resume upload process
    handleBackgroundUpload();

  } catch (error) {
    console.error('Error checking for incomplete uploads:', error);
  }
}

/**
 * Open IndexedDB connection
 */
async function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CanvasMaterialsDB', 2);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      // Create materials store (v1)
      if (!db.objectStoreNames.contains('materials')) {
        const objectStore = db.createObjectStore('materials', { keyPath: 'courseId' });
        objectStore.createIndex('courseName', 'courseName', { unique: false });
        objectStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
      }

      // Create uploadQueue store (v2)
      if (oldVersion < 2 && !db.objectStoreNames.contains('uploadQueue')) {
        const uploadStore = db.createObjectStore('uploadQueue', { keyPath: 'courseId' });
        uploadStore.createIndex('timestamp', 'timestamp', { unique: false });
        console.log('✅ Created uploadQueue object store');
      }
    };
  });
}

/**
 * Load materials from IndexedDB
 */
async function loadMaterialsFromDB(db, courseId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['materials'], 'readonly');
    const store = transaction.objectStore('materials');
    const request = store.get(courseId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save materials to IndexedDB
 */
async function saveMaterialsToDB(db, courseId, courseName, materials) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['materials'], 'readwrite');
    const store = transaction.objectStore('materials');

    const data = {
      courseId,
      courseName,
      materials,
      lastUpdated: Date.now()
    };

    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save upload queue to IndexedDB (persistent across service worker restarts)
 */
async function saveUploadQueueToDB(courseId, files, metadata) {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['uploadQueue'], 'readwrite');
    const store = transaction.objectStore('uploadQueue');

    const data = {
      courseId,
      files,  // Array of file objects with hash, url, name, etc.
      metadata,  // canvasUrl, cookies, totalFiles, currentBatch, etc.
      timestamp: Date.now()
    };

    await new Promise((resolve, reject) => {
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`💾 Saved upload queue for course ${courseId} to IndexedDB (${files.length} files)`);
    db.close();
  } catch (error) {
    console.error('Error saving upload queue to IndexedDB:', error);
  }
}

/**
 * Load upload queue from IndexedDB
 */
async function loadUploadQueueFromDB(courseId) {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['uploadQueue'], 'readonly');
    const store = transaction.objectStore('uploadQueue');

    const data = await new Promise((resolve, reject) => {
      const request = store.get(courseId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return data;
  } catch (error) {
    console.error('Error loading upload queue from IndexedDB:', error);
    return null;
  }
}

/**
 * Delete upload queue from IndexedDB (cleanup after completion)
 */
async function deleteUploadQueueFromDB(courseId) {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['uploadQueue'], 'readwrite');
    const store = transaction.objectStore('uploadQueue');

    await new Promise((resolve, reject) => {
      const request = store.delete(courseId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`🗑️ Deleted upload queue for course ${courseId} from IndexedDB`);
    db.close();
  } catch (error) {
    console.error('Error deleting upload queue from IndexedDB:', error);
  }
}

/**
 * HASH-BASED: Update materials with hash-based IDs from backend upload response
 * This ensures materials have doc_id, hash, and stored_name for hash-based matching
 */
async function updateMaterialsWithStoredNames(courseId, uploadedFiles) {
  try {
    // Get current materials from IndexedDB
    const db = await openIndexedDB();
    const materialsData = await loadMaterialsFromDB(db, courseId);

    if (!materialsData || !materialsData.materials) {
      console.warn('No materials found in IndexedDB to update');
      db.close();
      return;
    }

    const materials = materialsData.materials;
    const courseName = materialsData.courseName;
    let updatedCount = 0;

    // PURE HASH-BASED: Create mapping: hash -> {doc_id, stored_name}
    const hashToMetadataMap = new Map();
    // FILENAME FALLBACK: For first upload when materials don't have hashes yet
    const filenameToMetadataMap = new Map();
    // ID-BASED FALLBACK: Match by Canvas file ID (for module items with different titles)
    const idToMetadataMap = new Map();

    uploadedFiles.forEach(file => {
      // Backend returns: hash, doc_id, path, filename, canvas_file_id
      const metadata = {
        doc_id: file.doc_id,        // Hash-based ID: {course_id}_{hash}
        hash: file.hash,            // Store hash for materials without it
        stored_name: file.path || file.stored_name  // GCS path
      };

      if (file.hash) {
        hashToMetadataMap.set(file.hash, metadata);
      }

      // Canvas file ID mapping (for deduplication matching)
      // Backend may return id, canvas_file_id, canvas_id, or file_id
      const canvasId = file.canvas_file_id || file.canvas_id || file.id || file.file_id;
      if (canvasId) {
        const canvasIdStr = String(canvasId);
        idToMetadataMap.set(canvasIdStr, metadata);
      }

      // Filename mapping fallback
      const originalName = file.filename || file.original_name;
      if (originalName && file.hash) {
        filenameToMetadataMap.set(originalName, metadata);
        // Also map without extension
        const nameWithoutExt = originalName.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
        filenameToMetadataMap.set(nameWithoutExt, metadata);
      }
    });

    console.log(`📝 Updating materials with ${hashToMetadataMap.size} hash-based IDs (${idToMetadataMap.size} ID mappings, ${filenameToMetadataMap.size} filename fallbacks)...`);

    // Update all material categories using HASH as the key, with filename fallback
    const categories = ['files', 'pages', 'assignments', 'modules'];
    for (const category of categories) {
      if (!materials[category]) continue;

      if (category === 'modules') {
        // Handle module items
        materials[category].forEach(module => {
          if (module.items) {
            module.items.forEach(item => {
              const itemName = item.title || item.name || item.display_name;
              const canvasId = String(item.content_id || item.id || '');

              // Match by hash first (preferred)
              if (item.hash && hashToMetadataMap.has(item.hash)) {
                const metadata = hashToMetadataMap.get(item.hash);
                item.doc_id = metadata.doc_id;
                item.stored_name = metadata.stored_name;
                updatedCount++;
              }
              // Match by Canvas file ID (for deduplicated files with different titles)
              else if (!item.hash && canvasId && idToMetadataMap.has(canvasId)) {
                const metadata = idToMetadataMap.get(canvasId);
                item.doc_id = metadata.doc_id;
                item.hash = metadata.hash;
                item.stored_name = metadata.stored_name;
                updatedCount++;
                console.log(`✅ [ID MATCH] Module item "${itemName}" matched by Canvas ID: ${canvasId}`);
              }
              // Fallback to filename match (first upload - bootstrap hash)
              else if (!item.hash && itemName && filenameToMetadataMap.has(itemName)) {
                const metadata = filenameToMetadataMap.get(itemName);
                item.doc_id = metadata.doc_id;
                item.hash = metadata.hash;
                item.stored_name = metadata.stored_name;
                updatedCount++;
                console.log(`✅ [NAME MATCH] Module item "${itemName}" matched by filename`);
              }
              else if (!item.hash) {
                console.warn(`⚠️ [NO MATCH] Module item "${itemName}" not matched (canvasId: ${canvasId}, has filenameMap: ${filenameToMetadataMap.has(itemName)})`);
              }
            });
          }
        });
      } else {
        // Handle standalone files/pages/assignments
        materials[category].forEach(item => {
          const itemName = item.name || item.display_name || item.title;
          const canvasId = String(item.id || item.file_id || '');

          // Match by hash first (preferred)
          if (item.hash && hashToMetadataMap.has(item.hash)) {
            const metadata = hashToMetadataMap.get(item.hash);
            item.doc_id = metadata.doc_id;
            item.stored_name = metadata.stored_name;
            updatedCount++;
          }
          // Match by Canvas file ID (for deduplicated files)
          else if (!item.hash && canvasId && idToMetadataMap.has(canvasId)) {
            const metadata = idToMetadataMap.get(canvasId);
            item.doc_id = metadata.doc_id;
            item.hash = metadata.hash;
            item.stored_name = metadata.stored_name;
            updatedCount++;
          }
          // Fallback to filename match (first upload - bootstrap hash)
          else if (!item.hash && itemName && filenameToMetadataMap.has(itemName)) {
            const metadata = filenameToMetadataMap.get(itemName);
            item.doc_id = metadata.doc_id;
            item.hash = metadata.hash;
            item.stored_name = metadata.stored_name;
            updatedCount++;
          }
        });
      }
    }

    // Save updated materials back to IndexedDB
    await saveMaterialsToDB(db, courseId, courseName, materials);
    db.close();

    console.log(`✅ Updated ${updatedCount} materials with hash-based IDs`);

    // CANVAS ID PRESERVATION: Send canvas_id mappings to backend
    // This ensures backend can match files by Canvas ID (fallback)
    try {
      const canvasIdUpdates = [];

      // Collect canvas_id -> doc_id mappings from updated materials
      for (const category of categories) {
        if (!materials[category]) continue;

        if (category === 'modules') {
          materials[category].forEach(module => {
            if (module.items) {
              module.items.forEach(item => {
                if (item.doc_id && item.id) {
                  canvasIdUpdates.push({
                    doc_id: item.doc_id,
                    canvas_id: String(item.id)  // Ensure it's a string
                  });
                }
              });
            }
          });
        } else {
          materials[category].forEach(item => {
            if (item.doc_id && item.id) {
              canvasIdUpdates.push({
                doc_id: item.doc_id,
                canvas_id: String(item.id)  // Ensure it's a string
              });
            }
          });
        }
      }

      if (canvasIdUpdates.length > 0) {
        console.log(`📤 Sending ${canvasIdUpdates.length} canvas_id mappings to backend...`);
        const backendUrl = 'https://web-production-9aaba7.up.railway.app';
        const response = await fetch(`${backendUrl}/courses/${courseId}/update_canvas_ids`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: canvasIdUpdates })
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`✅ Backend updated ${result.updated_count} canvas_ids`);
        } else {
          console.warn(`⚠️ Failed to update canvas_ids in backend: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('❌ Error sending canvas_id mappings to backend:', error);
      // Don't throw - this is a non-critical operation
    }
  } catch (error) {
    console.error('❌ Error updating materials with hash-based IDs:', error);
  }
}

/**
 * HASH-BASED: Fetch complete materials catalog from backend and merge hash-based IDs
 * This ensures all materials have doc_id and hash fields, even if uploaded before
 */
async function fetchAndMergeBackendMaterials(courseId) {
  try {
    console.log('🔄 Fetching materials catalog from backend...');

    const backendUrl = 'https://web-production-9aaba7.up.railway.app';
    const response = await fetch(`${backendUrl}/collections/${courseId}/materials`);
    const data = await response.json();

    if (!data.success || !data.materials) {
      console.warn('❌ Failed to fetch materials catalog from backend:', data.error);
      return;
    }

    console.log(`📚 Received ${data.materials.length} materials from backend`);

    // Get current materials from IndexedDB
    const db = await openIndexedDB();
    const materialsData = await loadMaterialsFromDB(db, courseId);

    if (!materialsData || !materialsData.materials) {
      console.warn('No materials found in IndexedDB to merge');
      db.close();
      return;
    }

    const materials = materialsData.materials;
    const courseName = materialsData.courseName;
    let mergedCount = 0;

    // PURE HASH-BASED: Create mapping: hash -> backend material metadata
    const hashToBackendMap = new Map();
    data.materials.forEach(mat => {
      // Backend material has: id (hash-based), name (original filename), hash, path, etc.
      if (mat.hash) {
        hashToBackendMap.set(mat.hash, {
          doc_id: mat.id,      // Hash-based doc ID
          path: mat.path       // GCS path
        });
      }
    });

    console.log(`🔍 Merging backend metadata into ${hashToBackendMap.size} materials (pure hash matching)...`);

    // Merge backend metadata into frontend materials using HASH as the key
    const categories = ['files', 'pages', 'assignments', 'modules'];
    for (const category of categories) {
      if (!materials[category]) continue;

      if (category === 'modules') {
        materials[category].forEach(module => {
          if (module.items) {
            module.items.forEach(item => {
              // Match by hash - materials already have hash from download time
              if (item.hash && hashToBackendMap.has(item.hash)) {
                const metadata = hashToBackendMap.get(item.hash);
                item.doc_id = metadata.doc_id;
                item.stored_name = metadata.path;
                mergedCount++;
                const itemName = item.title || item.name || item.display_name;
                console.log(`  ✅ Merged: "${itemName}" (hash: ${item.hash?.substring(0, 16)}...) → ID: ${metadata.doc_id?.substring(0, 24)}...`);
              }
            });
          }
        });
      } else {
        materials[category].forEach(item => {
          // Match by hash - materials already have hash from download time
          if (item.hash && hashToBackendMap.has(item.hash)) {
            const metadata = hashToBackendMap.get(item.hash);
            item.doc_id = metadata.doc_id;
            item.stored_name = metadata.path;
            mergedCount++;
            const itemName = item.name || item.display_name || item.title;
            console.log(`  ✅ Merged: "${itemName}" (hash: ${item.hash?.substring(0, 16)}...) → ID: ${metadata.doc_id?.substring(0, 24)}...`);
          }
        });
      }
    }

    // Save updated materials back to IndexedDB
    await saveMaterialsToDB(db, courseId, courseName, materials);
    db.close();

    console.log(`✅ Merged ${mergedCount} materials with backend hash-based IDs`);
  } catch (error) {
    console.error('❌ Error fetching and merging backend materials:', error);
  }
}

// Check for pending download tasks on startup
chrome.storage.local.get(['downloadTask'], (result) => {
  if (result.downloadTask && result.downloadTask.status === 'pending') {
    console.log('🔄 [SERVICE-WORKER] Found pending download task, resuming...');
    handleBackgroundDownloads(result.downloadTask);
  }
});

/**
 * Listen for messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  if (request.type === 'LOG_FROM_POPUP') {
    // Log messages from popup to service worker console for persistence
    console.log(request.message);
    sendResponse({ success: true });
  } else if (request.type === 'COURSE_DETECTED') {
    // Store course info from content script
    currentCourseInfo = request.courseInfo;
    console.log('Course info stored:', currentCourseInfo);
    sendResponse({ success: true });
  } else if (request.type === 'GET_CURRENT_COURSE') {
    // Send stored course info to popup
    sendResponse({ courseInfo: currentCourseInfo });
  } else if (request.type === 'CLEAR_CURRENT_COURSE') {
    // Clear stored course info
    currentCourseInfo = null;
    sendResponse({ success: true });
  } else if (request.type === 'SYNC_BACKEND_MATERIALS') {
    // HASH-BASED: Manually trigger backend materials sync
    console.log('🔄 [SERVICE-WORKER] Manual backend materials sync requested');
    const { courseId } = request.payload;

    fetchAndMergeBackendMaterials(courseId)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Sync failed:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep channel open for async response
  } else if (request.type === 'START_BACKGROUND_UPLOAD') {
    // Handle background file upload with batching
    console.log('🚀 [SERVICE-WORKER] Received START_BACKGROUND_UPLOAD message');
    const { courseId, files, canvasUrl, cookies } = request.payload;

    // Log deduplication stats
    const filesWithHash = files.filter(f => f.hash).length;
    const uniqueUrls = new Set(files.map(f => f.url)).size;
    console.log(`🔍 [DEDUP CHECK] Received ${files.length} files: ${filesWithHash} with hash, ${uniqueUrls} unique URLs`);

    // Store files in memory (not in chrome.storage to avoid quota issues)
    uploadFilesQueue = files;

    // Persist queue to IndexedDB (survives service worker restart)
    const metadata = {
      canvasUrl,
      cookies,
      totalFiles: files.length,
      currentBatch: 0,
      totalBatches: Math.ceil(files.length / 50),  // Match BATCH_SIZE
      startTime: Date.now()
    };
    saveUploadQueueToDB(courseId, files, metadata).catch(err => {
      console.error('Failed to persist upload queue:', err);
    });

    // Initialize upload task in storage (without files array to avoid quota issues)
    chrome.storage.local.set({
      uploadTask: {
        courseId,
        canvasUrl,
        cookies,
        status: 'uploading',
        totalFiles: files.length,
        uploadedFiles: 0,
        currentBatch: 0,
        totalBatches: Math.ceil(files.length / 50),  // Match BATCH_SIZE
        startTime: Date.now()
      }
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('❌ Storage write failed:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log(`📤 Starting background upload: ${files.length} files in ${Math.ceil(files.length / 50)} batches`);
        // Start the upload process
        handleBackgroundUpload();
        sendResponse({ success: true });
      }
    });

    return true; // Keep message channel open for async response
  } else if (request.type === 'START_DOWNLOADS') {
    // Handle new storage-based background downloads
    console.log('🚀 [SERVICE-WORKER] Received START_DOWNLOADS message');

    chrome.storage.local.get(['downloadTask'], (result) => {
      console.log('🔍 [SERVICE-WORKER] Storage check result:', result);

      if (result.downloadTask) {
        console.log('📦 [SERVICE-WORKER] Download task found:', {
          courseId: result.downloadTask.courseId,
          status: result.downloadTask.status,
          filesCount: result.downloadTask.filesToDownload?.length
        });

        if (result.downloadTask.status === 'pending') {
          console.log('🔄 [SERVICE-WORKER] Starting downloads...');
          handleBackgroundDownloads(result.downloadTask)
            .then(() => {
              console.log('✅ [SERVICE-WORKER] Downloads completed successfully');
            })
            .catch((error) => {
              console.error('❌ [SERVICE-WORKER] Download error:', error);
            });
          sendResponse({ success: true });
        } else {
          console.log('⚠️ [SERVICE-WORKER] Task status is not pending:', result.downloadTask.status);
          sendResponse({ success: false, error: 'Task not pending' });
        }
      } else {
        console.log('⚠️ [SERVICE-WORKER] No download task found in storage');
        sendResponse({ success: false, error: 'No pending download task' });
      }
    });

    return true; // Keep channel open for async response
  } else if (request.type === 'START_BACKGROUND_LOADING') {
    // Handle old background loading request (deprecated)
    console.log('🚀 [SERVICE-WORKER] Received START_BACKGROUND_LOADING message');
    console.log('🚀 [SERVICE-WORKER] Course ID:', request.courseId);
    console.log('🚀 [SERVICE-WORKER] Files to download:', request.filesToDownload?.length);
    console.log('🚀 [SERVICE-WORKER] Files to upload:', request.filesToUploadToBackend?.length);

    handleBackgroundLoading(request).then(() => {
      console.log('✅ [SERVICE-WORKER] Background loading completed successfully');
      sendResponse({ success: true });
    }).catch(error => {
      console.error('❌ [SERVICE-WORKER] Background loading error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  } else if (request.type === 'theme-changed') {
    // Handle theme changes from offscreen document or pages
    const scheme = request.theme || request.scheme;
    console.log(`🎨 [MESSAGE LISTENER] Theme changed message received: ${scheme}`);

    // Update icon
    updateIconForTheme(scheme);

    // Store theme preference (this will also trigger storage listener)
    chrome.storage.local.set({ 'theme-preference': scheme }, () => {
      console.log(`📦 [MESSAGE LISTENER] Theme preference saved to storage: ${scheme}`);
    });

    sendResponse({ success: true });
  }

  return true; // Keep message channel open for async response
});

/**
 * Handle background loading of materials
 */
async function handleBackgroundLoading(request) {
  const { courseId, courseName, filesToDownload, filesToUploadToBackend, canvasUrl, backendUrl } = request;

  console.log(`📥 [SERVICE-WORKER] handleBackgroundLoading started`);
  console.log(`📥 [SERVICE-WORKER] Files to download: ${filesToDownload.length}`);

  // Send initial progress
  console.log(`📤 [SERVICE-WORKER] Sending initial MATERIALS_LOADING_PROGRESS message`);
  chrome.runtime.sendMessage({
    type: 'MATERIALS_LOADING_PROGRESS',
    courseId: courseId,
    status: 'loading',
    filesCompleted: 0,
    filesTotal: filesToDownload.length,
    message: `Downloading ${filesToDownload.length} files...`
  }, (response) => {
    console.log(`📤 [SERVICE-WORKER] MATERIALS_LOADING_PROGRESS message sent, response:`, response);
  });

  // Download files
  const downloadedFiles = [];
  let completed = 0;

  for (const file of filesToDownload) {
    try {
      // Download file using fetch with Canvas cookies
      const response = await fetch(file.url, {
        credentials: 'include'  // Include cookies
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      let fileName = file.name;

      // Add extension if missing
      if (!fileName.includes('.')) {
        const mimeToExt = {
          'application/pdf': '.pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'text/plain': '.txt',
          'image/png': '.png',
          'image/jpeg': '.jpg'
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

      console.log(`✅ Downloaded ${fileName} (${completed}/${filesToDownload.length})`);
    } catch (error) {
      completed++;
      console.error(`❌ Failed to download ${file.name}:`, error);
    }
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

    // Filter files to upload
    const uploadSet = new Set(filesToUploadToBackend.map(f => f.name));
    const filesToUpload = downloadedFiles.filter(f => {
      const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
      return uploadSet.has(f.name) || uploadSet.has(nameWithoutExt);
    });

    if (filesToUpload.length > 0) {
      try {
        // Upload files
        const formData = new FormData();
        filesToUpload.forEach(file => {
          formData.append('files', file.blob, file.name);
        });

        // Get Canvas user ID for user-specific tracking
        const storageData = await chrome.storage.local.get(['canvasUserId']);
        const headers = {};
        if (storageData.canvasUserId) {
          headers['X-Canvas-User-Id'] = storageData.canvasUserId;
          console.log(`📤 Including Canvas User ID: ${storageData.canvasUserId}`);
        }

        const response = await fetch(`${backendUrl}/upload_pdfs?course_id=${courseId}`, {
          method: 'POST',
          headers: headers,
          body: formData
        });

        if (response.ok) {
          console.log(`✅ Uploaded ${filesToUpload.length} files to backend`);
        } else {
          console.error('Backend upload failed:', response.status);
        }
      } catch (error) {
        console.error('Upload error:', error);
      }
    }
  }

  // Update IndexedDB with blobs
  // Note: Can't directly access IndexedDB from service worker in MV3
  // So we send completion message and let chat page handle the reload
  console.log('✅ Background loading complete');

  chrome.runtime.sendMessage({
    type: 'MATERIALS_LOADING_COMPLETE',
    courseId: courseId,
    status: 'complete',
    message: 'All materials loaded!'
  });
}

/**
 * Handle background downloads using chrome.storage.local for coordination
 * PHASE 2: Batched downloads to prevent memory overflow
 */
async function handleBackgroundDownloads(downloadTask) {
  const { courseId, courseName, filesToDownload, filesToUpload } = downloadTask;

  console.log(`📥 [SERVICE-WORKER] handleBackgroundDownloads started`);
  console.log(`📥 [SERVICE-WORKER] Course: ${courseName} (${courseId})`);
  console.log(`📥 [SERVICE-WORKER] Files to download: ${filesToDownload.length}`);
  console.log(`📥 [SERVICE-WORKER] Files to upload: ${filesToUpload.length}`);

  // PHASE 2: Get backend URL for GCS check
  const { backendUrl } = await new Promise(resolve => {
    chrome.storage.local.get(['backendUrl'], resolve);
  });

  // PHASE 2: Check which files exist in GCS
  let filesFromGCS = [];
  let filesFromCanvas = [];

  if (backendUrl) {
    try {
      console.log(`🔍 [SERVICE-WORKER] Checking which files exist in GCS...`);
      const checkResponse = await fetch(`${backendUrl}/check_files_exist?course_id=${courseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToDownload })
      });

      if (checkResponse.ok) {
        const { exists, missing } = await checkResponse.json();
        console.log(`✅ [SERVICE-WORKER] GCS check: ${exists.length} exist, ${missing.length} missing`);

        // Files that exist in GCS - download from signed URLs
        filesFromGCS = exists.map(f => ({
          ...f,
          source: 'gcs'
        }));

        // Files that don't exist - download from Canvas
        filesFromCanvas = filesToDownload.filter(f => missing.includes(f.name));
      } else {
        console.warn(`⚠️ [SERVICE-WORKER] GCS check failed, downloading all from Canvas`);
        filesFromCanvas = filesToDownload;
      }
    } catch (error) {
      console.error(`❌ [SERVICE-WORKER] GCS check error:`, error);
      filesFromCanvas = filesToDownload;
    }
  } else {
    filesFromCanvas = filesToDownload;
  }

  // Update task status to 'downloading'
  await updateDownloadTask({
    status: 'downloading',
    progress: {
      filesCompleted: 0,
      filesTotal: filesToDownload.length,
      message: `Downloading ${filesToDownload.length} files...`
    }
  });

  // PHASE 2: Process files in batches to prevent memory overflow
  const BATCH_SIZE = 20; // Download and upload 20 files at a time
  const allFiles = [...filesFromGCS, ...filesFromCanvas];
  let completed = 0;
  const allDownloadedFiles = [];

  for (let batchStart = 0; batchStart < allFiles.length; batchStart += BATCH_SIZE) {
    const batch = allFiles.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allFiles.length / BATCH_SIZE);

    console.log(`📦 [SERVICE-WORKER] Processing batch ${batchNum}/${totalBatches} (${batch.length} files)`);

    // Download batch
    const downloadedBatch = [];
    for (const file of batch) {
      try {
        let blob, fileName;

        if (file.source === 'gcs') {
          // Download from GCS signed URL (faster)
          console.log(`⚡ [SERVICE-WORKER] Downloading ${file.name} from GCS (fast path)`);
          const response = await fetch(file.url); // No credentials needed for signed URL

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          blob = await response.blob();
          fileName = file.actual_name; // Use actual name from GCS (might be .pdf)
        } else {
          // Download from Canvas
          // These are Canvas URLs which include authentication tokens in the URL itself
          console.log(`📥 [SERVICE-WORKER] Downloading ${file.name} from Canvas`);
          const response = await fetch(file.url);  // No credentials needed - token is in URL

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          blob = await response.blob();
          fileName = file.name;

          // Add extension if missing
          if (!fileName.includes('.')) {
            const mimeToExt = {
              'application/pdf': '.pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
              'text/plain': '.txt',
              'image/png': '.png',
              'image/jpeg': '.jpg'
            };
            const ext = mimeToExt[blob.type];
            if (ext) fileName = fileName + ext;
          }
        }

        downloadedBatch.push({ blob, name: fileName });
        completed++;

        // Update progress
        await updateDownloadTask({
          status: 'downloading',
          progress: {
            filesCompleted: completed,
            filesTotal: allFiles.length,
            message: `Downloaded ${completed}/${allFiles.length} files`
          }
        });

        console.log(`✅ [SERVICE-WORKER] Downloaded ${fileName} (${completed}/${allFiles.length})`);
      } catch (error) {
        completed++;
        console.error(`❌ [SERVICE-WORKER] Failed to download ${file.name}:`, error);

        // Update progress even on error
        await updateDownloadTask({
          status: 'downloading',
          progress: {
            filesCompleted: completed,
            filesTotal: allFiles.length,
            message: `Downloaded ${completed}/${allFiles.length} files`
          }
        });
      }
    }

    // Save batch to IndexedDB immediately (prevent memory buildup)
    // Note: Can't access IndexedDB from service worker, store for chat page
    allDownloadedFiles.push(...downloadedBatch);

    // Upload batch to backend if needed
    if (downloadedBatch.length > 0 && filesToUpload.length > 0) {
      console.log(`📤 [SERVICE-WORKER] Uploading batch ${batchNum} to backend...`);

      // Filter files to upload
      const uploadSet = new Set(filesToUpload.map(f => f.name));
      const batchToUpload = downloadedBatch.filter(f => {
        const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
        return uploadSet.has(f.name) || uploadSet.has(nameWithoutExt);
      });

      if (batchToUpload.length > 0 && backendUrl) {
        try {
          const formData = new FormData();
          batchToUpload.forEach(file => {
            formData.append('files', file.blob, file.name);
          });

          // Get Canvas user ID for user-specific tracking
          const storageData = await chrome.storage.local.get(['canvasUserId']);
          const headers = {};
          if (storageData.canvasUserId) {
            headers['X-Canvas-User-Id'] = storageData.canvasUserId;
          }

          const response = await fetch(`${backendUrl}/upload_pdfs?course_id=${courseId}`, {
            method: 'POST',
            headers: headers,
            body: formData
          });

          if (response.ok) {
            console.log(`✅ [SERVICE-WORKER] Uploaded batch ${batchNum} (${batchToUpload.length} files)`);
          } else {
            console.error(`❌ [SERVICE-WORKER] Batch ${batchNum} upload failed:`, response.status);
          }
        } catch (error) {
          console.error(`❌ [SERVICE-WORKER] Batch ${batchNum} upload error:`, error);
        }
      }
    }

    // Clear batch from memory
    downloadedBatch.length = 0;
  }

  const totalBatches = Math.ceil(allFiles.length / BATCH_SIZE);
  console.log(`📦 [SERVICE-WORKER] Downloaded ${allDownloadedFiles.length}/${allFiles.length} files`);
  console.log(`⚡ [SERVICE-WORKER] Memory optimized: processed ${totalBatches} batches of ${BATCH_SIZE} files each`);

  // Mark task as complete
  await updateDownloadTask({
    status: 'complete',
    progress: {
      filesCompleted: completed,
      filesTotal: allFiles.length,
      message: 'All materials uploaded to backend!'
    }
  });

  console.log('✅ [SERVICE-WORKER] Background downloads and uploads complete');
}

/**
 * Update download task in chrome.storage.local
 */
async function updateDownloadTask(updates) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['downloadTask'], (result) => {
      const task = result.downloadTask || {};
      const updatedTask = { ...task, ...updates };
      chrome.storage.local.set({ downloadTask: updatedTask }, () => {
        resolve();
      });
    });
  });
}

/**
 * Handle background file upload with batching (50 files per batch)
 */
/**
 * Simulate individual file progress updates while batch is uploading
 * This gives users visual feedback that files are processing one-by-one
 */
async function simulateFileProgress(startCount, endCount, durationMs) {
  const filesInBatch = endCount - startCount;
  if (filesInBatch <= 0) return;

  // Calculate delay between each file update
  const delayPerFile = Math.max(50, Math.min(500, durationMs / filesInBatch)); // 50-500ms per file

  for (let i = 1; i <= filesInBatch; i++) {
    const currentFileCount = startCount + i;

    // Update progress
    const result = await chrome.storage.local.get(['uploadTask']);
    const task = result.uploadTask;
    if (!task || task.status !== 'uploading') break; // Stop if task was cancelled

    await new Promise((resolve) => {
      chrome.storage.local.set({
        uploadTask: {
          ...task,
          uploadedFiles: currentFileCount
        }
      }, () => {
        if (!chrome.runtime.lastError) {
          console.log(`📊 Progress: ${currentFileCount}/${task.totalFiles} files`);
        }
        resolve();
      });
    });

    // Wait before next update (except for last file)
    if (i < filesInBatch) {
      await new Promise(resolve => setTimeout(resolve, delayPerFile));
    }
  }
}

async function handleBackgroundUpload() {
  const BATCH_SIZE = 50;

  try {
    // Get upload task from storage
    const result = await chrome.storage.local.get(['uploadTask']);
    const task = result.uploadTask;

    if (!task || task.status !== 'uploading') {
      console.log('⏹️ No active upload task');
      return;
    }

    // Get files from memory (not from storage to avoid quota issues)
    if (!uploadFilesQueue) {
      console.error('❌ No files in upload queue');
      return;
    }

    const { courseId, canvasUrl, cookies, uploadedFiles, currentBatch, totalBatches } = task;
    const totalFiles = uploadFilesQueue.length;

    // Check if all files uploaded
    if (uploadedFiles >= totalFiles) {
      console.log('✅ All files uploaded successfully!');
      await chrome.storage.local.set({
        uploadTask: {
          ...task,
          status: 'complete',
          endTime: Date.now()
        }
      });
      // Clear files from memory
      uploadFilesQueue = null;
      // Clean up IndexedDB queue
      await deleteUploadQueueFromDB(courseId);
      return;
    }

    // Get current batch from memory
    const batchStart = currentBatch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalFiles);
    const currentBatchFiles = uploadFilesQueue.slice(batchStart, batchEnd);

    console.log(`📤 Uploading batch ${currentBatch + 1}/${totalBatches} (${currentBatchFiles.length} files)`);

    // Start simulating file-by-file progress in parallel with actual upload
    const progressStartCount = uploadedFiles;
    const progressEndCount = uploadedFiles + currentBatchFiles.length;
    const estimatedBatchTime = currentBatchFiles.length * 200; // Estimate ~200ms per file
    const progressPromise = simulateFileProgress(progressStartCount, progressEndCount, estimatedBatchTime);

    // Upload batch to backend (runs in parallel with progress simulation)
    try {
      // Get Canvas user ID for tracking
      const storageData = await chrome.storage.local.get(['canvasUserId']);
      const headers = {
        'Content-Type': 'application/json'
      };
      if (storageData.canvasUserId) {
        headers['X-Canvas-User-Id'] = storageData.canvasUserId;
        console.log(`📤 Including Canvas User ID: ${storageData.canvasUserId}`);
      }

      const response = await fetch('https://web-production-9aaba7.up.railway.app/process_canvas_files', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          course_id: courseId,
          files: currentBatchFiles,
          canvas_url: canvasUrl,
          cookies: cookies,
          skip_check: true  // Frontend already checked which files exist - skip redundant backend check
        })
      });

      const result = await response.json();

      console.log(`✅ Batch ${currentBatch + 1} upload complete: ${result.processed} processed, ${result.skipped} skipped, ${result.failed} failed`);

      // CRITICAL: Update materials with stored_name from backend
      // This ensures selected doc IDs have correct extensions
      if (result.uploaded_files && result.uploaded_files.length > 0) {
        console.log(`📝 Updating ${result.uploaded_files.length} materials with stored names...`);
        await updateMaterialsWithStoredNames(courseId, result.uploaded_files);
      }

      // Wait for progress simulation to complete before final update
      // This ensures smooth progress bar animation
      await progressPromise;

      // Update progress - final update to ensure correct count
      // (simulation may have already updated, but this ensures accuracy)
      const newUploadedFiles = uploadedFiles + currentBatchFiles.length;
      await new Promise((resolve) => {
        chrome.storage.local.set({
          uploadTask: {
            ...task,
            uploadedFiles: newUploadedFiles,
            currentBatch: currentBatch + 1,
            lastResult: result
          }
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('❌ Storage write failed (batch progress):', chrome.runtime.lastError);
            // Continue anyway - don't let storage failure stop uploads
          } else {
            console.log(`✅ Progress saved: ${newUploadedFiles}/${totalFiles} files uploaded`);
          }
          resolve();
        });
      });

      // Continue with next batch
      if (newUploadedFiles < totalFiles) {
        // Process next batch immediately (backend handles rate limiting)
        handleBackgroundUpload();
      } else {
        // All done!
        console.log('✅ All batches uploaded successfully!');

        // HASH-BASED: Fetch complete catalog from backend to ensure all materials have hash IDs
        await fetchAndMergeBackendMaterials(courseId);

        await new Promise((resolve) => {
          chrome.storage.local.set({
            uploadTask: {
              ...task,
              uploadedFiles: newUploadedFiles,
              currentBatch: currentBatch + 1,
              status: 'complete',
              endTime: Date.now()
            }
          }, () => {
            if (chrome.runtime.lastError) {
              console.error('❌ Storage write failed (completion):', chrome.runtime.lastError);
            }
            resolve();
          });
        });
        // Clear files from memory
        uploadFilesQueue = null;
        // Clean up IndexedDB queue
        await deleteUploadQueueFromDB(courseId);
      }

    } catch (error) {
      console.error(`❌ Batch ${currentBatch + 1} upload failed:`, error);

      // Mark as error and stop
      await new Promise((resolve) => {
        chrome.storage.local.set({
          uploadTask: {
            ...task,
            status: 'error',
            error: error.message,
            endTime: Date.now()
          }
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('❌ Storage write failed (error status):', chrome.runtime.lastError);
          }
          resolve();
        });
      });
      // Clear files from memory
      uploadFilesQueue = null;
      // Clean up IndexedDB queue
      await deleteUploadQueueFromDB(courseId);
    }

  } catch (error) {
    console.error('❌ Background upload error:', error);
  }
}

/**
 * Listen for extension icon click
 */
chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked on tab:', tab.id);
});

/**
 * Handle installation/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('First time installation');
    // Could open options page or welcome page here
  } else if (details.reason === 'update') {
    console.log('Extension updated to version:', chrome.runtime.getManifest().version);
  }
});

/**
 * Handle startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, service worker initialized');
});
