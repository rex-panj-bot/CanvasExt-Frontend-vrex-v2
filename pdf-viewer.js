console.log('🔍 [PDF-VIEWER] Page loaded');

// Get URL parameters
const urlParams = new URLSearchParams(window.location.search);
const courseId = urlParams.get('course');
const fileId = urlParams.get('file');
const fileName = urlParams.get('name') || 'Document';

console.log('🔍 [PDF-VIEWER] URL Parameters:', {
  courseId,
  fileId,
  fileName: decodeURIComponent(fileName),
  fullUrl: window.location.href
});

const pdfIframe = document.getElementById('pdf-iframe');
const loading = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const errorMessage = document.getElementById('error-message');
const fileNameEl = document.getElementById('file-name');

// Set file name in header
fileNameEl.textContent = decodeURIComponent(fileName);
document.title = decodeURIComponent(fileName);

// Add timeout detection
let loadingTimeout;
let hasLoaded = false;

// Load PDF from backend
async function loadPDF() {
  try {
    if (!courseId || !fileId) {
      console.error('❌ [PDF-VIEWER] Missing required parameters:', { courseId, fileId });
      throw new Error('Missing course ID or file ID');
    }

    const backendUrl = 'https://web-production-9aaba7.up.railway.app';
    const pdfUrl = `${backendUrl}/pdfs/${encodeURIComponent(courseId)}/${encodeURIComponent(fileId)}`;

    console.log('🔍 [PDF-VIEWER] Constructed backend URL:', pdfUrl);
    console.log('🔍 [PDF-VIEWER] Setting iframe src...');

    // Set timeout to detect if loading never completes
    loadingTimeout = setTimeout(() => {
      if (!hasLoaded) {
        console.error('❌ [PDF-VIEWER] Loading timeout after 10 seconds - iframe onload never fired');
        console.error('❌ [PDF-VIEWER] This likely means:');
        console.error('   1. Backend redirect to GCS is not working');
        console.error('   2. GCS URL is inaccessible');
        console.error('   3. Cross-origin iframe loading issue');
        console.error('   4. PDF content type not triggering onload event');
        loading.style.display = 'none';
        errorDiv.style.display = 'block';
        errorMessage.textContent = 'Loading timeout - the document is taking too long to load. Check console for details.';
      }
    }, 10000);

    // Set iframe source to PDF URL
    pdfIframe.src = pdfUrl;
    console.log('✅ [PDF-VIEWER] iframe.src set successfully');

    // Hide loading indicator when PDF loads
    pdfIframe.onload = () => {
      console.log('✅ [PDF-VIEWER] iframe.onload fired - document loaded successfully');
      hasLoaded = true;
      clearTimeout(loadingTimeout);
      loading.style.display = 'none';
    };

    pdfIframe.onerror = (event) => {
      console.error('❌ [PDF-VIEWER] iframe.onerror fired:', event);
      hasLoaded = true;
      clearTimeout(loadingTimeout);
      loading.style.display = 'none';
      errorDiv.style.display = 'block';
      errorMessage.textContent = 'The document could not be loaded from the server.';
    };

    // Also try to detect network errors
    console.log('🔍 [PDF-VIEWER] Attempting to fetch URL to check accessibility...');
    fetch(pdfUrl, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        console.log('✅ [PDF-VIEWER] HEAD request completed (note: no-cors mode, so status unknown)');
      })
      .catch(err => {
        console.error('❌ [PDF-VIEWER] HEAD request failed:', err);
      });

  } catch (error) {
    console.error('❌ [PDF-VIEWER] Exception in loadPDF:', error);
    console.error('❌ [PDF-VIEWER] Stack trace:', error.stack);
    clearTimeout(loadingTimeout);
    loading.style.display = 'none';
    errorDiv.style.display = 'block';
    errorMessage.textContent = error.message || 'An unexpected error occurred.';
  }
}

// Load PDF on page load
console.log('🔍 [PDF-VIEWER] Calling loadPDF()...');
loadPDF();
