/**
 * File Processor
 * Handles material filtering, categorization, and file processing
 */

class FileProcessor {
  constructor() {
    // Store materials by type (matches Canvas structure)
    this.materials = {
      modules: [],
      files: []
    };

    // File extensions we want to include
    this.allowedExtensions = [
      'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md',
      'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf',
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'csv', 'rtf'
    ];

    // Keywords to exclude
    this.excludeKeywords = [
      'grade', 'grades', 'submission', 'calendar', 'export',
      'student_submissions', 'gradebook'
    ];
  }

  /**
   * Check if file should be included based on extension
   */
  isAllowedFile(filename) {
    if (!filename) return false;

    const extension = filename.split('.').pop().toLowerCase();
    return this.allowedExtensions.includes(extension);
  }

  /**
   * Check if file/item should be excluded
   */
  shouldExclude(name) {
    if (!name) return true;

    const lowerName = name.toLowerCase();
    return this.excludeKeywords.some(keyword => lowerName.includes(keyword));
  }


  /**
   * Process and filter course materials
   */
  processMaterials(materials, preferences) {
    console.log('Processing materials with preferences:', preferences);

    this.materials = {
      modules: [],
      files: [],
      pages: [],
      assignments: []
    };

    // Process modules (keep Canvas structure as-is)
    if (materials.modules && materials.modules.length > 0) {
      materials.modules.forEach(module => {
        // Filter module items to only include allowed file types
        const processedModule = {
          id: module.id,
          name: module.name,
          position: module.position,
          items: []
        };

        if (module.items && module.items.length > 0) {
          module.items.forEach(item => {
            // Only include File type items with allowed extensions
            if (item.type === 'File' && item.title && this.isAllowedFile(item.title)) {
              if (this.shouldExclude(item.title)) {
                return;
              }

              processedModule.items.push({
                id: item.id,
                content_id: item.content_id,
                title: item.title,
                url: item.url,
                type: item.type,
                position: item.position
              });
            }
          });
        }

        // Only add module if it has file items
        if (processedModule.items.length > 0) {
          this.materials.modules.push(processedModule);
        }
      });
    }

    // Process standalone files (not in modules)
    if (materials.files && materials.files.length > 0) {
      console.log(`🔍 Processing ${materials.files.length} raw files from Canvas API`);

      let excluded = 0;
      let notAllowed = 0;
      let processed = 0;

      materials.files.forEach(file => {
        if (!file.display_name) {
          excluded++;
          return;
        }

        if (this.shouldExclude(file.display_name)) {
          console.log(`  ❌ Excluded: ${file.display_name} (matches exclude keywords)`);
          excluded++;
          return;
        }

        if (!this.isAllowedFile(file.display_name)) {
          console.log(`  ⚠️ Not allowed: ${file.display_name} (file type not supported)`);
          notAllowed++;
          return;
        }

        const processedFile = {
          id: file.id,
          name: file.display_name,
          display_name: file.display_name,
          url: file.url,
          size: file.size || 0,
          type: 'file',
          mimeType: file['content-type'] || 'application/octet-stream'
        };

        this.materials.files.push(processedFile);
        processed++;
      });

      console.log(`  ✓ Processed: ${processed}`);
      console.log(`  ❌ Excluded: ${excluded}`);
      console.log(`  ⚠️ Not allowed: ${notAllowed}`);
    }

    // Process pages (HTML content that can be useful for context)
    if (materials.pages && materials.pages.length > 0) {
      console.log(`📄 Processing ${materials.pages.length} pages from Canvas`);

      materials.pages.forEach(page => {
        if (!page.title || this.shouldExclude(page.title)) {
          return;
        }

        this.materials.pages.push({
          id: page.page_id,
          title: page.title,
          url: page.url,
          html_url: page.html_url,
          type: 'page'
        });
      });

      console.log(`  ✓ Processed ${this.materials.pages.length} pages`);
    }

    // Process assignments (descriptions can provide context)
    if (materials.assignments && materials.assignments.length > 0) {
      console.log(`📋 Processing ${materials.assignments.length} assignments from Canvas`);

      materials.assignments.forEach(assignment => {
        if (!assignment.name || this.shouldExclude(assignment.name)) {
          return;
        }

        this.materials.assignments.push({
          id: assignment.id,
          name: assignment.name,
          description: assignment.description || '',
          html_url: assignment.html_url,
          due_at: assignment.due_at,
          type: 'assignment'
        });
      });

      console.log(`  ✓ Processed ${this.materials.assignments.length} assignments`);
    }

    console.log('Processed materials:', this.materials);
    return this.materials;
  }

  /**
   * Get summary of processed materials
   */
  getSummary() {
    const summary = {
      total: 0,
      modules: 0,
      moduleFiles: 0,
      standaloneFiles: 0,
      pages: 0,
      assignments: 0
    };

    // Count modules and files in modules
    if (this.materials.modules) {
      summary.modules = this.materials.modules.length;
      this.materials.modules.forEach(module => {
        if (module.items) {
          summary.moduleFiles += module.items.length;
        }
      });
    }

    // Count standalone files
    if (this.materials.files) {
      summary.standaloneFiles = this.materials.files.length;
    }

    // Count pages
    if (this.materials.pages) {
      summary.pages = this.materials.pages.length;
    }

    // Count assignments
    if (this.materials.assignments) {
      summary.assignments = this.materials.assignments.length;
    }

    summary.total = summary.moduleFiles + summary.standaloneFiles + summary.pages + summary.assignments;

    return summary;
  }

  /**
   * Get total size of files
   */
  getTotalSize() {
    let totalSize = 0;

    // Add size from standalone files
    if (this.materials.files) {
      this.materials.files.forEach(file => {
        if (file.size) {
          totalSize += file.size;
        }
      });
    }

    // Note: Module items from Canvas API don't include file size
    // Size is only available for standalone files

    return totalSize;
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Create sanitized filename
   */
  sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9_\-\.]/gi, '_');
  }

  /**
   * Download file from URL
   */
  async downloadFile(url, apiToken) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }

  /**
   * Create text file from content
   */
  createTextFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    return blob;
  }

  /**
   * Get all items as flat list
   */
  getAllItems() {
    const allItems = [];

    // Add all module items
    if (this.materials.modules) {
      this.materials.modules.forEach(module => {
        if (module.items) {
          allItems.push(...module.items);
        }
      });
    }

    // Add all standalone files
    if (this.materials.files) {
      allItems.push(...this.materials.files);
    }

    return allItems;
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileProcessor;
}
