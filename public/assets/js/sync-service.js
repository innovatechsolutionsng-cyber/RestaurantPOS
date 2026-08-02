/**
 * Sync Service for Cashier Terminals
 * Periodically syncs with admin server
 */

class SyncService {
  constructor(dbInstance) {
    this.db = dbInstance;
    this.adminIp = null;
    this.adminPort = 3000;
    this.terminalId = null;
    this.terminalName = null;
    this.syncInterval = 30000; // 30 seconds
    this.syncTimer = null;
    this.isOnline = false;
    this.lastSyncTime = new Date().toISOString();
    this.syncCallbacks = [];
  }

  /**
   * Initialize sync service
   */
  async initialize() {
    try {
      // Load terminal config
      const configSetting = await this.db.getSetting('terminalConfig');
      if (!configSetting) {
        console.warn('⚠️  Terminal not configured for network sync');
        return false;
      }

      const config = JSON.parse(configSetting.value);
      this.adminIp = config.adminIp;
      this.terminalId = config.terminalId;
      this.terminalName = config.terminalName;

      console.log(`✓ Sync Service initialized for ${this.terminalName}`);
      return true;
    } catch (err) {
      console.error('Error initializing sync service:', err);
      return false;
    }
  }

  /**
   * Register terminal with admin
   */
  async registerWithAdmin() {
    try {
      const response = await fetch(this.getApiUrl('/api/terminals/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: this.terminalId,
          terminalName: this.terminalName,
          terminalType: 'cashier'
        })
      });

      if (response.ok) {
        this.isOnline = true;
        console.log(`✓ Registered with admin: ${this.adminIp}`);
        return true;
      } else {
        this.isOnline = false;
        console.warn(`⚠️  Admin registration failed: ${response.status}`);
        return false;
      }
    } catch (err) {
      this.isOnline = false;
      console.warn(`⚠️  Cannot connect to admin: ${err.message}`);
      return false;
    }
  }

  /**
   * Sync orders with admin
   */
  async syncOrders() {
    try {
      if (!this.isOnline) return;

      // Get all orders created/updated since last sync
      const allOrdersSetting = await this.db.getSetting('allOrders');
      const orders = allOrdersSetting ? JSON.parse(allOrdersSetting.value) : [];
      
      const recentOrders = orders.filter(order => {
        const orderTime = new Date(order.updatedAt || order.createdAt);
        return orderTime >= new Date(this.lastSyncTime);
      });

      if (recentOrders.length === 0) return;

      const response = await fetch(this.getApiUrl('/api/orders/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: this.terminalId,
          orders: recentOrders,
          lastSyncTime: this.lastSyncTime
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✓ Synced ${data.synced} orders with admin`);
        
        // Apply admin updates locally
        if (data.updates && data.updates.length > 0) {
          await this.applyOrderUpdates(data.updates);
        }
        
        this.lastSyncTime = new Date().toISOString();
        return true;
      }
    } catch (err) {
      console.warn(`⚠️  Order sync failed: ${err.message}`);
      this.isOnline = false;
    }
    return false;
  }

  /**
   * Sync users from admin
   */
  async syncUsers() {
    try {
      if (!this.isOnline) return;

      const response = await fetch(this.getApiUrl('/api/users/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminalId: this.terminalId })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Save user list locally
        await this.db.saveSetting('syncedUsers', JSON.stringify(data.users));
        console.log(`✓ Synced ${data.count} users from admin`);
        
        return true;
      }
    } catch (err) {
      console.warn(`⚠️  User sync failed: ${err.message}`);
    }
    return false;
  }

  /**
   * Send cash report to admin
   */
  async sendCashReport(totalCash, reportData) {
    try {
      if (!this.isOnline) {
        console.warn('⚠️  Offline - cash report will be saved locally');
        return false;
      }

      const response = await fetch(this.getApiUrl('/api/cash/report'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: this.terminalId,
          totalCash,
          reportData
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`✓ Cash report sent to admin: ${data.reportId}`);
        return true;
      }
    } catch (err) {
      console.warn(`⚠️  Cash report send failed: ${err.message}`);
      this.isOnline = false;
    }
    return false;
  }

  /**
   * Apply updates from admin
   */
  async applyOrderUpdates(updates) {
    try {
      const allOrdersSetting = await this.db.getSetting('allOrders');
      let orders = allOrdersSetting ? JSON.parse(allOrdersSetting.value) : [];

      for (const update of updates) {
        const index = orders.findIndex(o => o.id === update.id);
        if (index >= 0) {
          // Update existing
          orders[index] = update;
        } else {
          // Add new
          orders.push(update);
        }
      }

      await this.db.saveSetting('allOrders', JSON.stringify(orders));
      
      // Notify listeners
      this.notifyListeners('orders-updated', updates);
    } catch (err) {
      console.error('Error applying order updates:', err);
    }
  }

  /**
   * Start periodic sync
   */
  startSync() {
    console.log('🔄 Starting sync service...');
    
    // Sync immediately
    this.performSync();
    
    // Then sync periodically
    this.syncTimer = setInterval(() => {
      this.performSync();
    }, this.syncInterval);

    console.log(`✓ Sync service running (every ${this.syncInterval / 1000}s)`);
  }

  /**
   * Perform all sync operations
   */
  async performSync() {
    // Try to register if offline
    if (!this.isOnline) {
      await this.registerWithAdmin();
    }

    if (this.isOnline) {
      await Promise.all([
        this.syncOrders(),
        this.syncUsers()
      ]);
    }
  }

  /**
   * Stop sync service
   */
  stopSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('✓ Sync service stopped');
    }
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      adminIp: this.adminIp,
      terminalId: this.terminalId,
      terminalName: this.terminalName,
      lastSyncTime: this.lastSyncTime,
      syncInterval: this.syncInterval
    };
  }

  /**
   * Helper: Build API URL
   */
  getApiUrl(endpoint) {
    return `http://${this.adminIp}:${this.adminPort}${endpoint}`;
  }

  /**
   * Register callback for sync events
   */
  onSyncEvent(callback) {
    this.syncCallbacks.push(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners(event, data) {
    this.syncCallbacks.forEach(cb => {
      try {
        cb(event, data);
      } catch (err) {
        console.error('Error in sync callback:', err);
      }
    });
  }
}

// Export for use in cashier app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncService;
}
