/**
 * IndexedDB wrapper for storing course materials with blobs
 * Chrome storage has ~10MB limit, IndexedDB has ~unlimited storage
 */

class MaterialsDB {
  constructor() {
    this.dbName = 'CanvasMaterialsDB';
    this.version = 1;
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

        // Create object store for course materials
        if (!db.objectStoreNames.contains('materials')) {
          const objectStore = db.createObjectStore('materials', { keyPath: 'courseId' });
          objectStore.createIndex('courseName', 'courseName', { unique: false });
          objectStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
      };
    });
  }

  /**
   * Save course materials with blobs
   */
  async saveMaterials(courseId, courseName, materials) {
    if (!this.db) await this.open();

    console.log(`💾 [IndexedDB] Saving materials for course ${courseId}...`);

    // Count blobs being saved
    let blobCount = 0;
    let totalItems = 0;

    // Count module items
    if (materials.modules) {
      materials.modules.forEach(module => {
        if (module.items) {
          totalItems += module.items.length;
          module.items.forEach(item => {
            if (item.blob) blobCount++;
          });
        }
      });
    }

    // Count other categories
    ['files', 'pages', 'assignments'].forEach(category => {
      if (materials[category]) {
        totalItems += materials[category].length;
        materials[category].forEach(item => {
          if (item.blob) blobCount++;
        });
      }
    });

    console.log(`  📊 Saving ${totalItems} items with ${blobCount} blobs`);
    console.log(`  📦 Modules: ${materials.modules?.length || 0}`);
    console.log(`  📄 Files: ${materials.files?.length || 0}`);
    console.log(`  📝 Pages: ${materials.pages?.length || 0}`);
    console.log(`  ✏️  Assignments: ${materials.assignments?.length || 0}`);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['materials'], 'readwrite');
      const store = transaction.objectStore('materials');

      const data = {
        courseId,
        courseName,
        materials,
        lastUpdated: Date.now()
      };

      const request = store.put(data);

      request.onsuccess = () => {
        console.log(`✅ [IndexedDB] Successfully saved materials for ${courseId} with ${blobCount} blobs`);
        resolve();
      };
      request.onerror = () => {
        console.error(`❌ [IndexedDB] Failed to save materials for ${courseId}:`, request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Load course materials
   */
  async loadMaterials(courseId) {
    if (!this.db) await this.open();

    console.log(`📂 [IndexedDB] Loading materials for course ${courseId}...`);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['materials'], 'readonly');
      const store = transaction.objectStore('materials');
      const request = store.get(courseId);

      request.onsuccess = () => {
        const result = request.result;

        if (!result) {
          console.log(`⚠️  [IndexedDB] No materials found for course ${courseId}`);
          resolve(null);
          return;
        }

        // Count blobs loaded
        let blobCount = 0;
        let totalItems = 0;

        const materials = result.materials;

        // Count module items
        if (materials.modules) {
          materials.modules.forEach(module => {
            if (module.items) {
              totalItems += module.items.length;
              module.items.forEach(item => {
                if (item.blob) blobCount++;
              });
            }
          });
        }

        // Count other categories
        ['files', 'pages', 'assignments'].forEach(category => {
          if (materials[category]) {
            totalItems += materials[category].length;
            materials[category].forEach(item => {
              if (item.blob) blobCount++;
            });
          }
        });

        console.log(`✅ [IndexedDB] Loaded materials for ${courseId}`);
        console.log(`  📊 Loaded ${totalItems} items with ${blobCount} blobs`);
        console.log(`  📦 Modules: ${materials.modules?.length || 0}`);
        console.log(`  📄 Files: ${materials.files?.length || 0}`);
        console.log(`  📝 Pages: ${materials.pages?.length || 0}`);
        console.log(`  ✏️  Assignments: ${materials.assignments?.length || 0}`);
        console.log(`  🕐 Last updated: ${new Date(result.lastUpdated).toLocaleString()}`);

        resolve(result);
      };
      request.onerror = () => {
        console.error(`❌ [IndexedDB] Failed to load materials for ${courseId}:`, request.error);
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
