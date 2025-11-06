/**
 * Background Service Worker
 * Handles message passing and background operations
 */

console.log('Canvas Material Extractor: Service worker loaded');

// Store current course info
let currentCourseInfo = null;

/**
 * Update materials in storage with stored_name from backend upload response
 * This ensures materials have the correct GCS filenames with extensions
 */
async function updateMaterialsWithStoredNames(courseId, uploadedFiles) {
  try {
    // Get current materials from storage
    const storageKey = `course_${courseId}`;
    const result = await chrome.storage.local.get([storageKey]);

    if (!result[storageKey] || !result[storageKey].materials) {
      console.warn('No materials found in storage to update');
      return;
    }

    const materials = result[storageKey].materials;
    let updatedCount = 0;

    // Create mapping: original_name -> stored_name
    const nameMap = new Map();
    uploadedFiles.forEach(file => {
      nameMap.set(file.original_name, file.stored_name);
    });

    // Update all material categories
    const categories = ['files', 'pages', 'assignments', 'modules'];
    for (const category of categories) {
      if (!materials[category]) continue;

      if (category === 'modules') {
        // Handle module items
        materials[category].forEach(module => {
          if (module.items) {
            module.items.forEach(item => {
              const originalName = item.title || item.name || item.display_name;
              if (originalName && nameMap.has(originalName)) {
                item.stored_name = nameMap.get(originalName);
                updatedCount++;
                console.log(`  ✅ Updated: "${originalName}" → "${item.stored_name}"`);
              }
            });
          }
        });
      } else {
        // Handle standalone files/pages/assignments
        materials[category].forEach(item => {
          const originalName = item.name || item.display_name || item.title;
          if (originalName && nameMap.has(originalName)) {
            item.stored_name = nameMap.get(originalName);
            updatedCount++;
            console.log(`  ✅ Updated: "${originalName}" → "${item.stored_name}"`);
          }
        });
      }
    }

    // Save updated materials back to storage
    await chrome.storage.local.set({
      [storageKey]: {
        ...result[storageKey],
        materials: materials
      }
    });

    console.log(`✅ Updated ${updatedCount} materials with stored names`);
  } catch (error) {
    console.error('❌ Error updating materials with stored names:', error);
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

  if (request.type === 'COURSE_DETECTED') {
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
  } else if (request.type === 'START_BACKGROUND_UPLOAD') {
    // Handle background file upload with batching
    console.log('🚀 [SERVICE-WORKER] Received START_BACKGROUND_UPLOAD message');
    const { courseId, files, canvasUrl, cookies } = request.payload;

    // Initialize upload task in storage
    chrome.storage.local.set({
      uploadTask: {
        courseId,
        files,
        canvasUrl,
        cookies,
        status: 'uploading',
        totalFiles: files.length,
        uploadedFiles: 0,
        currentBatch: 0,
        totalBatches: Math.ceil(files.length / 8),
        startTime: Date.now()
      }
    }, () => {
      console.log(`📤 Starting background upload: ${files.length} files in ${Math.ceil(files.length / 8)} batches`);
      // Start the upload process
      handleBackgroundUpload();
    });

    sendResponse({ success: true });
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

        const response = await fetch(`${backendUrl}/upload_pdfs?course_id=${courseId}`, {
          method: 'POST',
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

          const response = await fetch(`${backendUrl}/upload_pdfs?course_id=${courseId}`, {
            method: 'POST',
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
 * Handle background file upload with batching (8 files per batch)
 */
async function handleBackgroundUpload() {
  const BATCH_SIZE = 8;

  try {
    // Get upload task from storage
    const result = await chrome.storage.local.get(['uploadTask']);
    const task = result.uploadTask;

    if (!task || task.status !== 'uploading') {
      console.log('⏹️ No active upload task');
      return;
    }

    const { courseId, files, canvasUrl, cookies, uploadedFiles, currentBatch, totalBatches } = task;

    // Check if all files uploaded
    if (uploadedFiles >= files.length) {
      console.log('✅ All files uploaded successfully!');
      await chrome.storage.local.set({
        uploadTask: {
          ...task,
          status: 'complete',
          endTime: Date.now()
        }
      });
      return;
    }

    // Get current batch
    const batchStart = currentBatch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, files.length);
    const currentBatchFiles = files.slice(batchStart, batchEnd);

    console.log(`📤 Uploading batch ${currentBatch + 1}/${totalBatches} (${currentBatchFiles.length} files)`);

    // Upload batch to backend
    try {
      const response = await fetch('https://web-production-9aaba7.up.railway.app/process_canvas_files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          course_id: courseId,
          files: currentBatchFiles,
          canvas_url: canvasUrl,
          cookies: cookies,
          skip_check: true  // Frontend already checked which files exist - skip redundant backend check
        })
      });

      const result = await response.json();

      console.log(`✅ Batch ${currentBatch + 1} upload complete:`, {
        processed: result.processed,
        skipped: result.skipped,
        failed: result.failed,
        batchSize: currentBatchFiles.length
      });

      // DEBUG: Log detailed upload stats
      console.log(`📊 [DEBUG] Upload stats:`, {
        'Previously uploaded': uploadedFiles,
        'Current batch size': currentBatchFiles.length,
        'Actually processed': result.processed,
        'Skipped (already in GCS)': result.skipped,
        'Failed': result.failed,
        'Will count as uploaded': currentBatchFiles.length
      });

      // CRITICAL: Update materials with stored_name from backend
      // This ensures selected doc IDs have correct extensions
      if (result.uploaded_files && result.uploaded_files.length > 0) {
        console.log(`📝 Updating ${result.uploaded_files.length} materials with stored names...`);
        await updateMaterialsWithStoredNames(courseId, result.uploaded_files);
      }

      // Update progress (count all files in batch, whether processed, skipped, or failed)
      const newUploadedFiles = uploadedFiles + currentBatchFiles.length;
      await chrome.storage.local.set({
        uploadTask: {
          ...task,
          uploadedFiles: newUploadedFiles,
          currentBatch: currentBatch + 1,
          lastResult: result
        }
      });

      // Continue with next batch
      if (newUploadedFiles < files.length) {
        // Small delay between batches to avoid overwhelming backend
        setTimeout(() => handleBackgroundUpload(), 1000);
      } else {
        // All done!
        console.log('✅ All batches uploaded successfully!');
        await chrome.storage.local.set({
          uploadTask: {
            ...task,
            uploadedFiles: newUploadedFiles,
            currentBatch: currentBatch + 1,
            status: 'complete',
            endTime: Date.now()
          }
        });
      }

    } catch (error) {
      console.error(`❌ Batch ${currentBatch + 1} upload failed:`, error);

      // Mark as error and stop
      await chrome.storage.local.set({
        uploadTask: {
          ...task,
          status: 'error',
          error: error.message,
          endTime: Date.now()
        }
      });
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
