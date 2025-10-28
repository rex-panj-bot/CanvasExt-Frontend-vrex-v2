/**
 * Background Service Worker
 * Handles message passing and background operations
 */

console.log('Canvas Material Extractor: Service worker loaded');

// Store current course info
let currentCourseInfo = null;

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
 */
async function handleBackgroundDownloads(downloadTask) {
  const { courseId, courseName, filesToDownload, filesToUpload } = downloadTask;

  console.log(`📥 [SERVICE-WORKER] handleBackgroundDownloads started`);
  console.log(`📥 [SERVICE-WORKER] Course: ${courseName} (${courseId})`);
  console.log(`📥 [SERVICE-WORKER] Files to download: ${filesToDownload.length}`);
  console.log(`📥 [SERVICE-WORKER] Files to upload: ${filesToUpload.length}`);

  // Update task status to 'downloading'
  await updateDownloadTask({
    status: 'downloading',
    progress: {
      filesCompleted: 0,
      filesTotal: filesToDownload.length,
      message: `Downloading ${filesToDownload.length} files...`
    }
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

      // Update progress in storage
      await updateDownloadTask({
        status: 'downloading',
        progress: {
          filesCompleted: completed,
          filesTotal: filesToDownload.length,
          message: `Downloaded ${completed}/${filesToDownload.length} files`
        }
      });

      console.log(`✅ [SERVICE-WORKER] Downloaded ${fileName} (${completed}/${filesToDownload.length})`);
    } catch (error) {
      completed++;
      console.error(`❌ [SERVICE-WORKER] Failed to download ${file.name}:`, error);

      // Update progress even on error
      await updateDownloadTask({
        status: 'downloading',
        progress: {
          filesCompleted: completed,
          filesTotal: filesToDownload.length,
          message: `Downloaded ${completed}/${filesToDownload.length} files`
        }
      });
    }
  }

  console.log(`📦 [SERVICE-WORKER] Downloaded ${downloadedFiles.length}/${filesToDownload.length} files`);

  // Upload to backend if needed
  if (downloadedFiles.length > 0 && filesToUpload.length > 0) {
    await updateDownloadTask({
      status: 'uploading',
      progress: {
        filesCompleted: completed,
        filesTotal: filesToDownload.length,
        message: `Uploading ${downloadedFiles.length} files to backend...`
      }
    });

    // Get backend URL from storage
    const { backendUrl } = await new Promise(resolve => {
      chrome.storage.local.get(['backendUrl'], resolve);
    });

    // Filter files to upload
    const uploadSet = new Set(filesToUpload.map(f => f.name));
    const filesToUploadFiltered = downloadedFiles.filter(f => {
      const nameWithoutExt = f.name.replace(/\.(pdf|docx?|txt|xlsx?|pptx?|csv|md|rtf|png|jpe?g|gif|webp|bmp)$/i, '');
      return uploadSet.has(f.name) || uploadSet.has(nameWithoutExt);
    });

    if (filesToUploadFiltered.length > 0) {
      try {
        // Upload files
        const formData = new FormData();
        filesToUploadFiltered.forEach(file => {
          formData.append('files', file.blob, file.name);
        });

        const response = await fetch(`${backendUrl}/upload_pdfs?course_id=${courseId}`, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          console.log(`✅ [SERVICE-WORKER] Uploaded ${filesToUploadFiltered.length} files to backend`);
        } else {
          console.error('❌ [SERVICE-WORKER] Backend upload failed:', response.status);
        }
      } catch (error) {
        console.error('❌ [SERVICE-WORKER] Upload error:', error);
      }
    }
  }

  // Mark task as complete
  await updateDownloadTask({
    status: 'complete',
    progress: {
      filesCompleted: completed,
      filesTotal: filesToDownload.length,
      message: 'All materials loaded!'
    },
    downloadedFiles: downloadedFiles // Store downloaded files for IndexedDB update
  });

  console.log('✅ [SERVICE-WORKER] Background downloads complete');
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
