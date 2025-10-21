/**
 * File Processor
 * Handles material filtering, categorization, downloading, and ZIP creation
 */

class FileProcessor {
  constructor() {
    this.categories = {
      syllabus: [],
      lectures: [],
      readings: [],
      assignments: [],
      pages: [],
      other: []
    };

    // File extensions we want to include
    this.allowedExtensions = [
      'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md',
      'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf'
    ];

    // Keywords to exclude
    this.excludeKeywords = [
      'grade', 'grades', 'submission', 'calendar', 'export',
      'student_submissions', 'gradebook'
    ];

    // Keywords for categorization
    this.syllabusKeywords = ['syllabus', 'course outline', 'course plan'];
    this.lectureKeywords = ['lecture', 'slides', 'presentation', 'notes', 'week', 'chapter', 'lesson'];
    this.readingKeywords = ['reading', 'textbook', 'article', 'chapter', 'book'];
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
   * Categorize file based on name and metadata
   */
  categorizeFile(name, type = 'file') {
    if (!name) return 'other';

    const lowerName = name.toLowerCase();

    // Check for syllabus
    if (this.syllabusKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'syllabus';
    }

    // Check for lectures
    if (this.lectureKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'lectures';
    }

    // Check for readings
    if (this.readingKeywords.some(keyword => lowerName.includes(keyword))) {
      return 'readings';
    }

    // Assignments
    if (type === 'assignment') {
      return 'assignments';
    }

    // Pages
    if (type === 'page') {
      return 'pages';
    }

    return 'other';
  }

  /**
   * Process and filter course materials
   */
  processMaterials(materials, preferences) {
    console.log('Processing materials with preferences:', preferences);

    this.categories = {
      syllabus: [],
      lectures: [],
      readings: [],
      assignments: [],
      pages: [],
      other: []
    };

    // Process files
    if (materials.files && materials.files.length > 0) {
      materials.files.forEach(file => {
        if (!file.display_name || this.shouldExclude(file.display_name)) {
          return;
        }

        if (this.isAllowedFile(file.display_name)) {
          const category = this.categorizeFile(file.display_name, 'file');

          const processedFile = {
            id: file.id,
            name: file.display_name,
            url: file.url,
            size: file.size || 0,
            type: 'file',
            category: category,
            mimeType: file['content-type'] || 'application/octet-stream'
          };

          this.categories[category].push(processedFile);
        }
      });
    }

    // Process assignments
    if (materials.assignments && materials.assignments.length > 0 && preferences.includeAssignments) {
      materials.assignments.forEach(assignment => {
        if (!assignment.name || this.shouldExclude(assignment.name)) {
          return;
        }

        const processedAssignment = {
          id: assignment.id,
          name: assignment.name,
          url: assignment.html_url,
          description: assignment.description || '',
          type: 'assignment',
          category: 'assignments',
          dueDate: assignment.due_at
        };

        this.categories.assignments.push(processedAssignment);
      });
    }

    // Process pages
    if (materials.pages && materials.pages.length > 0 && preferences.includePages) {
      materials.pages.forEach(page => {
        if (!page.title || this.shouldExclude(page.title)) {
          return;
        }

        const category = this.categorizeFile(page.title, 'page');

        const processedPage = {
          id: page.page_id,
          name: page.title,
          url: page.url,
          type: 'page',
          category: category
        };

        this.categories[category].push(processedPage);
      });
    }

    // Filter by preferences
    if (!preferences.includeSyllabus) {
      this.categories.syllabus = [];
    }
    if (!preferences.includeLectures) {
      this.categories.lectures = [];
    }
    if (!preferences.includeReadings) {
      this.categories.readings = [];
    }

    console.log('Categorized materials:', this.categories);
    return this.categories;
  }

  /**
   * Get summary of processed materials
   */
  getSummary() {
    const summary = {
      total: 0,
      byCategory: {}
    };

    Object.keys(this.categories).forEach(category => {
      const count = this.categories[category].length;
      summary.byCategory[category] = count;
      summary.total += count;
    });

    return summary;
  }

  /**
   * Get total size of files
   */
  getTotalSize() {
    let totalSize = 0;

    Object.keys(this.categories).forEach(category => {
      this.categories[category].forEach(item => {
        if (item.size) {
          totalSize += item.size;
        }
      });
    });

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
   * Download all materials and create ZIP
   */
  async downloadAllAsZip(canvasAPI, courseName, progressCallback) {
    try {
      // Load JSZip dynamically
      const JSZip = window.JSZip;
      if (!JSZip) {
        throw new Error('JSZip library not loaded');
      }

      const zip = new JSZip();
      const courseFolder = zip.folder(this.sanitizeFilename(courseName));

      let processed = 0;
      let total = this.getSummary().total;

      // Process each category
      for (const [categoryName, items] of Object.entries(this.categories)) {
        if (items.length === 0) continue;

        const categoryFolder = courseFolder.folder(categoryName);

        for (const item of items) {
          try {
            if (progressCallback) {
              progressCallback(`Downloading ${item.name} (${processed + 1}/${total})`,
                             (processed / total) * 100);
            }

            if (item.type === 'file') {
              // Download actual file
              const blob = await canvasAPI.downloadFile(item.url);
              categoryFolder.file(this.sanitizeFilename(item.name), blob);
            } else if (item.type === 'assignment') {
              // Create text file with assignment details
              const content = `Assignment: ${item.name}\n\n` +
                            `Description:\n${item.description}\n\n` +
                            `Due Date: ${item.dueDate || 'Not specified'}\n\n` +
                            `URL: ${item.url}`;
              categoryFolder.file(`${this.sanitizeFilename(item.name)}.txt`, content);
            } else if (item.type === 'page') {
              // Create text file with page URL
              const content = `Page: ${item.name}\n\n` +
                            `URL: ${item.url}\n\n` +
                            `Note: Please visit the URL above to view the full page content.`;
              categoryFolder.file(`${this.sanitizeFilename(item.name)}.txt`, content);
            }

            processed++;
          } catch (error) {
            console.error(`Error processing ${item.name}:`, error);
            // Continue with other files
          }
        }
      }

      if (progressCallback) {
        progressCallback('Creating ZIP file...', 95);
      }

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        if (progressCallback) {
          progressCallback(`Creating ZIP file... ${metadata.percent.toFixed(0)}%`, 95 + (metadata.percent * 0.05));
        }
      });

      if (progressCallback) {
        progressCallback('Download complete!', 100);
      }

      return zipBlob;
    } catch (error) {
      console.error('Error creating ZIP:', error);
      throw error;
    }
  }

  /**
   * Get all items as flat list
   */
  getAllItems() {
    const allItems = [];
    Object.values(this.categories).forEach(items => {
      allItems.push(...items);
    });
    return allItems;
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileProcessor;
}
