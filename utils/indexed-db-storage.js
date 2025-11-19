/**
 * IndexedDB wrapper for storing course materials with blobs
 * Chrome storage has ~10MB limit, IndexedDB has ~unlimited storage
 */

class MaterialsDB {
  constructor() {
    this.dbName = 'CanvasMaterialsDB';
    this.version = 2;
    this.db = null;
  }

  /**
   * Open database connection
   */
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

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
        }
      };
    });
  }

  /**
   * Save course materials with blobs
   */
  async saveMaterials(courseId, courseName, materials) {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['materials'], 'readwrite');
      const store = transaction.objectStore('materials');

      // Ensure courseName is a string (defensive check)
      let validCourseName = 'Unknown Course';
      if (typeof courseName === 'string') {
        validCourseName = courseName;
      } else if (typeof courseName === 'object' && courseName !== null) {
        validCourseName = courseName.name || courseName.courseName || 'Unknown Course';
        console.warn('⚠️ [IndexedDB] courseName was an object, extracted:', validCourseName, 'from:', courseName);
      } else if (courseName) {
        validCourseName = String(courseName);
      }

      const data = {
        courseId,
        courseName: validCourseName,
        materials,
        lastUpdated: Date.now()
      };

      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error(`Failed to save materials for ${courseId}:`, request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Load course materials
   */
  async loadMaterials(courseId) {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['materials'], 'readonly');
      const store = transaction.objectStore('materials');
      const request = store.get(courseId);

      request.onsuccess = () => {
        const result = request.result;

        if (!result) {
          resolve(null);
          return;
        }

        resolve(result);
      };
      request.onerror = () => {
        console.error(`Failed to load materials for ${courseId}:`, request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Delete course materials
   */
  async deleteMaterials(courseId) {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['materials'], 'readwrite');
      const store = transaction.objectStore('materials');
      const request = store.delete(courseId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * List all stored courses
   */
  async listCourses() {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['materials'], 'readonly');
      const store = transaction.objectStore('materials');
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MaterialsDB;
}
