// Toast notification system
function showToast(message, type = 'success', duration = 3000) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: relative;
    padding: 12px 16px;
    border-radius: 10px;
    font-weight: 600;
    z-index: 2147483647;
    animation: slideInRight 0.3s ease-out;
    box-shadow: 0 8px 24px rgba(0,0,0,0.16);
    max-width: min(360px, calc(100vw - 24px));
    line-height: 1.4;
    pointer-events: none;
  `;
  
  if (type === 'success') {
    toast.style.backgroundColor = '#dcfce7';
    toast.style.color = '#166534';
    toast.style.border = '1px solid #86efac';
    toast.textContent = '✓ ' + message;
  } else if (type === 'error') {
    toast.style.backgroundColor = '#fee2e2';
    toast.style.color = '#991b1b';
    toast.style.border = '1px solid #fca5a5';
    toast.textContent = '✗ ' + message;
  } else if (type === 'info') {
    toast.style.backgroundColor = '#dbeafe';
    toast.style.color = '#1e40af';
    toast.style.border = '1px solid #93c5fd';
    toast.textContent = 'ℹ ' + message;
  }

  let container = document.getElementById('app-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'app-toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: flex-end;
      z-index: 2147483647;
      pointer-events: none;
      max-width: min(360px, calc(100vw - 24px));
    `;
    (document.body || document.documentElement).appendChild(container);
  }
  container.appendChild(toast);
  
  // Add animation
  const style = document.createElement('style');
  if (!document.getElementById('toast-animation-style')) {
    style.id = 'toast-animation-style';
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

// Admin UI glue: moves inline script from admin.html into this file
(async function(){
  await RestaurantDB.init();
  if(!Auth.requireRole('admin')) return;

  const API_BASE_URL = (() => {
    try {
      if (window.location.protocol.startsWith('http')) {
        return `${window.location.protocol}//${window.location.host}`;
      }
    } catch (e) {
      return 'http://localhost:3000';
    }
    return 'http://localhost:3000';
  })();

  async function fetchBackend(path, options = {}) {
    const url = `${API_BASE_URL}${path}`;
    const response = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const errorText = body && (body.message || body.error) ? (body.message || body.error) : response.statusText || 'backend_error';
      const error = new Error(errorText);
      if (body) error.responseBody = body;
      throw error;
    }
    return response.json();
  }

  let businessDayCutoff = '00:00';
  let businessDayCutoffInput = null;
  let btnSaveBusinessDay = null;
  let btnResetBusinessDay = null;
  let businessDaySettingsMessage = null;
  let businessDayRefreshTimer = null;
  let realtimeRefreshTimer = null;
  let currentLowStockProducts = [];
  const REALTIME_REFRESH_INTERVAL = 15000;

  function showLowStockModal(products) {
    if (!Array.isArray(products)) products = [];
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'false');
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="low-stock-modal-title">
        <header class="modal-header">
          <div>
            <div class="modal-badge">Low stock alert</div>
            <h3 id="low-stock-modal-title">${products.length} item${products.length === 1 ? '' : 's'} need restocking</h3>
          </div>
        </header>
        <div class="modal-body">
          <p class="muted">These products are low in inventory. Replenish them soon to keep service smooth and avoid stockouts.</p>
          <p class="modal-note">Tap outside the panel to close this overview.</p>
          <div class="low-stock-list">
            ${products.length > 0 ? products.map(product => {
              const quantity = Number(product.quantity || 0);
              return `
                <article class="product-alert-card">
                  <div class="product-alert-row">
                    <div>
                      <p class="product-alert-title">${product.name || product.productName || 'Unnamed product'}</p>
                      <p class="product-alert-meta">ID: ${product.id || product.productId || 'N/A'}</p>
                    </div>
                    <span class="product-alert-count">${quantity} left</span>
                  </div>
                </article>
              `;
            }).join('') : '<div class="modal-empty-state">No low-stock items found. Inventory is healthy at the moment.</div>'}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('.modal-backdrop').forEach((el) => {
      if (el) el.addEventListener('click', () => modal.remove());
    });
  }

  function renderLowStockSummaryChip(count, enabled = false) {
    const summaryChips = document.querySelectorAll('.overview-summary .summary-chip');
    if (summaryChips.length < 3) return;
    const lowStockChip = summaryChips[2];
    if (!enabled) {
      lowStockChip.textContent = 'Low-stock alerts disabled';
      lowStockChip.classList.remove('low-stock-alert');
      lowStockChip.removeAttribute('role');
      lowStockChip.removeAttribute('tabindex');
      lowStockChip.setAttribute('aria-label', 'Low-stock alerts are disabled');
    } else if (count > 0) {
      lowStockChip.textContent = `${count} low-stock alerts`;
      lowStockChip.classList.add('low-stock-alert');
      lowStockChip.setAttribute('aria-label', `${count} low-stock alerts. Click to view details.`);
      lowStockChip.setAttribute('role', 'button');
      lowStockChip.setAttribute('tabindex', '0');
    } else {
      lowStockChip.textContent = 'No low-stock alerts';
      lowStockChip.classList.remove('low-stock-alert');
      lowStockChip.removeAttribute('role');
      lowStockChip.removeAttribute('tabindex');
      lowStockChip.setAttribute('aria-label', 'No low-stock alerts');
    }
    if (!lowStockChip.dataset.lowstockBound) {
      lowStockChip.addEventListener('click', () => {
        if (lowStockChip.dataset.lowstockEnabled !== 'true') return;
        showLowStockModal(currentLowStockProducts);
      });
      lowStockChip.addEventListener('keydown', (event) => {
        if (lowStockChip.dataset.lowstockEnabled !== 'true') return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showLowStockModal(currentLowStockProducts);
        }
      });
      lowStockChip.dataset.lowstockBound = 'true';
    }
    lowStockChip.dataset.lowstockEnabled = String(enabled === true);
  }

  let receiptSettings = {
    businessName: '',
    address: '',
    phone: '',
    email: '',
    footerMessage: ''
  };
  let receiptBusinessNameInput = null;
  let receiptAddressInput = null;
  let receiptPhoneInput = null;
  let receiptEmailInput = null;
  let receiptFooterMessageInput = null;
  let btnSaveReceiptSettings = null;
  let receiptSettingsMessage = null;

  function parseBusinessDayCutoff(value) {
    if (!value || typeof value !== 'string') return null;
    const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : null;
  }

  function getBusinessDayRange(cutoff = '00:00', reference = new Date()) {
    const normalized = parseBusinessDayCutoff(cutoff) || '00:00';
    const [hours, minutes] = normalized.split(':').map(Number);
    const boundary = new Date(reference);
    boundary.setHours(hours, minutes, 0, 0);
    const start = new Date(boundary);
    if (reference < boundary) {
      start.setDate(start.getDate() - 1);
    }
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  function getNextBusinessDayBoundary(cutoff = '00:00', reference = new Date()) {
    const normalized = parseBusinessDayCutoff(cutoff) || '00:00';
    const [hours, minutes] = normalized.split(':').map(Number);
    const nextBoundary = new Date(reference);
    nextBoundary.setHours(hours, minutes, 0, 0);
    if (reference >= nextBoundary) {
      nextBoundary.setDate(nextBoundary.getDate() + 1);
    }
    return nextBoundary;
  }

  function scheduleBusinessDayRefresh() {
    if (businessDayRefreshTimer) {
      clearTimeout(businessDayRefreshTimer);
      businessDayRefreshTimer = null;
    }
    const nextBoundary = getNextBusinessDayBoundary(businessDayCutoff);
    const delay = nextBoundary.getTime() - Date.now();
    if (delay <= 0) {
      businessDayRefreshTimer = setTimeout(scheduleBusinessDayRefresh, 1000);
      return;
    }
    businessDayRefreshTimer = setTimeout(async () => {
      try {
        await loadBusinessDaySetting();
        await updateOperationalSnapshotCounts();
        await renderRecentSalesTable();
        if (typeof loadSalesPanel === 'function') {
          await loadSalesPanel();
        }
        showToast('Business day boundary reached. Dashboard refreshed for current business day.', 'info', 2500);
      } catch (err) {
        console.error('Failed to refresh admin dashboard on business day boundary:', err);
      } finally {
        scheduleBusinessDayRefresh();
      }
    }, delay);
  }

  async function refreshAdminRealtime() {
    try {
      await updateOperationalSnapshotCounts();
      await renderRecentSalesTable();
      if (typeof loadSalesPanel === 'function') {
        await loadSalesPanel();
      }
    } catch (err) {
      console.warn('Failed to refresh admin realtime dashboard:', err);
    }
  }

  function startAdminRealtimeRefresh() {
    if (realtimeRefreshTimer) {
      clearInterval(realtimeRefreshTimer);
    }
    realtimeRefreshTimer = setInterval(refreshAdminRealtime, REALTIME_REFRESH_INTERVAL);
  }

  async function updateOperationalSnapshotCounts() {
    const productCountEl = document.getElementById('snapshot-product-count');
    const userCountEl = document.getElementById('snapshot-user-count');
    const eventCountEl = document.getElementById('snapshot-event-count');
    const revenueEl = document.getElementById('stat-daily-revenue');
    const pendingOrdersEl = document.getElementById('stat-pending-orders');
    const completedOrdersEl = document.getElementById('stat-completed-orders');
    const activeStaffEl = document.getElementById('stat-active-staff');
    const ordersTodayChipEl = document.getElementById('summary-orders-today');
    const staffOnlineChipEl = document.getElementById('summary-staff-online');
    if (!productCountEl && !userCountEl && !eventCountEl && !revenueEl && !pendingOrdersEl && !completedOrdersEl && !activeStaffEl && !ordersTodayChipEl && !staffOnlineChipEl) return;

    try {
      if (BACKEND_AVAILABLE) {
        const [productsRes, usersRes, eventsRes, ordersRes] = await Promise.all([
          fetchBackend('/api/products').catch(() => ({ products: [] })),
          fetchBackend('/api/users/list').catch(() => ({ users: [] })),
          fetchBackend('/api/events').catch(() => ({ events: [] })),
          fetchBackend('/api/orders/all').catch(() => ({ orders: [] }))
        ]);
        const products = productsRes.products || [];
        const users = usersRes.users || [];
        const events = eventsRes.events || [];
        const orders = ordersRes.orders || [];

        const activeStaffCount = (users || []).filter(u => u.status === 'active' && u.role && u.role !== 'admin').length;
        const range = getBusinessDayRange(businessDayCutoff);
        const currentDayOrders = (orders || []).filter(o => {
          const createdAt = getOrderCreatedAt(o);
          if (Number.isNaN(createdAt.getTime())) return false;
          return createdAt >= range.start && createdAt < range.end;
        });
        const dailyOrderCount = currentDayOrders.length;
        const completedOrderCount = currentDayOrders.filter(o => getOrderStatus(o) === 'completed').length;
        const pendingOrderCount = currentDayOrders.filter(o => getOrderStatus(o) === 'pending').length;
        const lowStockCount = (products || []).filter(p => Number(p.quantity || 0) > 0 && Number(p.quantity || 0) <= 5).length;

        if (productCountEl) productCountEl.textContent = String(products.length);
        if (ordersTodayChipEl) ordersTodayChipEl.textContent = `${dailyOrderCount} order${dailyOrderCount === 1 ? '' : 's'} today`;
        if (staffOnlineChipEl) staffOnlineChipEl.textContent = `${activeStaffCount} staff online`;
        if (userCountEl) userCountEl.textContent = String(users.length);
        if (eventCountEl) eventCountEl.textContent = String(events.length);
        if (activeStaffEl) activeStaffEl.textContent = String(activeStaffCount);
        if (pendingOrdersEl) pendingOrdersEl.textContent = String(pendingOrderCount);
        if (completedOrdersEl) completedOrdersEl.textContent = String(completedOrderCount);
        if (revenueEl) {
          const revenue = (orders || []).reduce((sum, order) => {
            const createdAt = getOrderCreatedAt(order);
            if (Number.isNaN(createdAt.getTime())) return sum;
            if (createdAt < range.start || createdAt >= range.end) return sum;
            if (getOrderStatus(order) !== 'completed') return sum;
            return sum + getOrderAmount(order);
          }, 0);
          revenueEl.textContent = `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(revenue)}`;
        }

        currentLowStockProducts = (products || []).filter(p => Number(p.quantity || 0) > 0 && Number(p.quantity || 0) <= 5);
        const lowStockAlertsEnabled = await RestaurantDB.getSetting('enableLowStockAlerts').then(setting => setting ? setting.value === true || setting.value === 'true' : false).catch(() => false);
        renderLowStockSummaryChip(lowStockCount, lowStockAlertsEnabled);
      } else {
        const [products, users, events, orders] = await Promise.all([
          RestaurantDB.getAllProducts().catch(() => []),
          RestaurantDB.getAllUsers().catch(() => []),
          RestaurantDB.getAllEvents().catch(() => []),
          RestaurantDB.getAllOrders().catch(() => [])
        ]);

        const activeStaffCount = (users || []).filter(u => u.status === 'active' && u.role && u.role !== 'admin').length;
        const range = getBusinessDayRange(businessDayCutoff);
        const currentDayOrders = (orders || []).filter(o => {
          const createdAt = getOrderCreatedAt(o);
          if (Number.isNaN(createdAt.getTime())) return false;
          return createdAt >= range.start && createdAt < range.end;
        });
        const dailyOrderCount = currentDayOrders.length;
        const completedOrderCount = currentDayOrders.filter(o => getOrderStatus(o) === 'completed').length;
        const pendingOrderCount = currentDayOrders.filter(o => getOrderStatus(o) === 'pending').length;
        const lowStockCount = (products || []).filter(p => Number(p.quantity || 0) > 0 && Number(p.quantity || 0) <= 5).length;

        if (productCountEl) productCountEl.textContent = String((products || []).length);
        if (ordersTodayChipEl) ordersTodayChipEl.textContent = `${dailyOrderCount} order${dailyOrderCount === 1 ? '' : 's'} today`;
        if (staffOnlineChipEl) staffOnlineChipEl.textContent = `${activeStaffCount} staff online`;
        if (userCountEl) userCountEl.textContent = String((users || []).length);
        if (eventCountEl) eventCountEl.textContent = String((events || []).length);
        if (activeStaffEl) activeStaffEl.textContent = String(activeStaffCount);
        if (pendingOrdersEl) pendingOrdersEl.textContent = String(pendingOrderCount);
        if (completedOrdersEl) completedOrdersEl.textContent = String(completedOrderCount);
        if (revenueEl) {
          const revenue = (orders || []).reduce((sum, order) => {
            const created = getOrderCreatedAt(order);
            if (Number.isNaN(created.getTime())) return sum;
            if (created < range.start || created >= range.end) return sum;
            if (getOrderStatus(order) !== 'completed') return sum;
            return sum + getOrderAmount(order);
          }, 0);
          revenueEl.textContent = `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(revenue)}`;
        }

        currentLowStockProducts = (products || []).filter(p => Number(p.quantity || 0) > 0 && Number(p.quantity || 0) <= 5);
        const lowStockAlertsEnabled = await RestaurantDB.getSetting('enableLowStockAlerts').then(setting => setting ? setting.value === true || setting.value === 'true' : false).catch(() => false);
        renderLowStockSummaryChip(lowStockCount, lowStockAlertsEnabled);
      }
    } catch (err) {
      console.error('Failed to load operational snapshot counts:', err);
    }
  }

  function parseOrderJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (err) {
        return value;
      }
    }
    return value;
  }

  function normalizeOrderProperty(order, keys) {
    if (!order) return null;
    const normalizedOrder = Object.assign({}, order, {
      orderData: parseOrderJson(order.orderData),
      order_data: parseOrderJson(order.order_data),
      order: parseOrderJson(order.order)
    });

    for (const key of keys) {
      if (!key) continue;
      const parts = String(key).split('.').map(part => part.replace(/\?$/g, ''));
      let current = normalizedOrder;
      for (const part of parts) {
        if (current === undefined || current === null) {
          current = null;
          break;
        }
        if (typeof current === 'string') {
          current = parseOrderJson(current);
        }
        current = current[part];
      }
      if (current !== undefined && current !== null) {
        return current;
      }
    }
    return null;
  }

  function getOrderPaymentMethod(order) {
    const methodLabels = {
      cash: 'Cash',
      pos: 'POS Card',
      transfer: 'Bank Transfer',
      credit: 'Credit',
    };

    if (order.payments && Array.isArray(order.payments) && order.payments.length > 0) {
      const methods = order.payments
        .map(payment => methodLabels[payment.method] || payment.method || 'Payment')
        .filter(Boolean);
      return methods.length > 0 ? methods[0] : 'N/A';
    }

    const rawMethod = normalizeOrderProperty(order, ['paymentMethod', 'payment_method', 'method', 'payment', 'order.paymentMethod', 'order.payment_method', 'order.method', 'order.payment', 'orderData.paymentMethod', 'orderData.payment_method', 'orderData.method', 'orderData.payment', 'order_data.paymentMethod', 'order_data.payment_method', 'order_data.method', 'order_data.payment']);
    if (!rawMethod) return 'N/A';
    if (Array.isArray(rawMethod)) {
      return String(rawMethod[0] || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
    }
    return String(rawMethod).replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function getOrderPerson(order, preferredKeys) {
    const raw = normalizeOrderProperty(order, preferredKeys);
    if (raw) return String(raw);
    return 'N/A';
  }

  function getOrderAmount(order) {
    const amountCandidates = [
      'totalAmount',
      'total',
      'subtotal',
      'amount',
      'grandTotal',
      'grand_total',
      'order.totalAmount',
      'order.total',
      'order.subtotal',
      'order.amount',
      'order.grandTotal',
      'order.grand_total',
      'orderData.totalAmount',
      'orderData.total',
      'orderData.subtotal',
      'orderData.amount',
      'orderData.grandTotal',
      'orderData.grand_total',
      'order_data.totalAmount',
      'order_data.total',
      'order_data.subtotal',
      'order_data.amount',
      'order_data.grandTotal',
      'order_data.grand_total',
      'order.orderData.totalAmount',
      'order.orderData.total',
      'order.orderData.subtotal',
      'order.orderData.amount',
      'order.orderData.grandTotal',
      'order.orderData.grand_total',
      'order.order_data.totalAmount',
      'order.order_data.total',
      'order.order_data.subtotal',
      'order.order_data.amount',
      'order.order_data.grandTotal',
      'order.order_data.grand_total'
    ];

    for (const key of amountCandidates) {
      const value = normalizeOrderProperty(order, [key]);
      if (value === null || value === undefined || value === '') continue;
      const parsedValue = Number(String(value).replace(/[^0-9.-]+/g, ''));
      if (!Number.isNaN(parsedValue) && parsedValue !== 0) {
        return parsedValue;
      }
    }

    const items = normalizeOrderProperty(order, [
      'items',
      'order.items',
      'orderData.items',
      'order_data.items',
      'order.orderData.items',
      'order.order_data.items'
    ]);

    if (Array.isArray(items)) {
      return items.reduce((sum, item) => {
        const quantity = Number(item?.quantity ?? item?.qty ?? 0) || 0;
        const unitPrice = Number(item?.unitPrice ?? item?.price ?? item?.amount ?? 0) || 0;
        return sum + (quantity * unitPrice);
      }, 0);
    }

    return 0;
  }

  function getOrderCreatedAt(order) {
    const rawCreatedAt = normalizeOrderProperty(order, [
      'createdAt',
      'created_at',
      'date',
      'order.createdAt',
      'order.created_at',
      'order.date',
      'orderData.createdAt',
      'orderData.created_at',
      'orderData.order.createdAt',
      'orderData.order.created_at',
      'order_data.createdAt',
      'order_data.created_at',
      'order_data.order.createdAt',
      'order_data.order.created_at',
      'order.orderData.createdAt',
      'order.orderData.created_at',
      'order.order_data.createdAt',
      'order.order_data.created_at',
      'orderData.orderData.createdAt',
      'orderData.orderData.created_at',
      'orderData.order_data.createdAt',
      'orderData.order_data.created_at',
      'order_data.orderData.createdAt',
      'order_data.orderData.created_at',
      'order_data.order_data.createdAt',
      'order_data.order_data.created_at'
    ]);
    return rawCreatedAt ? new Date(rawCreatedAt) : new Date(NaN);
  }

  function getOrderTime(order) {
    const created = getOrderCreatedAt(order);
    if (Number.isNaN(created.getTime())) return 'N/A';
    return created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function getOrderStatus(order) {
    const rawStatus = normalizeOrderProperty(order, [
      'status',
      'order.status',
      'order_data.status',
      'orderData.status',
      'orderData.order.status',
      'orderData.order_data.status',
      'order_data.order.status',
      'order.orderData.status',
      'order.order_data.status',
      'order.orderData.order.status',
      'order.order_data.order.status',
      'orderData.orderData.status',
      'orderData.order_data.status',
      'order_data.orderData.status',
      'order_data.order_data.status',
      'orderData.order.status',
      'state'
    ]);
    return String(rawStatus || '').toLowerCase();
  }

  function isSettledOrder(order) {
    const status = getOrderStatus(order);
    return ['completed', 'sent', 'paid', 'success', 'settled', 'closed'].includes(status);
  }

  async function loadAdminOrders() {
    try {
      if (BACKEND_AVAILABLE) {
        const result = await fetchBackend('/api/orders/all').catch(() => ({ orders: [] }));
        return Array.isArray(result?.orders) ? result.orders : [];
      }
      return await RestaurantDB.getAllOrders().catch(() => []);
    } catch (err) {
      console.error('Failed to load admin orders:', err);
      return [];
    }
  }

  async function renderRecentSalesTable() {
    const body = document.getElementById('recent-sales-table-body');
    if (!body) return;
    try {
      const orders = await loadAdminOrders();
      const range = getBusinessDayRange(businessDayCutoff);
      const todayOrders = (orders || []).filter((order) => {
        const created = getOrderCreatedAt(order);
        if (Number.isNaN(created.getTime())) return false;
        return created >= range.start && created < range.end;
      }).sort((a, b) => {
        const aDate = getOrderCreatedAt(a);
        const bDate = getOrderCreatedAt(b);
        return bDate - aDate;
      }).slice(0, 8);

      if (todayOrders.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align:center; color:#6b7280;">No sales recorded for this business day.</td></tr>';
        return;
      }

      body.innerHTML = todayOrders.map((order) => {
        const time = getOrderTime(order);
        const waiter = getOrderPerson(order, ['waiterName', 'waiter', 'waiter_name', 'orderData.waiterName', 'orderData.waiter', 'orderData.waiter_name', 'order.orderData.waiterName', 'order.orderData.waiter', 'order.orderData.waiter_name']);
        const cashier = getOrderPerson(order, ['cashierName', 'cashier', 'createdBy', 'created_by', 'orderData.cashierName', 'orderData.cashier', 'orderData.createdBy', 'orderData.created_by', 'order.orderData.cashierName', 'order.orderData.cashier', 'order.orderData.createdBy', 'order.orderData.created_by']);
        const amount = getOrderAmount(order);
        const status = getOrderStatus(order) || 'N/A';
        const method = getOrderPaymentMethod(order);
        const statusLabel = String(status).charAt(0).toUpperCase() + String(status).slice(1);
        const statusColor = status.toLowerCase() === 'completed' ? '#10b981' : status.toLowerCase() === 'pending' ? '#f59e0b' : '#3b82f6';
        const methodBadge = method && method !== 'N/A'
          ? `<span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:0.8rem;font-weight:600;">${method}</span>`
          : '<span style="color:#6b7280;">N/A</span>';

        return `
          <tr>
            <td>${time}</td>
            <td>${waiter}</td>
            <td>${cashier}</td>
            <td style="text-align:right; font-weight:600; padding-right:24px;">₦${formatCurrency(amount)}</td>
            <td style="padding-left:22px;"><span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:${statusColor}20;color:${statusColor};font-size:0.85rem;font-weight:600;">${statusLabel}</span></td>
            <td>${methodBadge}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to render recent sales table:', err);
      body.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align:center; color:#ef4444;">Unable to load recent sales.</td></tr>';
    }
  }

  let salesOrdersCache = [];
  let selectedSalesOrderId = null;
  const SALES_PAGE_SIZE = 14;
  let salesCurrentPage = 1;

  function getOrderStableId(order, index) {
    return String(order.id ?? order._id ?? order.orderId ?? order.reference ?? `sale-${index}`);
  }

  function getOrderItems(order) {
    const itemCandidates = normalizeOrderProperty(order, [
      'items',
      'order.items',
      'orderData.items',
      'order_data.items',
      'order.orderData.items',
      'order.order_data.items',
      'orderData.order.items',
      'order_data.order.items'
    ]);
    if (!itemCandidates) return [];
    const items = Array.isArray(itemCandidates) ? itemCandidates : parseOrderJson(itemCandidates);
    if (!Array.isArray(items)) return [];
    return items.map(item => typeof item === 'string' ? parseOrderJson(item) : item).filter(Boolean);
  }

  function getOrderTableNumber(order) {
    const rawTable = normalizeOrderProperty(order, ['tableNumber', 'table_name', 'tableName', 'order.tableNumber', 'order.table_name', 'order.tableName', 'orderData.tableNumber', 'orderData.table_name', 'orderData.tableName', 'order_data.tableNumber', 'order_data.table_name', 'order_data.tableName']);
    if (rawTable) return String(rawTable);
    const tableName = normalizeOrderProperty(order, ['tableName', 'table_name', 'table', 'order.tableName', 'order.orderData.tableName', 'orderData.tableName']);
    return tableName ? String(tableName) : 'Table N/A';
  }

  function renderSalesDetail(order) {
    const detailContainer = document.getElementById('sales-detail-content');
    if (!detailContainer) return;
    if (!order) {
      detailContainer.innerHTML = '<p class="muted">Select a sale card to view its summary and item breakdown.</p>';
      return;
    }

    const items = getOrderItems(order);
    const totalAmount = getOrderAmount(order);
    const tableLabel = getOrderTableNumber(order);
    const waiter = getOrderPerson(order, ['waiterName', 'waiter', 'waiter_name', 'orderData.waiterName', 'orderData.waiter', 'orderData.waiter_name', 'order.orderData.waiterName', 'order.orderData.waiter', 'order.orderData.waiter_name']);
    const cashier = getOrderPerson(order, ['cashierName', 'cashier', 'createdBy', 'created_by', 'orderData.cashierName', 'orderData.cashier', 'orderData.createdBy', 'orderData.created_by', 'order.orderData.cashierName', 'order.orderData.cashier', 'order.orderData.createdBy', 'order.orderData.created_by']);
    const status = getOrderStatus(order) || 'N/A';
    const method = getOrderPaymentMethod(order);
    const createdAt = getOrderCreatedAt(order);
    const dateLabel = Number.isNaN(createdAt.getTime()) ? 'N/A' : createdAt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

    detailContainer.innerHTML = `
      <div class="order-card-detail"><span class="order-card-label">Table</span><span class="order-card-value">${tableLabel}</span></div>
      <div class="order-card-detail"><span class="order-card-label">Waiter</span><span class="order-card-value">${waiter}</span></div>
      <div class="order-card-detail"><span class="order-card-label">Cashier</span><span class="order-card-value">${cashier}</span></div>
      <div class="order-card-detail"><span class="order-card-label">Payment Method</span><span class="order-card-value">${method}</span></div>
      <div class="order-card-detail"><span class="order-card-label">Status</span><span class="order-card-value">${status}</span></div>
      <div class="order-card-detail"><span class="order-card-label">Order Date</span><span class="order-card-value">${dateLabel}</span></div>
      <div class="order-card-detail"><span class="order-card-label">Total</span><span class="order-card-value">₦${formatCurrency(totalAmount)}</span></div>
      <div style="margin-top:20px;">
        <h4 style="margin:0 0 10px 0;font-size:1rem;font-weight:700;color:var(--text);">Items breakdown</h4>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead style="background:#f3f4f6;border-bottom:2px solid #d1d5db;">
              <tr>
                <th style="padding:10px;text-align:left;font-size:0.85rem;font-weight:600;color:#374151;">Item</th>
                <th style="padding:10px;text-align:center;font-size:0.85rem;font-weight:600;color:#374151;">Qty</th>
                <th style="padding:10px;text-align:right;font-size:0.85rem;font-weight:600;color:#374151;">Unit</th>
                <th style="padding:10px;text-align:right;font-size:0.85rem;font-weight:600;color:#374151;">Line total</th>
              </tr>
            </thead>
            <tbody>
              ${items.length === 0 ? '<tr><td colspan="4" style="padding:16px;text-align:center;color:#6b7280;">No items available for this sale.</td></tr>' : items.map((item, idx) => {
                const name = item.productName || item.name || item.title || 'Unnamed item';
                const quantity = Number(item.quantity || item.qty || 0);
                const unitPrice = Number(item.unitPrice || item.price || item.amount || 0);
                const lineTotal = quantity * unitPrice;
                return `
                  <tr style="border-bottom:1px solid #e5e7eb;${idx % 2 === 0 ? 'background:#f9fafb;' : ''}">
                    <td style="padding:10px;font-size:0.9rem;">${String(name)}</td>
                    <td style="padding:10px;text-align:center;font-size:0.9rem;">${quantity}</td>
                    <td style="padding:10px;text-align:right;font-size:0.9rem;">₦${formatCurrency(unitPrice)}</td>
                    <td style="padding:10px;text-align:right;font-size:0.9rem;font-weight:600;">₦${formatCurrency(lineTotal)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function selectSalesOrder(orderId) {
    const normalizedId = String(orderId);
    const order = salesOrdersCache.find((order, idx) => getOrderStableId(order, idx) === normalizedId);
    selectedSalesOrderId = normalizedId;
    document.querySelectorAll('.sales-order-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.orderId === normalizedId);
    });
    renderSalesDetail(order);
  }

  function renderSalesPagination(totalItems) {
    const paginationContainer = document.getElementById('sales-pagination');
    if (!paginationContainer) return;

    const totalPages = Math.max(1, Math.ceil(totalItems / SALES_PAGE_SIZE));
    if (salesCurrentPage > totalPages) salesCurrentPage = totalPages;

    paginationContainer.style.display = 'flex';
    paginationContainer.innerHTML = `
      <span class="muted" style="margin-right:8px;">Page ${salesCurrentPage} of ${totalPages}</span>
      <button id="sales-page-prev" class="btn btn-ghost" type="button" ${salesCurrentPage === 1 ? 'disabled' : ''}>Prev</button>
      <button id="sales-page-next" class="btn btn-ghost" type="button" ${salesCurrentPage === totalPages ? 'disabled' : ''}>Next</button>
    `;

    const prevBtn = document.getElementById('sales-page-prev');
    const nextBtn = document.getElementById('sales-page-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (salesCurrentPage > 1) {
          salesCurrentPage -= 1;
          loadSalesPanel();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (salesCurrentPage < totalPages) {
          salesCurrentPage += 1;
          loadSalesPanel();
        }
      });
    }
  }

  function getSalesDateFilterValue() {
    const salesDateFilter = document.getElementById('sales-date-filter');
    if (salesDateFilter && salesDateFilter.value) {
      const [year, month, day] = salesDateFilter.value.split('-').map(Number);
      return new Date(year, month - 1, day);
    }

    const today = new Date();
    if (salesDateFilter) {
      salesDateFilter.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    return today;
  }

  async function loadSalesPanel() {
    const cardList = document.getElementById('sales-card-list');
    const detailContent = document.getElementById('sales-detail-content');
    const searchInput = document.getElementById('sales-search');
    const salesDateFilter = document.getElementById('sales-date-filter');
    const salesRevenueEl = document.getElementById('sales-total-revenue');
    const salesCompletedEl = document.getElementById('sales-completed-orders');
    const salesPendingEl = document.getElementById('sales-pending-orders');
    if (!cardList || !detailContent) return;

    const selectedDate = getSalesDateFilterValue();
    const dateStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const dateEnd = new Date(dateStart);
    dateEnd.setDate(dateStart.getDate() + 1);

    try {
      const allOrders = await loadAdminOrders();
      const searchTerm = (searchInput?.value || '').toLowerCase().trim();

      const dateFilteredOrders = (allOrders || []).filter((order) => {
        const created = getOrderCreatedAt(order);
        if (Number.isNaN(created.getTime())) return false;
        return created >= dateStart && created < dateEnd;
      });

      const filteredOrders = dateFilteredOrders.filter((order) => {
        const waiter = getOrderPerson(order, ['waiterName', 'waiter', 'waiter_name', 'orderData.waiterName', 'orderData.waiter', 'orderData.waiter_name', 'order.orderData.waiterName', 'order.orderData.waiter', 'order.orderData.waiter_name']).toLowerCase();
        const cashier = getOrderPerson(order, ['cashierName', 'cashier', 'createdBy', 'created_by', 'orderData.cashierName', 'orderData.cashier', 'orderData.createdBy', 'orderData.created_by', 'order.orderData.cashierName', 'order.orderData.cashier', 'order.orderData.createdBy', 'order.orderData.created_by']).toLowerCase();
        const status = getOrderStatus(order).toLowerCase();
        const method = getOrderPaymentMethod(order).toLowerCase();
        const table = getOrderTableNumber(order).toLowerCase();
        const id = String(getOrderStableId(order, 0)).toLowerCase();
        return !searchTerm || [waiter, cashier, status, method, table, id].some(value => value.includes(searchTerm));
      });

      const completedCount = filteredOrders.filter((order) => getOrderStatus(order) === 'completed').length;
      const pendingCount = filteredOrders.filter((order) => getOrderStatus(order) === 'pending').length;
      const revenue = filteredOrders.reduce((sum, order) => {
        if (getOrderStatus(order) !== 'completed') return sum;
        return sum + getOrderAmount(order);
      }, 0);

      if (salesRevenueEl) salesRevenueEl.textContent = `₦${formatCurrency(revenue)}`;
      if (salesCompletedEl) salesCompletedEl.textContent = String(completedCount);
      if (salesPendingEl) salesPendingEl.textContent = String(pendingCount);

      salesOrdersCache = filteredOrders.sort((a, b) => new Date(getOrderCreatedAt(b)) - new Date(getOrderCreatedAt(a)));

      if (salesOrdersCache.length === 0) {
        cardList.innerHTML = '<div class="muted">No sales match your search for this day.</div>';
        detailContent.innerHTML = '<p class="muted">Select a sale card to view details.</p>';
        renderSalesPagination(0);
        return;
      }

      const totalPages = Math.max(1, Math.ceil(salesOrdersCache.length / SALES_PAGE_SIZE));
      if (salesCurrentPage > totalPages) salesCurrentPage = totalPages;
      const startIndex = (salesCurrentPage - 1) * SALES_PAGE_SIZE;
      const pageOrders = salesOrdersCache.slice(startIndex, startIndex + SALES_PAGE_SIZE);

      cardList.innerHTML = pageOrders.map((order, idx) => {
        const orderId = getOrderStableId(order, idx);
        const status = getOrderStatus(order) || 'N/A';
        const statusLabel = String(status).charAt(0).toUpperCase() + String(status).slice(1);
        const statusColor = status === 'completed' ? '#10b981' : status === 'pending' ? '#f59e0b' : '#3b82f6';
        const waiter = getOrderPerson(order, ['waiterName', 'waiter', 'waiter_name', 'orderData.waiterName', 'orderData.waiter', 'orderData.waiter_name', 'order.orderData.waiterName', 'order.orderData.waiter', 'order.orderData.waiter_name']);
        const cashier = getOrderPerson(order, ['cashierName', 'cashier', 'createdBy', 'created_by', 'orderData.cashierName', 'orderData.cashier', 'orderData.createdBy', 'orderData.created_by', 'order.orderData.cashierName', 'order.orderData.cashier', 'order.orderData.createdBy', 'order.orderData.created_by']);
        const tableLabel = getOrderTableNumber(order);
        const amount = getOrderAmount(order);
        const itemsCount = getOrderItems(order).length;
        const method = getOrderPaymentMethod(order);
        const isActive = selectedSalesOrderId === orderId;

        return `
          <div class="order-card sales-order-card${isActive ? ' active' : ''}" data-order-id="${orderId}" tabindex="0" role="button" aria-pressed="${isActive}">
            <div class="order-card-header">
              <div>
                <h4 class="order-card-title">${tableLabel}</h4>
                <div class="muted" style="font-size:0.92rem;margin-top:4px;">${itemsCount} item${itemsCount === 1 ? '' : 's'} · ${method}</div>
              </div>
              <span class="order-card-badge" style="background:${statusColor};">${statusLabel}</span>
            </div>
            <div class="order-card-detail"><span class="order-card-label">Waiter</span><span class="order-card-value">${waiter}</span></div>
            <div class="order-card-detail"><span class="order-card-label">Cashier</span><span class="order-card-value">${cashier}</span></div>
            <div class="order-card-detail"><span class="order-card-label">Total</span><span class="order-card-value">₦${formatCurrency(amount)}</span></div>
          </div>
        `;
      }).join('');

      document.querySelectorAll('.sales-order-card').forEach((card) => {
        card.addEventListener('click', () => selectSalesOrder(card.dataset.orderId));
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectSalesOrder(card.dataset.orderId);
          }
        });
      });

      const chosenId = selectedSalesOrderId && pageOrders.some((order, idx) => getOrderStableId(order, idx) === selectedSalesOrderId)
        ? selectedSalesOrderId
        : getOrderStableId(pageOrders[0], 0);
      selectSalesOrder(chosenId);
      renderSalesPagination(salesOrdersCache.length);
    } catch (err) {
      console.error('Failed to load sales panel:', err);
      if (salesRevenueEl) salesRevenueEl.textContent = '₦0.00';
      if (salesCompletedEl) salesCompletedEl.textContent = '0';
      if (salesPendingEl) salesPendingEl.textContent = '0';
      cardList.innerHTML = '<div class="muted">Unable to load sales.</div>';
      detailContent.innerHTML = '<p class="muted">Unable to display selected sale.</p>';
    }
  }

  function getBiReportDateFilterValue() {
    const biDateFilter = document.getElementById('bi-report-date-filter');
    if (biDateFilter) {
      if (biDateFilter.value) {
        const [year, month, day] = biDateFilter.value.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
      const today = new Date();
      biDateFilter.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      return today;
    }
    return new Date();
  }

  async function renderBIReport() {
    const bestSellerNameEl = document.getElementById('bi-best-seller-name');
    const todayRevenueEl = document.getElementById('bi-today-revenue');
    const yesterdayRevenueEl = document.getElementById('bi-yesterday-revenue');
    const salesDeltaEl = document.getElementById('bi-sales-delta');
    const topCategoryEl = document.getElementById('bi-top-category');
    const topProductsEl = document.getElementById('bi-top-products');
    const topStaffEl = document.getElementById('bi-top-staff');
    const lowStockFastMoversEl = document.getElementById('bi-low-stock-fast-movers');
    const todayBarEl = document.getElementById('bi-today-bar');
    const yesterdayBarEl = document.getElementById('bi-yesterday-bar');
    const paymentBreakdownEl = document.getElementById('bi-payment-breakdown');

    if (!bestSellerNameEl || !todayRevenueEl || !yesterdayRevenueEl || !salesDeltaEl || !topCategoryEl || !topProductsEl || !topStaffEl || !lowStockFastMoversEl || !todayBarEl || !yesterdayBarEl) return;

    try {
      const [summaryRes, fallbackOrders, fallbackProducts] = await Promise.all([
        BACKEND_AVAILABLE ? fetchBackend('/api/bi/summary').catch(() => ({ orders: [], products: [] })) : Promise.resolve(null),
        RestaurantDB.getAllOrders().catch(() => []),
        RestaurantDB.getAllProducts().catch(() => [])
      ]);

      const orders = BACKEND_AVAILABLE && summaryRes ? (Array.isArray(summaryRes.orders) ? summaryRes.orders : []) : (Array.isArray(fallbackOrders) ? fallbackOrders : []);
      const products = BACKEND_AVAILABLE && summaryRes ? (Array.isArray(summaryRes.products) ? summaryRes.products : []) : (Array.isArray(fallbackProducts) ? fallbackProducts : []);
      const selectedDate = getBiReportDateFilterValue();
      const selectedDayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      const selectedDayEnd = new Date(selectedDayStart);
      selectedDayEnd.setDate(selectedDayStart.getDate() + 1);
      const previousDayStart = new Date(selectedDayStart);
      previousDayStart.setDate(previousDayStart.getDate() - 1);
      const previousDayEnd = new Date(selectedDayStart);

      const settledOrders = orders.filter((order) => isSettledOrder(order));
      const selectedDayOrders = settledOrders.filter((order) => {
        const createdAt = getOrderCreatedAt(order);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= selectedDayStart && createdAt < selectedDayEnd;
      });
      const previousDayOrders = settledOrders.filter((order) => {
        const createdAt = getOrderCreatedAt(order);
        return !Number.isNaN(createdAt.getTime()) && createdAt >= previousDayStart && createdAt < selectedDayStart;
      });

      const todayRevenue = selectedDayOrders.reduce((sum, order) => sum + getOrderAmount(order), 0);
      const yesterdayRevenue = previousDayOrders.reduce((sum, order) => sum + getOrderAmount(order), 0);
      const delta = yesterdayRevenue === 0 ? (todayRevenue === 0 ? 0 : 100) : ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
      const deltaLabel = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;

      const itemSummary = {};
      const categorySummary = {};
      const staffSummary = { waiters: {}, cashiers: {} };

      settledOrders.forEach((order) => {
        const items = Array.isArray(order.items) ? order.items : [];
        const orderAmount = getOrderAmount(order);
        const waiter = getOrderPerson(order, ['waiterName', 'waiter', 'waiter_name', 'orderData.waiterName', 'orderData.waiter', 'orderData.waiter_name', 'order.orderData.waiterName', 'order.orderData.waiter', 'order.orderData.waiter_name']);
        const cashier = getOrderPerson(order, ['cashierName', 'cashier', 'createdBy', 'created_by', 'orderData.cashierName', 'orderData.cashier', 'orderData.createdBy', 'orderData.created_by', 'order.orderData.cashierName', 'order.orderData.cashier', 'order.orderData.createdBy', 'order.orderData.created_by']);

        if (waiter) {
          staffSummary.waiters[waiter] = (staffSummary.waiters[waiter] || 0) + orderAmount;
        }
        if (cashier) {
          staffSummary.cashiers[cashier] = (staffSummary.cashiers[cashier] || 0) + orderAmount;
        }

        items.forEach((item) => {
          const name = (item.productName || item.name || item.title || 'Unknown').toString();
          const quantity = Number(item.quantity || item.qty || 0);
          const key = name.toLowerCase();
          if (!itemSummary[key]) {
            itemSummary[key] = { name, quantity: 0, value: 0 };
          }
          itemSummary[key].quantity += quantity;
          const unitPrice = Number(item.unitPrice || item.price || item.amount || 0);
          itemSummary[key].value += quantity * unitPrice;

          const product = products.find((p) => String(p.name || '').toLowerCase() === key);
          const category = product ? (product.category || product.cat || 'Uncategorized') : 'Uncategorized';
          categorySummary[category] = (categorySummary[category] || 0) + (quantity * unitPrice);
        });
      });

      const productList = Object.values(itemSummary).sort((a, b) => b.quantity - a.quantity).slice(0, 6);
      const bestSeller = productList[0] || null;
      const topCategoryEntry = Object.entries(categorySummary).sort((a, b) => b[1] - a[1])[0] || ['Uncategorized', 0];
      const topWaiterEntry = Object.entries(staffSummary.waiters).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
      const topCashierEntry = Object.entries(staffSummary.cashiers).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
      const paymentBreakdown = {};
      selectedDayOrders.forEach((order) => {
        const methodLabel = getOrderPaymentMethod(order) || 'N/A';
        const safeLabel = String(methodLabel || 'N/A').trim() || 'N/A';
        if (!paymentBreakdown[safeLabel]) {
          paymentBreakdown[safeLabel] = { label: safeLabel, count: 0, revenue: 0 };
        }
        paymentBreakdown[safeLabel].count += 1;
        paymentBreakdown[safeLabel].revenue += getOrderAmount(order);
      });
      const paymentEntries = Object.values(paymentBreakdown).sort((a, b) => b.revenue - a.revenue);
      const paymentTotalRevenue = paymentEntries.reduce((sum, entry) => sum + entry.revenue, 0);
      const paymentColors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#0f766e'];
      const circumference = 2 * Math.PI * 42;
      let currentOffset = 0;
      const pieSegments = paymentEntries.length === 0
        ? '<circle cx="54" cy="54" r="42" fill="none" stroke="#e5e7eb" stroke-width="18"></circle>'
        : paymentEntries.map((entry, index) => {
            const segmentLength = paymentTotalRevenue === 0 ? 0 : (entry.revenue / paymentTotalRevenue) * circumference;
            const offset = circumference - currentOffset;
            currentOffset += segmentLength;
            return `<circle cx="54" cy="54" r="42" fill="none" stroke="${paymentColors[index % paymentColors.length]}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${segmentLength} ${Math.max(circumference - segmentLength, 0)}" stroke-dashoffset="${offset}" transform="rotate(-90 54 54)" />`;
          }).join('');

      bestSellerNameEl.textContent = bestSeller ? `${bestSeller.name} (${bestSeller.quantity} sold)` : 'No sales yet';
      todayRevenueEl.textContent = `₦${formatCurrency(todayRevenue)}`;
      yesterdayRevenueEl.textContent = `₦${formatCurrency(yesterdayRevenue)}`;
      salesDeltaEl.textContent = deltaLabel;
      topCategoryEl.textContent = `${topCategoryEntry[0]} (${formatCurrency(topCategoryEntry[1])})`;

      topProductsEl.innerHTML = productList.length === 0 ? '<li>No products sold yet</li>' : productList.map((item) => `
        <li style="margin-bottom: 10px;">
          <strong>${item.name}</strong><br><span class="muted" style="font-size:0.9rem;">${item.quantity} sold · ₦${formatCurrency(item.value)}</span>
        </li>
      `).join('');

      topStaffEl.innerHTML = `
        <div style="padding:14px;border-radius:12px;background:#eef2ff;">
          <div class="eyebrow">Top waiter</div>
          <div style="margin-top:10px;font-weight:700;">${topWaiterEntry[0]}</div>
          <div class="muted" style="margin-top:6px;">₦${formatCurrency(topWaiterEntry[1])} revenue</div>
        </div>
        <div style="padding:14px;border-radius:12px;background:#ecfdf5;">
          <div class="eyebrow">Top cashier</div>
          <div style="margin-top:10px;font-weight:700;">${topCashierEntry[0]}</div>
          <div class="muted" style="margin-top:6px;">₦${formatCurrency(topCashierEntry[1])} revenue</div>
        </div>
      `;

      if (paymentBreakdownEl) {
        paymentBreakdownEl.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
            <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Payment method breakdown">
              <circle cx="54" cy="54" r="42" fill="none" stroke="#f3f4f6" stroke-width="18"></circle>
              ${pieSegments}
            </svg>
            <div class="muted" style="text-align:center;font-size:0.9rem;">${paymentEntries.length === 0 ? 'No completed sales for this day' : 'Completed orders by payment method'}</div>
            ${paymentEntries.length > 0 ? `
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;width:100%;max-width:320px;">
                ${paymentEntries.map((entry, index) => `
                  <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:999px;background:#f8fafc;justify-content:center;">
                    <span style="width:10px;height:10px;border-radius:999px;background:${paymentColors[index % paymentColors.length]};display:inline-block;"></span>
                    <span style="font-size:0.82rem;white-space:nowrap;">${entry.label}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
          <div style="display:grid;gap:10px;min-width:220px;">
            ${paymentEntries.length === 0 ? '<div class="muted">No payment breakdown available.</div>' : paymentEntries.map((entry, index) => `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:#f8fafc;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="width:10px;height:10px;border-radius:999px;background:${paymentColors[index % paymentColors.length]};display:inline-block;"></span>
                  <div>
                    <div style="font-weight:700;">${entry.label}</div>
                    <div class="muted" style="font-size:0.85rem;">${entry.count} order${entry.count === 1 ? '' : 's'}</div>
                  </div>
                </div>
                <div style="text-align:right;font-size:0.9rem;font-weight:700;">₦${formatCurrency(entry.revenue)}</div>
              </div>
            `).join('')}
          </div>
        `;
      }

      const lowStockProducts = (products || []).filter(p => Number(p.quantity || 0) > 0 && Number(p.quantity || 0) <= 5).sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0)).slice(0, 5);
      lowStockFastMoversEl.innerHTML = lowStockProducts.length === 0 ? '<div class="muted">No low-stock fast movers at the moment.</div>' : lowStockProducts.map((product) => `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px;border-radius:10px;background:#f8fafc;">
          <div>
            <div style="font-weight:700;">${product.name || 'Unnamed product'}</div>
            <div class="muted" style="font-size:0.9rem;">Qty left: ${product.quantity}</div>
          </div>
          <div style="font-size:0.9rem;color:#0f766e;">₦${formatCurrency(Number(product.price || 0))}</div>
        </div>
      `).join('');

      const maxValue = Math.max(todayRevenue, yesterdayRevenue, 1);
      const todayBarHeight = Math.round((todayRevenue / maxValue) * 100);
      const yesterdayBarHeight = Math.round((yesterdayRevenue / maxValue) * 100);
      const fallbackHeight = 18;
      todayBarEl.style.height = `${Math.max(todayBarHeight, fallbackHeight)}%`;
      yesterdayBarEl.style.height = `${Math.max(yesterdayBarHeight, fallbackHeight)}%`;
      todayBarEl.style.minHeight = '18px';
      yesterdayBarEl.style.minHeight = '18px';
      todayBarEl.style.display = 'inline-block';
      yesterdayBarEl.style.display = 'inline-block';
    } catch (err) {
      console.error('Failed to render BI report:', err);
    }
  }

  const btnRefreshBIReport = document.getElementById('btn-refresh-bi-report');
  const biReportDateFilter = document.getElementById('bi-report-date-filter');
  if (btnRefreshBIReport) {
    btnRefreshBIReport.addEventListener('click', renderBIReport);
  }
  if (biReportDateFilter) {
    biReportDateFilter.addEventListener('change', renderBIReport);
  }

  async function isBackendAvailable() {
    try {
      const response = await fetchBackend('/health');
      return response && response.status === 'ok';
    } catch (err) {
      return false;
    }
  }

  const BACKEND_AVAILABLE = await isBackendAvailable();
  const logoutBtn = document.getElementById('btn-logout') || document.getElementById('logout');
  const settingsBtn = document.getElementById('btn-settings');
  function showConfirmDialog({ title, message, confirmText = 'Yes', cancelText = 'Cancel', onConfirm }) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'false');
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <header class="modal-header">
          <h3 id="confirm-dialog-title">${title}</h3>
          <button type="button" class="modal-close" aria-label="Close">✕</button>
        </header>
        <div class="modal-body">
          <p>${message}</p>
        </div>
        <footer class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn btn-ghost cancel-btn">${cancelText}</button>
          <button type="button" class="btn btn-danger confirm-btn">${confirmText}</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
    modal.querySelector('.modal-close')?.addEventListener('click', close);
    modal.querySelector('.cancel-btn')?.addEventListener('click', close);
    modal.querySelector('.confirm-btn')?.addEventListener('click', () => { onConfirm?.(); close(); });
  }
  if(logoutBtn) logoutBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); showConfirmDialog({ title: 'Logout confirmation', message: 'Are you sure you want to logout?', confirmText: 'Logout', cancelText: 'Stay logged in', onConfirm: () => { Auth.logout(); location.replace('index.html'); } }); });
  if(settingsBtn){ settingsBtn.addEventListener('click', ()=>{ showPanel('settings'); document.querySelectorAll('.nav-link[data-panel]').forEach((link)=>{ link.classList.toggle('active', link.dataset.panel === 'settings'); }); }); }
  const form = document.getElementById('create-cashier');
  if(form){
    form.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const uEl = document.getElementById('c-username');
      const pEl = document.getElementById('c-password');
      const u = uEl ? uEl.value.trim() : '';
      const p = pEl ? pEl.value : '';
      if(!u) { showToast('Enter username', 'error'); return; }
      if(!p) { showToast('Enter password', 'error'); return; }
      try{
        if (!BACKEND_AVAILABLE) {
          throw new Error('backend_unavailable');
        }
        await fetchBackend('/api/users/create', {
          method: 'POST',
          body: JSON.stringify({ username: u, password: p, role: 'cashier', fullName: u, status: 'active', tables: [] })
        });
        const msgEl = document.getElementById('created-msg'); if(msgEl) msgEl.textContent = 'Cashier created: ' + u;
        form.reset();
        showToast(`Cashier "${u}" created successfully`, 'success');
        // refresh list if visible by dispatching an event handled by admin-users.js
        const usersList = document.getElementById('users-list');
        if(usersList) usersList.dispatchEvent(new CustomEvent('refresh-users'));
      }catch(err){
        showToast(`Failed to create cashier: ${err.message}`, 'error');
      }
    });
  }

  // (waiter creation moved to register-waiter modal and table)

  // change my password
  const cpForm = document.getElementById('change-my-pw');
  if(cpForm){
    cpForm.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const curEl = document.getElementById('current-pw');
      const neuEl = document.getElementById('new-pw');
      const cur = curEl ? curEl.value : '';
      const neu = neuEl ? neuEl.value : '';
      if(!cur) { showToast('Enter current password', 'error'); return; }
      if(!neu) { showToast('Enter new password', 'error'); return; }
      try{
        await Auth.changePassword(cur, neu);
        const pwMsgEl = document.getElementById('pw-msg'); if(pwMsgEl) pwMsgEl.textContent = 'Password changed.';
        cpForm.reset();
        showToast('Password changed successfully', 'success');
      }catch(err){
        showToast(`Failed to change password: ${err.message}`, 'error');
      }
    });
  }

  // nav behaviour
  const sidebar = document.getElementById('sidebar');
  const appShell = document.querySelector('.split');
  const sidebarToggle = document.getElementById('mobile-nav-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const isMobile = () => window.innerWidth <= 960;
  const setMobileSidebarState = (open) => {
    if(!sidebar) return;
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('mobile-sidebar-open', open);
    if(sidebarBackdrop) {
      sidebarBackdrop.classList.toggle('active', open);
    }
  };
  const expandSidebar = () => {
    if(isMobile()) {
      setMobileSidebarState(true);
      return;
    }
    sidebar.classList.add('expanded');
    if(appShell) appShell.classList.add('sidebar-expanded');
  };
  const collapseSidebar = () => {
    if(isMobile()) {
      setMobileSidebarState(false);
      return;
    }
    sidebar.classList.remove('expanded');
    if(appShell) appShell.classList.remove('sidebar-expanded');
  };
  if(sidebar){
    sidebar.addEventListener('mouseenter', expandSidebar);
    sidebar.addEventListener('focusin', expandSidebar);
    sidebar.addEventListener('mouseleave', collapseSidebar);
    sidebar.addEventListener('focusout', (event) => {
      if(!sidebar.contains(event.relatedTarget)) collapseSidebar();
    });
    sidebar.addEventListener('click', (event) => {
      if(isMobile() && event.target.closest('.nav-link')) {
        collapseSidebar();
      } else if(isMobile()) {
        expandSidebar();
      }
    });
  }
  if(sidebarToggle){
    sidebarToggle.addEventListener('click', () => {
      const willOpen = !sidebar.classList.contains('is-open');
      setMobileSidebarState(willOpen);
      sidebarToggle.setAttribute('aria-expanded', String(willOpen));
    });
  }
  if(sidebarBackdrop){
    sidebarBackdrop.addEventListener('click', () => {
      setMobileSidebarState(false);
      if(sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
    });
  }
  window.addEventListener('resize', () => {
    if(!sidebar) return;
    if(isMobile()) {
      if(!sidebar.classList.contains('is-open')) {
        sidebar.classList.remove('expanded');
        if(appShell) appShell.classList.remove('sidebar-expanded');
      }
    } else {
      sidebar.classList.remove('is-open');
      document.body.classList.remove('mobile-sidebar-open');
      if(sidebarBackdrop) sidebarBackdrop.classList.remove('active');
      if(sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
    }
  });

  const showPanel = (panelId) => {
    document.querySelectorAll('.nav-link[data-panel]').forEach((link) => {
      link.classList.toggle('active', link.dataset.panel === panelId);
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.setAttribute('aria-hidden', 'true');
      panel.style.display = 'none';
    });
    const target = document.getElementById(panelId);
    if(target){
      target.removeAttribute('aria-hidden');
      target.style.display = 'block';
    }
    localStorage.setItem('admin-active-panel', panelId);
    if (panelId === 'sales') {
      loadSalesPanel();
    }
    if (panelId === 'bi-report') {
      renderBIReport();
    }
  };

  document.querySelectorAll('.nav-link[data-panel]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel(a.dataset.panel);
    if(isMobile()) {
      collapseSidebar();
      if(sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
    }
  }));

  const settingsTabs = document.querySelectorAll('.settings-tab');
  const settingsPanels = document.querySelectorAll('.settings-tab-panel');
  const activateSettingsTab = (targetId) => {
    settingsTabs.forEach((tab) => {
      const isActive = tab.dataset.target === targetId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    settingsPanels.forEach((panel) => {
      const isActive = panel.id === targetId;
      panel.hidden = !isActive;
      panel.style.display = isActive ? 'block' : 'none';
    });
  };
  settingsTabs.forEach((tab) => {
    tab.addEventListener('click', () => activateSettingsTab(tab.dataset.target));
  });
  if(settingsTabs.length) {
    activateSettingsTab(settingsTabs[0].dataset.target);
  }

  const savedAdminPanel = localStorage.getItem('admin-active-panel');
  const initialPanel = (savedAdminPanel && document.getElementById(savedAdminPanel))
    || document.getElementById('overview')
    || document.querySelector('.panel');
  if(initialPanel){ showPanel(initialPanel.id || initialPanel.getAttribute('id') || 'overview'); }

  const qaCreateProduct = document.getElementById('qa-create-product');
  const qaAddStaff = document.getElementById('qa-add-staff');
  const qaViewSales = document.getElementById('qa-view-sales');
  const qaGenerateReport = document.getElementById('qa-generate-report');

  function activateQuickAction(card, action) {
    if (!card) return;
    card.addEventListener('click', action);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        action();
      }
    });
  }

  function openCreateProductFlow() {
    showPanel('product-management');
    const inventorySearch = document.getElementById('inventory-search');
    if (inventorySearch) {
      inventorySearch.focus();
    }
  }

  function openAddStaffFlow() {
    showPanel('directories');
    resetAddUserForm();
    if (userRole) {
      userRole.value = 'cashier';
      toggleWaiterTableSection();
    }
    if (addUserModal) {
      addUserModal.style.display = 'flex';
      addUserModal.setAttribute('aria-hidden', 'false');
      if (userFullName) userFullName.focus();
    }
  }

  function openViewSalesFlow() {
    showPanel('sales');
    loadSalesPanel();
  }

  activateQuickAction(qaCreateProduct, openCreateProductFlow);
  activateQuickAction(qaAddStaff, openAddStaffFlow);
  activateQuickAction(qaViewSales, openViewSalesFlow);
  activateQuickAction(qaGenerateReport, generateEndOfDayReport);

  const salesSearchInput = document.getElementById('sales-search');
  const salesDateFilterInput = document.getElementById('sales-date-filter');
  if (salesSearchInput) {
    salesSearchInput.addEventListener('input', () => {
      salesCurrentPage = 1;
      loadSalesPanel();
    });
  }
  if (salesDateFilterInput) {
    salesDateFilterInput.addEventListener('change', () => {
      salesCurrentPage = 1;
      loadSalesPanel();
    });
  }

  // User management modal + table wiring
  const btnOpenAddUser = document.getElementById('btn-open-add-user');
  const userSearchInput = document.getElementById('users-search');
  const userTablePagination = document.getElementById('users-table-pagination');
  const userPageInfo = document.getElementById('users-page-info');
  const addUserModal = document.getElementById('add-user-modal');
  const addUserForm = document.getElementById('add-user-form');
  const userFullName = document.getElementById('user-full-name');
  const userUsername = document.getElementById('user-username');
  const userPassword = document.getElementById('user-password');
  const userShowPassword = document.getElementById('user-show-password');
  const userRole = document.getElementById('user-role');
  const userStatus = document.getElementById('user-status');
  const userTables = document.getElementById('user-tables');
  const waiterTableSection = document.getElementById('waiter-table-section');
  const editUserId = document.getElementById('edit-user-id');
  const USERS_PAGE_SIZE = 10;
  let usersCurrentPage = 1;
  let usersSearchTerm = '';

  function toggleWaiterTableSection(){
    if(!waiterTableSection || !userRole) return;
    const isWaiter = userRole.value === 'waiter';
    waiterTableSection.style.display = isWaiter ? 'block' : 'none';
    if(!isWaiter && userTables) userTables.value = '';
  }

  function parseWaiterTables(rawTables){
    if(!rawTables || typeof rawTables !== 'string') return [];
    const tableSet = new Set();
    rawTables.split(',').map((entry) => entry.trim()).filter(Boolean).forEach((entry) => {
      const rangeMatch = entry.match(/^(\d+)\s*-\s*(\d+)$/);
      if(rangeMatch){
        let start = Number(rangeMatch[1]);
        let end = Number(rangeMatch[2]);
        if(Number.isInteger(start) && Number.isInteger(end)){
          if(start > end) [start, end] = [end, start];
          for(let table = start; table <= end; table += 1){
            tableSet.add(String(table));
          }
          return;
        }
      }
      if(entry){
        tableSet.add(entry);
      }
    });
    return Array.from(tableSet);
  }

  function clearEditAdminOption(){
    if(!userRole) return;
    const existingAdminOption = userRole.querySelector('option[value="admin"]');
    if(existingAdminOption && existingAdminOption.dataset.tempAdmin === 'true'){
      existingAdminOption.remove();
      delete userRole.dataset.tempAdmin;
    }
  }

  function getAssignedWaiterTables(users, excludeUserId = null){
    const assigned = {};
    (users || []).forEach((u) => {
      if(!u || u.role !== 'waiter') return;
      if(excludeUserId && Number(u.id) === Number(excludeUserId)) return;
      const tableList = Array.isArray(u.tables) ? u.tables : parseWaiterTables(String(u.tables || ''));
      tableList.forEach((table) => {
        if(table){
          assigned[String(table)] = u.fullName || u.username || 'unknown';
        }
      });
    });
    return assigned;
  }

  function findWaiterTableConflict(candidateTables, users, excludeUserId = null){
    const assigned = getAssignedWaiterTables(users, excludeUserId);
    const conflicts = [];
    (candidateTables || []).forEach((table) => {
      if(table && assigned[String(table)]){
        conflicts.push({ table: String(table), owner: assigned[String(table)] });
      }
    });
    return conflicts;
  }

  function resetAddUserForm(){
    if(addUserForm) addUserForm.reset();
    if(editUserId) editUserId.value = '';
    if(userRole){
      clearEditAdminOption();
      userRole.value = 'cashier';
    }
    if(userStatus) userStatus.value = 'active';
    if(addUserForm) addUserForm.dataset.mode = 'create';
    const modalTitle = document.getElementById('add-user-title');
    if(modalTitle) modalTitle.textContent = 'Create User';
    const submitBtn = addUserForm ? addUserForm.querySelector('button[type="submit"]') : null;
    if(submitBtn) submitBtn.textContent = 'Create User';
    toggleWaiterTableSection();
  }

  function getFilteredUsers(users){
    const term = (usersSearchTerm || '').toLowerCase().trim();
    if(!term) return users;
    return users.filter((u) => {
      const fullName = (u.fullName || u.username || '').toString().toLowerCase();
      const username = (u.username || '').toString().toLowerCase();
      const role = (u.role || '').toString().toLowerCase();
      const status = (u.status || '').toString().toLowerCase();
      const tables = (Array.isArray(u.tables) ? u.tables.join(', ') : String(u.tables || '')).toLowerCase();
      return [fullName, username, role, status, tables].some((value) => value.includes(term));
    });
  }

  function renderUserPagination(totalItems){
    if(!userTablePagination) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / USERS_PAGE_SIZE));
    if(usersCurrentPage > totalPages) usersCurrentPage = totalPages;

    userTablePagination.style.display = 'flex';
    userTablePagination.style.alignItems = 'center';
    userTablePagination.style.justifyContent = 'flex-end';
    userTablePagination.style.gap = '8px';
    userTablePagination.style.flexWrap = 'wrap';
    userTablePagination.style.minHeight = '38px';

    userTablePagination.innerHTML = `
      <span id="users-page-info" class="muted" style="margin-right:8px;">Page ${usersCurrentPage} of ${totalPages}</span>
      <button id="users-page-prev" class="btn btn-ghost" type="button" ${usersCurrentPage === 1 ? 'disabled' : ''}>Prev</button>
      <button id="users-page-next" class="btn btn-ghost" type="button" ${usersCurrentPage === totalPages ? 'disabled' : ''}>Next</button>
    `;

    const prevBtn = userTablePagination.querySelector('#users-page-prev');
    const nextBtn = userTablePagination.querySelector('#users-page-next');
    if(prevBtn){ prevBtn.addEventListener('click', () => { if(usersCurrentPage > 1){ usersCurrentPage -= 1; refreshUsers(); } }); }
    if(nextBtn){ nextBtn.addEventListener('click', () => { if(usersCurrentPage < totalPages){ usersCurrentPage += 1; refreshUsers(); } }); }
  }

  async function refreshUsers(){
    const tbl = document.getElementById('users-table');
    if(!tbl) return;
    const tbody = tbl.querySelector('tbody');
    if(!tbody) return;
    let users = [];
    if (BACKEND_AVAILABLE) {
      try {
        const response = await fetchBackend('/api/users/list');
        users = response.users || [];
      } catch (err) {
        console.warn('Backend user list unavailable, falling back to local DB', err);
        users = await RestaurantDB.getAllUsers();
      }
    } else {
      users = await RestaurantDB.getAllUsers();
    }
    tbody.innerHTML = '';
    if(!users || users.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="muted" style="padding:8px">No users found.</td>`;
      tbody.appendChild(tr);
      renderUserPagination(0);
      return;
    }
    users.sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
    const filteredUsers = getFilteredUsers(users);
    if(filteredUsers.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="muted" style="padding:8px">No users match your search.</td>`;
      tbody.appendChild(tr);
      renderUserPagination(0);
      return;
    }
    const totalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
    if(usersCurrentPage > totalPages) usersCurrentPage = totalPages;
    const startIndex = (usersCurrentPage - 1) * USERS_PAGE_SIZE;
    const pageUsers = filteredUsers.slice(startIndex, startIndex + USERS_PAGE_SIZE);
    pageUsers.forEach((u)=>{
      const tr = document.createElement('tr');
      const fullName = u.fullName || u.username || '—';
      const tables = Array.isArray(u.tables) && u.tables.length ? u.tables.join(', ') : '—';
      const status = u.status || 'active';
      const isActive = status === 'active';
      const toggleTitle = isActive ? 'Deactivate user' : 'Activate user';
      const toggleClass = isActive ? 'action-toggle' : 'action-activate';
      const statusClass = isActive ? 'status-active' : 'status-inactive';
      const statusIcon = isActive
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" fill="currentColor"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
      tr.innerHTML = `<td style="padding:8px;border-bottom:1px solid var(--border)">${fullName}</td><td style="padding:8px;border-bottom:1px solid var(--border)">${u.username}</td><td style="padding:8px;border-bottom:1px solid var(--border)">${u.role}</td><td style="padding:8px;border-bottom:1px solid var(--border)"><span class="status-badge ${statusClass}">${status}</span></td><td style="padding:8px;border-bottom:1px solid var(--border)">${tables}</td><td style="padding:8px;border-bottom:1px solid var(--border)"><div class='table-action-buttons'><button class='table-icon-btn action-edit' data-edit-user='${u.id}' title='Edit user' aria-label='Edit user'><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' aria-hidden='true'><path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z' fill='currentColor'/></svg></button><button class='table-icon-btn ${toggleClass}' data-toggle-user='${u.id}' title='${toggleTitle}' aria-label='${toggleTitle}'>${statusIcon}</button><button class='table-icon-btn action-delete' data-delete-user='${u.id}' title='Delete user' aria-label='Delete user'><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' aria-hidden='true'><path d='M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z' fill='currentColor'/></svg></button></div></td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-edit-user]').forEach((btn)=>{
      btn.addEventListener('click', async (ev)=>{
        const id = ev.currentTarget.getAttribute('data-edit-user');
        if(!id) return;
        let user = null;
        if (BACKEND_AVAILABLE) {
          try {
            const data = await fetchBackend(`/api/users/${encodeURIComponent(id)}`);
            user = data.user;
          } catch (err) {
            console.warn('Backend failed to fetch user by ID, falling back to local DB', err);
            user = await RestaurantDB.getUserById(Number(id));
          }
        } else {
          user = await RestaurantDB.getUserById(Number(id));
        }
        if(!user) return;
        if(editUserId) editUserId.value = String(id);
        if(userFullName) userFullName.value = user.fullName || '';
        if(userUsername) userUsername.value = user.username || '';
        if(userPassword) userPassword.value = '';
        if(userRole){
          clearEditAdminOption();
          if(user.role === 'admin'){
            const adminOption = new Option('Admin', 'admin');
            adminOption.disabled = true;
            adminOption.dataset.tempAdmin = 'true';
            userRole.appendChild(adminOption);
            userRole.value = 'admin';
          } else {
            userRole.value = user.role || 'cashier';
          }
        }
        if(userStatus) userStatus.value = user.status || 'active';
        if(userTables) userTables.value = Array.isArray(user.tables) ? user.tables.join(',') : '';
        if(addUserForm) addUserForm.dataset.mode = 'edit';
        const modalTitle = document.getElementById('add-user-title');
        if(modalTitle) modalTitle.textContent = 'Edit User';
        const submitBtn = addUserForm ? addUserForm.querySelector('button[type="submit"]') : null;
        if(submitBtn) submitBtn.textContent = 'Save Changes';
        toggleWaiterTableSection();
        if(addUserModal){
          addUserModal.style.display = 'flex';
          addUserModal.setAttribute('aria-hidden','false');
        }
        if(userFullName) userFullName.focus();
      });
    });

    tbody.querySelectorAll('[data-toggle-user]').forEach((btn)=>{
      btn.addEventListener('click', async (ev)=>{
        const id = ev.currentTarget.getAttribute('data-toggle-user');
        if(!id) return;
        try{
          let user = null;
          if (BACKEND_AVAILABLE) {
            const response = await fetchBackend(`/api/users/${encodeURIComponent(id)}`);
            user = response.user;
          } else {
            user = await RestaurantDB.getUserById(Number(id));
          }
          if(!user) return;
          user.status = (user.status || 'active') === 'active' ? 'inactive' : 'active';
          if (BACKEND_AVAILABLE) {
            await fetchBackend('/api/users/update', {
              method: 'POST',
              body: JSON.stringify({ id: user.id, username: user.username, role: user.role, fullName: user.fullName, status: user.status, tables: user.tables || [] })
            });
          } else {
            user.updatedAt = new Date().toISOString();
            await RestaurantDB.updateUser(user);
          }
          await refreshUsers();
          showToast(`User ${user.status === 'inactive' ? 'deactivated' : 'activated'} successfully`, 'success');
        }catch(err){
          showToast(`Failed to update user status: ${err.message}`, 'error');
        }
      });
    });

    tbody.querySelectorAll('[data-delete-user]').forEach((btn)=>{
      btn.addEventListener('click', async (ev)=>{
        const id = ev.currentTarget.getAttribute('data-delete-user');
        if(!id) return;
        showConfirmDialog({
          title: 'Delete user',
          message: 'Are you sure you want to delete this user? This action cannot be undone.',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          onConfirm: async () => {
            try{
              if (BACKEND_AVAILABLE) {
                await fetchBackend('/api/users/delete', {
                  method: 'POST',
                  body: JSON.stringify({ id })
                });
              } else {
                await RestaurantDB.deleteUser(Number(id));
              }
              await refreshUsers();
              if (typeof updateOperationalSnapshotCounts === 'function') await updateOperationalSnapshotCounts();
              showToast('User deleted successfully', 'success');
            }catch(err){
              showToast(`Failed to delete user: ${err.message}`, 'error');
            }
          }
        });
      });
    });
  }

  if(btnOpenAddUser && addUserModal){
    btnOpenAddUser.addEventListener('click', ()=>{
      resetAddUserForm();
      addUserModal.style.display = 'flex';
      addUserModal.setAttribute('aria-hidden', 'false');
      if(userFullName) userFullName.focus();
    });
  }

  if(userSearchInput){
    userSearchInput.addEventListener('input', ()=>{
      usersSearchTerm = userSearchInput.value || '';
      usersCurrentPage = 1;
      refreshUsers();
    });
  }

  if(userRole) userRole.addEventListener('change', toggleWaiterTableSection);
  if(userShowPassword && userPassword){
    userShowPassword.addEventListener('change', ()=>{
      userPassword.type = userShowPassword.checked ? 'text' : 'password';
    });
  }

  if(addUserForm){
    addUserForm.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const mode = addUserForm.dataset.mode || 'create';
      const userId = editUserId ? Number(editUserId.value) : null;
      const fullName = userFullName ? userFullName.value.trim() : '';
      const username = userUsername ? userUsername.value.trim() : '';
      const password = userPassword ? userPassword.value : '';
      const role = userRole ? userRole.value : 'cashier';
      const status = userStatus ? userStatus.value : 'active';
      const tablesRaw = userTables ? userTables.value.trim() : '';
      const tables = role === 'waiter' ? parseWaiterTables(tablesRaw) : [];

      if(!fullName || !username){ showToast('Please complete full name and username.', 'error'); return; }
      if(mode === 'create' && !password){ showToast('Password is required for new users.', 'error'); return; }

      try{
        let allUsers = [];
        if (BACKEND_AVAILABLE) {
          try {
            const response = await fetchBackend('/api/users/list');
            allUsers = response.users || [];
          } catch (err) {
            console.warn('Failed to fetch users from backend for duplicate check, falling back to local DB', err);
            allUsers = await RestaurantDB.getAllUsers();
          }
        } else {
          allUsers = await RestaurantDB.getAllUsers();
        }
        const existing = allUsers.find(u => u.username && u.username.toLowerCase() === username.toLowerCase() && (mode === 'create' || u.id !== userId));
        if(existing){ showToast('Username already exists', 'error'); return; }

        if(role === 'waiter' && tables.length){
          const conflicts = findWaiterTableConflict(tables, allUsers, mode === 'edit' ? userId : null);
          if(conflicts.length){
            const conflictInfo = conflicts.slice(0, 3).map(c => `${c.table} (${c.owner})`).join(', ');
            showToast(`Table ${conflictInfo} already assigned to another waiter.`, 'error');
            return;
          }
        }

        if(mode === 'edit' && userId){
          let user = null;
          if (BACKEND_AVAILABLE) {
            const response = await fetchBackend('/api/users/update', {
              method: 'POST',
              body: JSON.stringify({ id: String(userId), username, role, fullName, status, tables })
            });
            user = response.user;
          } else {
            user = await RestaurantDB.getUserById(userId);
            if(!user){ showToast('User no longer exists.', 'error'); return; }
            user.fullName = fullName;
            user.username = username;
            user.role = role;
            user.status = status;
            user.tables = role === 'waiter' ? tables : [];
            user.updatedAt = new Date().toISOString();
            await RestaurantDB.updateUser(user);
          }
          if(password){
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ username, currentPassword: password, newPassword: password })
              });
            } else {
              await RestaurantDB.changeUserPassword(userId, password);
            }
          }
          showToast(`User "${username}" updated successfully`, 'success');
        } else {
          if (BACKEND_AVAILABLE) {
            await fetchBackend('/api/users/create', {
              method: 'POST',
              body: JSON.stringify({ username, password, role, fullName, status, tables })
            });
          } else {
            await RestaurantDB.createUser({ username, password, role, fullName, status, tables });
          }
          showToast(`User "${username}" created successfully`, 'success');
        }

        resetAddUserForm();
        addUserModal.style.display = '';
        addUserModal.setAttribute('aria-hidden','true');
        await refreshUsers();
      }catch(err){
        showToast(`Failed to save user: ${err.message}`, 'error');
      }
    });
  }

  refreshUsers().catch(err => console.error('Failed to load users', err));

  // Inventory wiring: hierarchical tree-based product management
  (async function(){
    const $ = id => document.getElementById(id);
    
    // Helper functions
    function closeModal(modalId) {
      const modal = $(modalId);
      if (modal) {
        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = '';
      }
    }

    function openModal(modalId) {
      const modal = $(modalId);
      if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
      }
    }

    // Modal close button handlers
    document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modal = btn.closest('.modal');
        if (modal) {
          const modalId = modal.id;
          closeModal(modalId);
          const form = modal.querySelector('form');
          if (form) form.reset();
        }
      });
    });

    // Cancel buttons share the same close behavior
    document.querySelectorAll('[data-action="cancel-edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = btn.closest('.modal');
        if (modal) {
          modal.setAttribute('aria-hidden', 'true');
          modal.style.display = '';
        }
      });
    });

    // Barcode generation (EAN-13)
    function generateEAN13(){
      const digits = [];
      for(let i=0;i<12;i++) digits.push(Math.floor(Math.random()*10));
      const sum = digits.reduce((acc,d,i)=> acc + (i % 2 === 0 ? d : d * 3), 0);
      const check = (10 - (sum % 10)) % 10;
      digits.push(check);
      return digits.join('');
    }

    // SVG renderer for EAN-13
    function renderEAN13SVG(code, opts){
      opts = opts || {};
      const widthUnit = opts.widthUnit || 1;
      const height = opts.height || 60;
      const textHeight = opts.textHeight || 14;
      if(!/^[0-9]{13}$/.test(code)) return null;
      const L = {'0':'0001101','1':'0011001','2':'0010011','3':'0111101','4':'0100011','5':'0110001','6':'0101111','7':'0111011','8':'0110111','9':'0001011'};
      const G = {'0':'0100111','1':'0110011','2':'0011011','3':'0100001','4':'0011101','5':'0111001','6':'0000101','7':'0010001','8':'0001001','9':'0010111'};
      const R = {'0':'1110010','1':'1100110','2':'1101100','3':'1000010','4':'1011100','5':'1001110','6':'1010000','7':'1000100','8':'1001000','9':'1110100'};
      const parityTable = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
      const first = code[0];
      const left = code.slice(1,7);
      const right = code.slice(7);
      const parity = parityTable[Number(first)];
      let bits = '101';
      for(let i=0;i<6;i++) bits += (parity[i]==='L' ? L[left[i]] : G[left[i]]);
      bits += '01010';
      for(let i=0;i<6;i++) bits += R[right[i]];
      bits += '101';
      const totalWidth = bits.length * widthUnit + 20;
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('width', totalWidth);
      svg.setAttribute('height', height + textHeight + 6);
      svg.setAttribute('viewBox', `0 0 ${totalWidth} ${height + textHeight + 6}`);
      svg.style.background = 'transparent';
      const g = document.createElementNS('http://www.w3.org/2000/svg','g');
      g.setAttribute('transform','translate(10,0)');
      let x = 0;
      for(let i=0;i<bits.length;i++){
        const bit = bits[i];
        const barHeight = (i<3 || (i>=3+42 && i<3+42+5) || i>=3+42+5+42) ? height + 6 : height;
        if(bit==='1'){
          const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
          rect.setAttribute('x', x);
          rect.setAttribute('y', 0);
          rect.setAttribute('width', widthUnit);
          rect.setAttribute('height', barHeight);
          rect.setAttribute('fill', '#111');
          g.appendChild(rect);
        }
        x += widthUnit;
      }
      svg.appendChild(g);
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', 0);
      txt.setAttribute('y', height + textHeight);
      txt.setAttribute('fill', '#111');
      txt.setAttribute('font-size', textHeight);
      txt.setAttribute('font-family','monospace');
      txt.textContent = code;
      svg.appendChild(txt);
      return svg;
    }

    async function getBackendCategories(){
      if (!BACKEND_AVAILABLE) return [];
      const res = await fetchBackend('/api/categories');
      return res.categories || [];
    }

    async function getBackendSubcategories(){
      if (!BACKEND_AVAILABLE) return [];
      const res = await fetchBackend('/api/subcategories');
      return res.subcategories || [];
    }

    async function getBackendProducts(){
      if (!BACKEND_AVAILABLE) return [];
      const res = await fetchBackend('/api/products');
      return res.products || [];
    }

    async function findBackendCategoryById(id){
      const cats = await getBackendCategories();
      return cats.find(c => String(c.id) === String(id)) || null;
    }

    async function findBackendSubcategoryById(id){
      const subs = await getBackendSubcategories();
      return subs.find(s => String(s.id) === String(id)) || null;
    }

    async function findBackendProductById(id){
      const prods = await getBackendProducts();
      return prods.find(p => String(p.id) === String(id)) || null;
    }

    // Render hierarchical inventory tree
    async function refreshInventory() {
      const treeContainer = $('inventory-tree');
      let cats = [];
      let subs = [];
      let prods = [];
      if (BACKEND_AVAILABLE) {
        try {
          [cats, subs, prods] = await Promise.all([getBackendCategories(), getBackendSubcategories(), getBackendProducts()]);
        } catch (backendErr) {
          console.warn('Failed to load inventory from backend, falling back to local DB', backendErr);
          cats = await RestaurantDB.getAllCategories();
          subs = await RestaurantDB.getAllSubcategories();
          prods = await RestaurantDB.getAllProducts();
        }
      } else {
        cats = await RestaurantDB.getAllCategories();
        subs = await RestaurantDB.getAllSubcategories();
        prods = await RestaurantDB.getAllProducts();
      }

      const catCount = $('cat-count');
      const subcatCount = $('subcat-count');
      const prodCount = $('prod-count');
      if(catCount) catCount.textContent = String(cats.length);
      if(subcatCount) subcatCount.textContent = String(subs.length);
      if(prodCount) prodCount.textContent = String(prods.length);

      if (!treeContainer) return;

      const searchQuery = ($('inventory-search')?.value || '').toLowerCase();

      function matchesSearch(text) {
        if (!searchQuery) return true;
        return text.toLowerCase().includes(searchQuery);
      }

      if (cats.length === 0) {
        treeContainer.innerHTML = '<div class="empty-tree">No categories yet. Click "Add Category" to get started.</div>';
        return;
      }

      let html = '';
      cats.forEach(cat => {
        const subForCat = subs.filter(s => String(s.parent) === String(cat.id));
        const prodsForCat = prods.filter(p => String(p.cat) === String(cat.id));
        
        const catMatches = matchesSearch(cat.name);
        const subMatches = subForCat.some(s => matchesSearch(s.name));
        const prodMatches = prodsForCat.some(p => matchesSearch(p.name));
        const shouldShow = catMatches || subMatches || prodMatches;

        if (!shouldShow) return;

        html += `<div class="tree-item"><div class="tree-item-header level-1 collapsed" data-toggle-category="${cat.id}" style="border-left:4px solid ${cat.color || '#38bdf8'};"><div class="tree-icon">▼</div><div class="tree-item-content"><div class="tree-item-label"><div class="tree-item-name">📂 ${cat.name}</div><div class="tree-item-meta"><span>${subForCat.length} subcategories</span><span>${prodsForCat.length} products</span></div></div></div><div class="tree-actions"><button class="tree-btn-small tree-btn-add" data-add-subcategory="${cat.id}" title="Add Subcategory">+</button><button class="tree-btn-small tree-btn-edit" data-edit-category="${cat.id}" title="Edit">✏</button><button class="tree-btn-small tree-btn-delete" data-delete-category="${cat.id}" title="Delete">🗑</button></div></div><div class="tree-item-children">`;

        subForCat.forEach(sub => {
          const prodsForSub = prodsForCat.filter(p => String(p.sub) === String(sub.id));
          const subMatches = matchesSearch(sub.name);
          const prodMatches = prodsForSub.some(p => matchesSearch(p.name));
          
          if (!subMatches && !prodMatches && searchQuery) return;

          html += `<div class="tree-item"><div class="tree-item-header level-2 collapsed" data-toggle-subcategory="${sub.id}" style="border-left:4px solid ${sub.color || '#6ee7b7'};"><div class="tree-icon">▼</div><div class="tree-item-content"><div class="tree-item-label"><div class="tree-item-name">🏷️ ${sub.name}</div><div class="tree-item-meta"><span>${prodsForSub.length} products</span></div></div></div><div class="tree-actions"><button class="tree-btn-small tree-btn-add" data-add-product="${sub.id}" data-product-category="${cat.id}" title="Add Product">+</button><button class="tree-btn-small tree-btn-edit" data-edit-subcategory="${sub.id}" data-subcategory-category="${cat.id}" title="Edit">✏</button><button class="tree-btn-small tree-btn-delete" data-delete-subcategory="${sub.id}" title="Delete">🗑</button></div></div><div class="tree-item-children">`;

          prodsForSub.forEach(prod => {
            if (searchQuery && !matchesSearch(prod.name) && !matchesSearch(prod.barcode || '')) return;

            const priceDisplay = prod.price ? `₦${new Intl.NumberFormat('en-NG').format(parseFloat(prod.price))}` : '—';
            const qty = prod.quantity !== undefined ? prod.quantity : 0;

            html += `<div class="tree-item"><div class="tree-item-header level-3" style="border-left:4px solid ${prod.color || '#c7d2fe'};"><div class="tree-item-content"><div class="tree-item-label"><div class="tree-item-name">📦 ${prod.name}</div><div class="tree-item-meta"><span>${priceDisplay}</span><span>Stock: ${qty}</span></div></div></div><div class="tree-actions"><button class="tree-btn-small tree-btn-edit" data-edit-product="${prod.id}" data-product-category="${cat.id}" data-product-subcategory="${sub.id}" title="Edit">✏</button><button class="tree-btn-small tree-btn-delete" data-delete-product="${prod.id}" title="Delete">🗑</button></div></div></div>`;
          });

          html += `</div></div>`;
        });

        html += `</div></div>`;
      });

      treeContainer.innerHTML = html || '<div class="empty-tree">No items match your search.</div>';
      wireUpTreeHandlers();
    }

    function wireUpTreeHandlers() {
      document.querySelectorAll('[data-toggle-category]').forEach(header => {
        header.addEventListener('click', () => { header.classList.toggle('collapsed'); });
      });

      document.querySelectorAll('[data-toggle-subcategory]').forEach(header => {
        header.addEventListener('click', () => { header.classList.toggle('collapsed'); });
      });

      document.querySelectorAll('[data-add-subcategory]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const catId = btn.dataset.addSubcategory;
          $('subcategory-id').value = '';
          $('subcategory-parent').value = catId;
          $('subcategory-name').value = '';
          $('subcategory-color').value = '#6ee7b7';
          $('subcategory-modal-title').textContent = 'Add Subcategory';
          $('subcategory-form').dataset.mode = 'create';
          openModal('subcategory-modal');
          setTimeout(() => $('subcategory-name').focus(), 100);
        });
      });

      document.querySelectorAll('[data-add-product]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const subId = btn.dataset.addProduct;
          const catId = btn.dataset.productCategory;
          $('product-id').value = '';
          $('product-category').value = catId;
          $('product-subcategory').value = subId;
          $('product-name').value = '';
          $('product-price').value = '';
          $('product-quantity').value = '';
          $('product-barcode').value = '';
          $('product-color').value = '#c7d2fe';
          $('product-barcode-preview').innerHTML = '';
          $('product-modal-title').textContent = 'Add Product';
          $('product-form').dataset.mode = 'create';
          openModal('product-modal');
          setTimeout(() => $('product-name').focus(), 100);
        });
      });

      document.querySelectorAll('[data-edit-category]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const catId = btn.dataset.editCategory;
          let cat = null;
          if (BACKEND_AVAILABLE) {
            cat = await findBackendCategoryById(catId);
          }
          if (!cat) {
            cat = await RestaurantDB.getCategoryById(catId);
          }
          if (!cat) { showToast('Category not found', 'error'); return; }
          $('category-id').value = catId;
          $('category-name').value = cat.name;
          $('category-color').value = cat.color || '#38bdf8';
          $('category-modal-title').textContent = 'Edit Category';
          $('category-form').dataset.mode = 'edit';
          openModal('category-modal');
          setTimeout(() => $('category-name').focus(), 100);
        });
      });

      document.querySelectorAll('[data-edit-subcategory]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const subId = btn.dataset.editSubcategory;
          let sub = null;
          if (BACKEND_AVAILABLE) {
            sub = await findBackendSubcategoryById(subId);
          }
          if (!sub) {
            sub = await RestaurantDB.getSubcategoryById(subId);
          }
          if (!sub) { showToast('Subcategory not found', 'error'); return; }
          $('subcategory-id').value = subId;
          $('subcategory-parent').value = sub.parent;
          $('subcategory-name').value = sub.name;
          $('subcategory-color').value = sub.color || '#6ee7b7';
          $('subcategory-modal-title').textContent = 'Edit Subcategory';
          $('subcategory-form').dataset.mode = 'edit';
          openModal('subcategory-modal');
          setTimeout(() => $('subcategory-name').focus(), 100);
        });
      });

      document.querySelectorAll('[data-edit-product]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const prodId = btn.dataset.editProduct;
          let prod = null;
          if (BACKEND_AVAILABLE) {
            prod = await findBackendProductById(prodId);
          }
          if (!prod) {
            prod = await RestaurantDB.getProductById(prodId);
          }
          if (!prod) { showToast('Product not found', 'error'); return; }
          $('product-id').value = prodId;
          $('product-category').value = prod.cat;
          $('product-subcategory').value = prod.sub;
          $('product-name').value = prod.name;
          $('product-price').value = prod.price || '';
          $('product-quantity').value = prod.quantity !== undefined ? prod.quantity : '';
          $('product-barcode').value = prod.barcode || '';
          $('product-color').value = prod.color || '#c7d2fe';
          if (prod.barcode && /^[0-9]{13}$/.test(prod.barcode)) {
            $('product-barcode-preview').innerHTML = '';
            const svg = renderEAN13SVG(prod.barcode, {widthUnit: 2, height: 60});
            if (svg) {
              $('product-barcode-preview').appendChild(svg);
              $('product-barcode-preview').setAttribute('aria-hidden', 'false');
            }
          } else {
            $('product-barcode-preview').innerHTML = '';
          }
          $('product-modal-title').textContent = 'Edit Product';
          $('product-form').dataset.mode = 'edit';
          openModal('product-modal');
          setTimeout(() => $('product-name').focus(), 100);
        });
      });

      document.querySelectorAll('[data-delete-category]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const catId = btn.dataset.deleteCategory;
          if (!confirm('Delete this category and all its subcategories and products?')) return;
          try {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/categories/delete', {
                method: 'POST',
                body: JSON.stringify({ id: catId })
              });
            } else {
              await RestaurantDB.deleteCategory(catId);
            }
            showToast('Category deleted successfully', 'success');
            await refreshInventory();
          } catch (err) {
            showToast(`Failed to delete category: ${err.message}`, 'error');
          }
        });
      });

      document.querySelectorAll('[data-delete-subcategory]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const subId = btn.dataset.deleteSubcategory;
          if (!confirm('Delete this subcategory and all its products?')) return;
          try {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/subcategories/delete', {
                method: 'POST',
                body: JSON.stringify({ id: subId })
              });
            } else {
              await RestaurantDB.deleteSubcategory(subId);
            }
            showToast('Subcategory deleted successfully', 'success');
            await refreshInventory();
          } catch (err) {
            showToast(`Failed to delete subcategory: ${err.message}`, 'error');
          }
        });
      });

      document.querySelectorAll('[data-delete-product]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const prodId = btn.dataset.deleteProduct;
          if (!confirm('Delete this product?')) return;
          try {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/products/delete', {
                method: 'POST',
                body: JSON.stringify({ id: prodId })
              });
            } else {
              await RestaurantDB.deleteProduct(prodId);
            }
            showToast('Product deleted successfully', 'success');
            await refreshInventory();
          } catch (err) {
            showToast(`Failed to delete product: ${err.message}`, 'error');
          }
        });
      });
    }

    const btnAddCategory = $('btn-add-category');
    if (btnAddCategory) {
      btnAddCategory.addEventListener('click', () => {
        $('category-id').value = '';
        $('category-name').value = '';
        $('category-color').value = '#38bdf8';
        $('category-modal-title').textContent = 'Add Category';
        $('category-form').dataset.mode = 'create';
        openModal('category-modal');
        setTimeout(() => $('category-name').focus(), 100);
      });
    }

    // Form handlers
    const categoryForm = $('category-form');
    if (categoryForm) {
      categoryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('category-id').value;
        const name = ($('category-name').value || '').trim();
        const mode = categoryForm.dataset.mode || 'create';

        if (!name) { showToast('Enter category name', 'error'); return; }

        const color = $('category-color')?.value || '#38bdf8';
        try {
          if (mode === 'edit') {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/categories/save', {
                method: 'POST',
                body: JSON.stringify({ id, name, color })
              });
            } else {
              await RestaurantDB.updateCategory({ id, name, color });
            }
            showToast('Category updated successfully', 'success');
          } else {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/categories/save', {
                method: 'POST',
                body: JSON.stringify({ name, color })
              });
            } else {
              await RestaurantDB.addCategory({ name, color });
            }
            showToast(`Category "${name}" added successfully`, 'success');
          }
          closeModal('category-modal');
          categoryForm.reset();
          await refreshInventory();
        } catch (err) {
          showToast(`Failed to save category: ${err.message}`, 'error');
        }
      });
    }

    const subcategoryForm = $('subcategory-form');
    if (subcategoryForm) {
      subcategoryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('subcategory-id').value;
        const parent = $('subcategory-parent').value;
        const name = ($('subcategory-name').value || '').trim();
        const color = $('subcategory-color')?.value || '#6ee7b7';
        const mode = subcategoryForm.dataset.mode || 'create';

        if (!parent) { showToast('Select parent category', 'error'); return; }
        if (!name) { showToast('Enter subcategory name', 'error'); return; }

        try {
          if (mode === 'edit') {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/subcategories/save', {
                method: 'POST',
                body: JSON.stringify({ id, name, parent, color })
              });
            } else {
              await RestaurantDB.updateSubcategory({ id, name, parent, color });
            }
            showToast('Subcategory updated successfully', 'success');
          } else {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/subcategories/save', {
                method: 'POST',
                body: JSON.stringify({ name, parent, color })
              });
            } else {
              await RestaurantDB.addSubcategory({ name, parent, color });
            }
            showToast(`Subcategory "${name}" added successfully`, 'success');
          }
          closeModal('subcategory-modal');
          subcategoryForm.reset();
          await refreshInventory();
        } catch (err) {
          showToast(`Failed to save subcategory: ${err.message}`, 'error');
        }
      });
    }

    const productForm = $('product-form');
    if (productForm) {
      productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('product-id').value;
        const cat = $('product-category').value;
        const sub = $('product-subcategory').value;
        const name = ($('product-name').value || '').trim();
        const price = ($('product-price').value || '').trim() || null;
        const quantity = parseInt($('product-quantity').value || '0', 10);
        const barcode = ($('product-barcode').value || '').trim() || null;
        const color = $('product-color')?.value || '#c7d2fe';
        const mode = productForm.dataset.mode || 'create';

        if (!cat) { showToast('Select category', 'error'); return; }
        if (!sub) { showToast('Select subcategory', 'error'); return; }
        if (!name) { showToast('Enter product name', 'error'); return; }

        try {
          if (mode === 'edit') {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/products/save', {
                method: 'POST',
                body: JSON.stringify({ id, name, barcode, price, quantity, cat, sub, color })
              });
            } else {
              await RestaurantDB.updateProduct({ id, name, barcode, price, quantity, color });
            }
            showToast('Product updated successfully', 'success');
          } else {
            if (BACKEND_AVAILABLE) {
              await fetchBackend('/api/products/save', {
                method: 'POST',
                body: JSON.stringify({ name, barcode, price, quantity, cat, sub, color })
              });
            } else {
              await RestaurantDB.addProduct({ name, cat, sub, barcode, price, quantity, color });
            }
            showToast(`Product "${name}" added successfully`, 'success');
          }
          closeModal('product-modal');
          productForm.reset();
          await refreshInventory();
        } catch (err) {
          showToast(`Failed to save product: ${err.message}`, 'error');
        }
      });
    }

    const btnProductGenBarcode = $('btn-product-gen-barcode');
    if (btnProductGenBarcode) {
      btnProductGenBarcode.addEventListener('click', () => {
        $('product-barcode').value = generateEAN13();
        const svg = renderEAN13SVG($('product-barcode').value, {widthUnit: 2, height: 60});
        if (svg) {
          $('product-barcode-preview').innerHTML = '';
          $('product-barcode-preview').appendChild(svg);
          $('product-barcode-preview').setAttribute('aria-hidden', 'false');
        }
      });
    }

    const productBarcodeInput = $('product-barcode');
    if (productBarcodeInput) {
      productBarcodeInput.addEventListener('input', (e) => {
        const val = (e.target.value || '').trim();
        if ($('product-barcode-preview')) {
          $('product-barcode-preview').innerHTML = '';
          if (/^[0-9]{13}$/.test(val)) {
            const svg = renderEAN13SVG(val, {widthUnit: 2, height: 60});
            if (svg) {
              $('product-barcode-preview').appendChild(svg);
              $('product-barcode-preview').setAttribute('aria-hidden', 'false');
            }
          } else {
            $('product-barcode-preview').setAttribute('aria-hidden', 'true');
          }
        }
      });
    }

    const inventorySearch = $('inventory-search');
    if (inventorySearch) {
      inventorySearch.addEventListener('input', () => refreshInventory());
    }

    // Initial load
    await refreshInventory();
    if (typeof refreshUsers === 'function') {
      await refreshUsers().catch(err => console.error('Failed to load users', err));
    }
    await loadBillingSettings().catch(err => console.error('Failed to load billing settings:', err));
    await loadBusinessDaySetting().catch(err => console.error('Failed to load business day cutoff setting:', err));
    await loadReceiptSettings().catch(err => console.error('Failed to load receipt settings:', err));
    await loadProfileInfo().catch(err => console.error('Failed to load profile info:', err));
    refreshSidebarProfileInfo();
    scheduleBusinessDayRefresh();
    await updateOperationalSnapshotCounts();
    startAdminRealtimeRefresh();
  })();

    // Settings: Billing & Charges
    const taxPercentageInput = document.getElementById('tax-percentage');
    const serviceChargePercentageInput = document.getElementById('service-charge-percentage');
    const discountPercentageInput = document.getElementById('discount-percentage');
    const btnSaveBillingSettings = document.getElementById('btn-save-billing-settings');
    const btnResetBillingSettings = document.getElementById('btn-reset-billing-settings');
    const settingsMessage = document.getElementById('billing-settings-message');
    
    // Stock count and session timeout settings
    const enableStockCountCheckbox = document.getElementById('enable-stock-count');
    const enableLowStockAlertsCheckbox = document.getElementById('enable-low-stock-alerts');
    const lowStockThresholdInput = document.getElementById('low-stock-threshold');
    const systemTimeoutInput = document.getElementById('system-timeout-minutes');
    const btnSaveSystemSettings = document.getElementById('btn-save-system-settings');
    const statusStockCountBadge = document.getElementById('status-stock-count');
    const statusLowStockBadge = document.getElementById('status-low-stock-alerts');
    const statusLowStockThresholdLabel = document.getElementById('status-low-stock-threshold');
    const statusSessionTimeoutLabel = document.getElementById('status-session-timeout');

    const profileFullName = document.getElementById('profile-full-name');
    const profileUsername = document.getElementById('profile-username');
    const profileCurrentPassword = document.getElementById('profile-current-password');
    const profileNewPassword = document.getElementById('profile-new-password');
    const profileNewPasswordConfirm = document.getElementById('profile-new-password-confirm');
    const profileIdDisplay = document.getElementById('profile-id-display');
    const profileRoleDisplay = document.getElementById('profile-role-display');
    const profileSettingsMessage = document.getElementById('profile-settings-message');
    const btnSaveProfileSettings = document.getElementById('btn-save-profile-settings');

    function refreshSystemSettingsSummary(){
      const stockEnabled = enableStockCountCheckbox ? enableStockCountCheckbox.checked : false;
      const lowStockEnabled = enableLowStockAlertsCheckbox ? enableLowStockAlertsCheckbox.checked : false;
      const lowStockThreshold = lowStockThresholdInput ? parseInt(lowStockThresholdInput.value || '0', 10) : 0;
      const timeoutMinutes = systemTimeoutInput ? parseInt(systemTimeoutInput.value || '0', 10) : 0;

      if (statusStockCountBadge) {
        statusStockCountBadge.textContent = stockEnabled ? 'Active' : 'Inactive';
        statusStockCountBadge.classList.toggle('status-active', stockEnabled);
        statusStockCountBadge.classList.toggle('status-inactive', !stockEnabled);
      }
      if (statusLowStockBadge) {
        statusLowStockBadge.textContent = lowStockEnabled ? 'Active' : 'Inactive';
        statusLowStockBadge.classList.toggle('status-active', lowStockEnabled);
        statusLowStockBadge.classList.toggle('status-inactive', !lowStockEnabled);
      }
      if (statusLowStockThresholdLabel) {
        statusLowStockThresholdLabel.textContent = lowStockThreshold > 0 ? `${lowStockThreshold}` : 'Not set';
      }
      if (statusSessionTimeoutLabel) {
        statusSessionTimeoutLabel.textContent = timeoutMinutes > 0 ? `${timeoutMinutes} min` : 'Not set';
      }
    }

    async function loadProfileInfo(){
      try {
        const session = Auth.getSession();
        if (!session) return;
        if (profileFullName) profileFullName.value = String(session.fullName || session.username || '').trim();
        if (profileUsername) profileUsername.value = String(session.username || '').trim();
        if (profileIdDisplay) profileIdDisplay.textContent = String(session.id || '—');
        if (profileRoleDisplay) {
          const roleText = String(session.role || 'Admin');
          profileRoleDisplay.textContent = roleText.charAt(0).toUpperCase() + roleText.slice(1);
        }
      } catch (err) {
        console.warn('Failed to load profile info:', err);
      }
    }

    function refreshSidebarProfileInfo() {
      try {
        const session = Auth.getSession();
        if (!session) return;
        const avatarEl = document.getElementById('admin-avatar');
        const nameEl = document.getElementById('admin-name');
        const roleEl = document.getElementById('admin-role');

        const fullName = String(session.fullName || session.username || '').trim() || 'Admin';
        const roleText = String(session.role || 'admin').trim();
        if (avatarEl) avatarEl.textContent = fullName.charAt(0).toUpperCase() || 'A';
        if (nameEl) nameEl.textContent = fullName;
        if (roleEl) roleEl.textContent = roleText.charAt(0).toUpperCase() + roleText.slice(1).toLowerCase();
      } catch (err) {
        console.warn('Failed to refresh admin sidebar profile info:', err);
      }
    }

    // Load settings on page load
    async function loadBillingSettings(){
      try {
        const taxSetting = await RestaurantDB.getSetting('taxPercentage');
        const serviceSetting = await RestaurantDB.getSetting('serviceChargePercentage');
        const discountSetting = await RestaurantDB.getSetting('discountPercentage');
        const stockCountSetting = await RestaurantDB.getSetting('enableStockCount');
        const lowStockAlertSetting = await RestaurantDB.getSetting('enableLowStockAlerts');
        const lowStockThresholdSetting = await RestaurantDB.getSetting('lowStockThreshold');
        const timeoutSetting = await RestaurantDB.getSetting('sessionTimeoutMinutes');
        
        if (taxPercentageInput && taxSetting) taxPercentageInput.value = taxSetting.value || '';
        if (serviceChargePercentageInput && serviceSetting) serviceChargePercentageInput.value = serviceSetting.value || '';
        if (discountPercentageInput && discountSetting) discountPercentageInput.value = discountSetting.value || '';
        if (enableStockCountCheckbox && stockCountSetting) enableStockCountCheckbox.checked = stockCountSetting.value === true || stockCountSetting.value === 'true';
        if (enableLowStockAlertsCheckbox && lowStockAlertSetting) enableLowStockAlertsCheckbox.checked = lowStockAlertSetting.value === true || lowStockAlertSetting.value === 'true';
        if (lowStockThresholdInput && lowStockThresholdSetting) lowStockThresholdInput.value = String(lowStockThresholdSetting.value || '');
        if (systemTimeoutInput && timeoutSetting) systemTimeoutInput.value = String(timeoutSetting.value || '');
        refreshSystemSettingsSummary();
      } catch (err) {
        console.error('Failed to load billing settings:', err);
      }
    }

    // Save settings
    if (btnSaveBillingSettings) {
      btnSaveBillingSettings.addEventListener('click', async () => {
        try {
          const taxValue = parseFloat(taxPercentageInput?.value || 0);
          const serviceValue = parseFloat(serviceChargePercentageInput?.value || 0);
          const discountValue = parseFloat(discountPercentageInput?.value || 0);

          // Validate percentages
          if (taxValue < 0 || taxValue > 100) throw new Error('Tax percentage must be between 0 and 100');
          if (serviceValue < 0 || serviceValue > 100) throw new Error('Service charge must be between 0 and 100');
          if (discountValue < 0 || discountValue > 100) throw new Error('Discount must be between 0 and 100');

          await RestaurantDB.setSetting('taxPercentage', taxValue);
          await RestaurantDB.setSetting('serviceChargePercentage', serviceValue);
          await RestaurantDB.setSetting('discountPercentage', discountValue);

          settingsMessage.style.display = 'block';
          settingsMessage.style.background = '#dcfce7';
          settingsMessage.style.color = '#166534';
          settingsMessage.style.border = '1px solid #86efac';
          settingsMessage.textContent = '✓ Billing settings saved successfully';

          setTimeout(() => {
            settingsMessage.style.display = 'none';
          }, 3000);
        } catch (err) {
          settingsMessage.style.display = 'block';
          settingsMessage.style.background = '#fee2e2';
          settingsMessage.style.color = '#991b1b';
          settingsMessage.style.border = '1px solid #fca5a5';
          settingsMessage.textContent = '✗ Error: ' + err.message;
        }
      });
    }

    // Reset to defaults
    if (btnResetBillingSettings) {
      btnResetBillingSettings.addEventListener('click', async () => {
        try {
          if (!confirm('Reset billing settings to 0%?')) return;

          await RestaurantDB.setSetting('taxPercentage', 0);
          await RestaurantDB.setSetting('serviceChargePercentage', 0);
          await RestaurantDB.setSetting('discountPercentage', 0);

          if (taxPercentageInput) taxPercentageInput.value = '0';
          if (serviceChargePercentageInput) serviceChargePercentageInput.value = '0';
          if (discountPercentageInput) discountPercentageInput.value = '0';

          settingsMessage.style.display = 'block';
          settingsMessage.style.background = '#dcfce7';
          settingsMessage.style.color = '#166534';
          settingsMessage.style.border = '1px solid #86efac';
          settingsMessage.textContent = '✓ Settings reset to defaults';

          setTimeout(() => {
            settingsMessage.style.display = 'none';
          }, 3000);
        } catch (err) {
          settingsMessage.style.display = 'block';
          settingsMessage.style.background = '#fee2e2';
          settingsMessage.style.color = '#991b1b';
          settingsMessage.style.border = '1px solid #fca5a5';
          settingsMessage.textContent = '✗ Error: ' + err.message;
        }
      });
    }

    // System settings save
    if (btnSaveSystemSettings) {
      btnSaveSystemSettings.addEventListener('click', async () => {
        try {
          const stockCountEnabled = enableStockCountCheckbox ? enableStockCountCheckbox.checked : false;
          const lowStockAlertsEnabled = enableLowStockAlertsCheckbox ? enableLowStockAlertsCheckbox.checked : false;
          const lowStockThreshold = lowStockThresholdInput ? parseInt(lowStockThresholdInput.value || '0', 10) : 0;
          const timeoutMinutes = systemTimeoutInput ? parseInt(systemTimeoutInput.value || '0', 10) : 0;
          const stockSettingsMessage = document.getElementById('stock-settings-message');

          if (timeoutMinutes <= 0 || timeoutMinutes > 1440) {
            throw new Error('Please enter a valid timeout between 1 and 1440 minutes.');
          }
          if (lowStockAlertsEnabled && lowStockThreshold <= 0) {
            throw new Error('Please enter a valid low-stock threshold greater than 0.');
          }
          
          await RestaurantDB.setSetting('enableStockCount', stockCountEnabled);
          await RestaurantDB.setSetting('enableLowStockAlerts', lowStockAlertsEnabled);
          await RestaurantDB.setSetting('lowStockThreshold', lowStockThreshold);
          await RestaurantDB.setSetting('sessionTimeoutMinutes', timeoutMinutes);
          
          refreshSystemSettingsSummary();
          if (stockSettingsMessage) {
            stockSettingsMessage.style.display = 'block';
            stockSettingsMessage.style.background = '#dcfce7';
            stockSettingsMessage.style.color = '#166534';
            stockSettingsMessage.style.border = '1px solid #86efac';
            stockSettingsMessage.textContent = '✓ System settings saved successfully';
            
            setTimeout(() => {
              stockSettingsMessage.style.display = 'none';
            }, 3000);
          }
        } catch (err) {
          const stockSettingsMessage = document.getElementById('stock-settings-message');
          if (stockSettingsMessage) {
            stockSettingsMessage.style.display = 'block';
            stockSettingsMessage.style.background = '#fee2e2';
            stockSettingsMessage.style.color = '#991b1b';
            stockSettingsMessage.style.border = '1px solid #fca5a5';
            stockSettingsMessage.textContent = '✗ Error: ' + err.message;
          }
        }
      });
    }

    if (btnSaveProfileSettings) {
      btnSaveProfileSettings.addEventListener('click', async () => {
        try {
          const fullName = profileFullName ? String(profileFullName.value || '').trim() : '';
          const username = profileUsername ? String(profileUsername.value || '').trim() : '';
          const currentPassword = profileCurrentPassword ? String(profileCurrentPassword.value || '') : '';
          const newPassword = profileNewPassword ? String(profileNewPassword.value || '') : '';
          const confirmPassword = profileNewPasswordConfirm ? String(profileNewPasswordConfirm.value || '') : '';

          if (!fullName || !username) {
            throw new Error('Please provide your full name and username.');
          }

          const session = Auth.getSession();
          if (!session) {
            throw new Error('Session expired, please log in again.');
          }

          if (newPassword || confirmPassword || currentPassword) {
            if (!currentPassword) {
              throw new Error('Please enter your current password to change password.');
            }
            if (!newPassword) {
              throw new Error('Please enter a new password.');
            }
            if (newPassword.length < 6) {
              throw new Error('New password must be at least 6 characters.');
            }
            if (newPassword !== confirmPassword) {
              throw new Error('New password and confirmation do not match.');
            }
            await Auth.changePassword(currentPassword, newPassword);
          }

          const payload = {
            id: String(session.id),
            username,
            role: session.role || 'admin',
            fullName,
            status: session.status || 'active',
            tables: []
          };
          const response = await fetchBackend('/api/users/update', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (!response || response.success !== true) {
            throw new Error(response?.error || 'Unable to save profile.');
          }

          Auth.updateSession({ username, fullName, status: session.status || 'active' });
          refreshSidebarProfileInfo();
          if (profileCurrentPassword) profileCurrentPassword.value = '';
          if (profileNewPassword) profileNewPassword.value = '';
          if (profileNewPasswordConfirm) profileNewPasswordConfirm.value = '';
          if (profileSettingsMessage) {
            profileSettingsMessage.style.display = 'block';
            profileSettingsMessage.style.background = '#dcfce7';
            profileSettingsMessage.style.color = '#166534';
            profileSettingsMessage.style.border = '1px solid #86efac';
            profileSettingsMessage.textContent = '✓ Profile updated successfully.';
          }
          await loadProfileInfo();
          setTimeout(() => {
            if (profileSettingsMessage) profileSettingsMessage.style.display = 'none';
          }, 3000);
        } catch (err) {
          if (profileSettingsMessage) {
            profileSettingsMessage.style.display = 'block';
            profileSettingsMessage.style.background = '#fee2e2';
            profileSettingsMessage.style.color = '#991b1b';
            profileSettingsMessage.style.border = '1px solid #fca5a5';
            profileSettingsMessage.textContent = '✗ ' + err.message;
          }
        }
      });
    }

    // Business day cutoff setting
    businessDayCutoffInput = document.getElementById('business-day-cutoff');
    btnSaveBusinessDay = document.getElementById('btn-save-business-day');
    btnResetBusinessDay = document.getElementById('btn-reset-business-day');
    businessDaySettingsMessage = document.getElementById('business-day-settings-message');
    if (businessDayCutoffInput) {
      businessDayCutoffInput.value = businessDayCutoff;
    }

    async function loadBusinessDaySetting() {
      try {
        const response = await fetchBackend('/api/settings/business-day');
        if (response && response.success) {
          const value = response.value || '00:00';
          businessDayCutoff = value;
          if (businessDayCutoffInput) {
            businessDayCutoffInput.value = value;
          }
        }
      } catch (err) {
        console.error('Failed to load business day cutoff setting:', err);
      }
    }

    async function saveBusinessDaySetting(value) {
      try {
        const response = await fetchBackend('/api/settings/business-day', {
          method: 'POST',
          body: JSON.stringify({ cutoff: value })
        });
        if (response && response.success) {
          return response.value;
        }
        throw new Error(response.error || 'save_failed');
      } catch (err) {
        throw err;
      }
    }

    async function loadReceiptSettings() {
      try {
        const response = await fetchBackend('/api/settings/receipt-details');
        if (response && response.success) {
          const config = response.config || {};
          receiptSettings = {
            businessName: String(config.businessName || '').trim(),
            address: String(config.address || '').trim(),
            phone: String(config.phone || '').trim(),
            email: String(config.email || '').trim(),
            footerMessage: String(config.footerMessage || '').trim()
          };
          if (receiptBusinessNameInput) receiptBusinessNameInput.value = receiptSettings.businessName;
          if (receiptAddressInput) receiptAddressInput.value = receiptSettings.address;
          if (receiptPhoneInput) receiptPhoneInput.value = receiptSettings.phone;
          if (receiptEmailInput) receiptEmailInput.value = receiptSettings.email;
          if (receiptFooterMessageInput) receiptFooterMessageInput.value = receiptSettings.footerMessage;
        }
      } catch (err) {
        console.warn('Failed to load receipt settings:', err);
      }
    }

    async function saveReceiptSettings(payload) {
      try {
        const response = await fetchBackend('/api/settings/receipt-details', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (response && response.success) {
          return response.config;
        }
        throw new Error(response.error || 'save_failed');
      } catch (err) {
        throw err;
      }
    }

    if (btnSaveBusinessDay) {
      btnSaveBusinessDay.addEventListener('click', async () => {
        try {
          const value = businessDayCutoffInput?.value || '00:00';
          const saved = await saveBusinessDaySetting(value);
          businessDayCutoff = saved;
          if (businessDayCutoffInput) {
            businessDayCutoffInput.value = saved;
          }
          scheduleBusinessDayRefresh();
          await updateOperationalSnapshotCounts();
          if (businessDaySettingsMessage) {
            businessDaySettingsMessage.style.display = 'block';
            businessDaySettingsMessage.style.background = '#dcfce7';
            businessDaySettingsMessage.style.color = '#166534';
            businessDaySettingsMessage.style.border = '1px solid #86efac';
            businessDaySettingsMessage.textContent = `✓ Business day cutoff set to ${saved}`;
          }
        } catch (err) {
          if (businessDaySettingsMessage) {
            businessDaySettingsMessage.style.display = 'block';
            businessDaySettingsMessage.style.background = '#fee2e2';
            businessDaySettingsMessage.style.color = '#991b1b';
            businessDaySettingsMessage.style.border = '1px solid #fca5a5';
            businessDaySettingsMessage.textContent = '✗ Error: ' + err.message;
          }
        } finally {
          if (businessDaySettingsMessage) {
            setTimeout(() => { businessDaySettingsMessage.style.display = 'none'; }, 3000);
          }
        }
      });
    }

    if (btnResetBusinessDay) {
      btnResetBusinessDay.addEventListener('click', async () => {
        try {
          const saved = await saveBusinessDaySetting('00:00');
          businessDayCutoff = saved;
          if (businessDayCutoffInput) businessDayCutoffInput.value = saved;
          scheduleBusinessDayRefresh();
          await updateOperationalSnapshotCounts();
          if (businessDaySettingsMessage) {
            businessDaySettingsMessage.style.display = 'block';
            businessDaySettingsMessage.style.background = '#dcfce7';
            businessDaySettingsMessage.style.color = '#166534';
            businessDaySettingsMessage.style.border = '1px solid #86efac';
            businessDaySettingsMessage.textContent = '✓ Business day cutoff reset to 00:00';
          }
        } catch (err) {
          if (businessDaySettingsMessage) {
            businessDaySettingsMessage.style.display = 'block';
            businessDaySettingsMessage.style.background = '#fee2e2';
            businessDaySettingsMessage.style.color = '#991b1b';
            businessDaySettingsMessage.style.border = '1px solid #fca5a5';
            businessDaySettingsMessage.textContent = '✗ Error: ' + err.message;
          }
        } finally {
          if (businessDaySettingsMessage) {
            setTimeout(() => { businessDaySettingsMessage.style.display = 'none'; }, 3000);
          }
        }
      });
    }

    receiptBusinessNameInput = document.getElementById('receipt-business-name');
    receiptAddressInput = document.getElementById('receipt-address');
    receiptPhoneInput = document.getElementById('receipt-phone');
    receiptEmailInput = document.getElementById('receipt-email');
    receiptFooterMessageInput = document.getElementById('receipt-footer-message');
    btnSaveReceiptSettings = document.getElementById('btn-save-receipt-settings');
    receiptSettingsMessage = document.getElementById('receipt-settings-message');
    loadReceiptSettings().catch(err => console.error('Failed to load receipt settings after DOM init:', err));

    if (btnSaveReceiptSettings) {
      btnSaveReceiptSettings.addEventListener('click', async () => {
        try {
          const payload = {
            businessName: receiptBusinessNameInput?.value || '',
            address: receiptAddressInput?.value || '',
            phone: receiptPhoneInput?.value || '',
            email: receiptEmailInput?.value || '',
            footerMessage: receiptFooterMessageInput?.value || ''
          };
          const savedConfig = await saveReceiptSettings(payload);
          receiptSettings = {
            businessName: String(savedConfig.businessName || '').trim(),
            address: String(savedConfig.address || '').trim(),
            phone: String(savedConfig.phone || '').trim(),
            email: String(savedConfig.email || '').trim(),
            footerMessage: String(savedConfig.footerMessage || '').trim()
          };
          if (receiptSettingsMessage) {
            receiptSettingsMessage.style.display = 'block';
            receiptSettingsMessage.style.background = '#dcfce7';
            receiptSettingsMessage.style.color = '#166534';
            receiptSettingsMessage.style.border = '1px solid #86efac';
            receiptSettingsMessage.textContent = '✓ Receipt details saved successfully';
          }
        } catch (err) {
          if (receiptSettingsMessage) {
            receiptSettingsMessage.style.display = 'block';
            receiptSettingsMessage.style.background = '#fee2e2';
            receiptSettingsMessage.style.color = '#991b1b';
            receiptSettingsMessage.style.border = '1px solid #fca5a5';
            receiptSettingsMessage.textContent = '✗ Error: ' + err.message;
          }
        } finally {
          if (receiptSettingsMessage) {
            setTimeout(() => { receiptSettingsMessage.style.display = 'none'; }, 3000);
          }
        }
      });
    }

    // ==========================================
    // Voided Items Report Functionality
    // ==========================================
    const btnRefreshVoidedReport = document.getElementById('btn-refresh-voided-report');
    const voidedSearchInput = document.getElementById('voided-search');
    const voidedItemsTbody = document.getElementById('voided-items-tbody');
    const voidedTotalValue = document.getElementById('voided-total-value');
    const voidedTotalItems = document.getElementById('voided-total-items');

    async function getOrdersForReports() {
      try {
        const response = await fetchBackend('/api/orders/all');
        const orders = Array.isArray(response?.orders) ? response.orders : [];
        if (orders.length) {
          return orders;
        }
      } catch (err) {
        console.warn('Falling back to local orders for reports:', err);
      }

      try {
        const localOrders = await RestaurantDB.getAllOrders();
        return Array.isArray(localOrders) ? localOrders : [];
      } catch (err) {
        console.warn('Could not load orders for reports:', err);
        return [];
      }
    }

    async function getProductsForReports() {
      try {
        const response = await fetchBackend('/api/products');
        const products = Array.isArray(response?.products) ? response.products : [];
        if (products.length) {
          return products;
        }
      } catch (err) {
        console.warn('Could not load products for reports from backend, falling back to local data:', err);
      }

      try {
        const products = await RestaurantDB.getAllProducts();
        return Array.isArray(products) ? products : [];
      } catch (err) {
        console.warn('Could not load products for reports:', err);
        return [];
      }
    }

    async function getCategoriesForReports() {
      try {
        const response = await fetchBackend('/api/categories');
        const categories = Array.isArray(response?.categories) ? response.categories : [];
        if (categories.length) {
          return categories;
        }
      } catch (err) {
        console.warn('Could not load categories for reports from backend, falling back to local data:', err);
      }

      try {
        const categories = await RestaurantDB.getAllCategories();
        return Array.isArray(categories) ? categories : [];
      } catch (err) {
        console.warn('Could not load categories for reports:', err);
        return [];
      }
    }

    async function getSubcategoriesForReports() {
      try {
        const response = await fetchBackend('/api/subcategories');
        const subcategories = Array.isArray(response?.subcategories) ? response.subcategories : [];
        if (subcategories.length) {
          return subcategories;
        }
      } catch (err) {
        console.warn('Could not load subcategories for reports from backend, falling back to local data:', err);
      }

      try {
        const subcategories = await RestaurantDB.getAllSubcategories();
        return Array.isArray(subcategories) ? subcategories : [];
      } catch (err) {
        console.warn('Could not load subcategories for reports:', err);
        return [];
      }
    }

    function getOrderStatusForReports(order) {
      return String(order?.status || order?.orderData?.status || order?.currentStatus || 'pending').trim().toLowerCase();
    }

    function shouldIncludeOrderInReports(order) {
      const status = getOrderStatusForReports(order);
      return !['pending', 'cancelled', 'canceled', 'voided', 'draft'].includes(status);
    }

    function getItemProductName(item) {
      return String(item?.productName || item?.name || item?.product?.name || item?.productName || 'Unknown').trim();
    }

    function getItemQuantity(item) {
      return Number(item?.quantity ?? item?.qty ?? 0) || 0;
    }

    function getItemPrice(item, productPriceMap = {}) {
      const productName = getItemProductName(item).toLowerCase();
      if (productPriceMap[productName] != null) {
        return Number(productPriceMap[productName]) || 0;
      }
      const explicitPrice = Number(item?.unitPrice ?? item?.price ?? item?.product?.price ?? 0) || 0;
      return explicitPrice;
    }

    function getItemCategoryInfo(item, productDetailsMap = {}, categoryNameMap = {}, subcategoryDetailsMap = {}) {
      const explicitCategory = String(item?.categoryName || item?.category || item?.category_name || item?.product?.categoryName || item?.product?.category || '').trim();
      const explicitSubcategory = String(item?.subcategoryName || item?.subcategory || item?.subcategory_name || item?.product?.subcategoryName || item?.product?.subcategory || '').trim();
      const product = item?.product || item?.productDetails || null;
      const productName = getItemProductName(item).trim().toLowerCase();
      const productId = String(item?.productId ?? item?.product_id ?? product?.id ?? item?.id ?? '').trim();

      let category = explicitCategory || '';
      let subcategory = explicitSubcategory || '';

      if (!category) {
        const categoryId = item?.cat ?? product?.cat ?? item?.categoryId ?? item?.category_id ?? product?.categoryId ?? null;
        if (categoryId != null && categoryId !== '' && categoryNameMap[String(categoryId)]) {
          category = categoryNameMap[String(categoryId)];
        }
      }

      if (!subcategory) {
        const subcategoryId = item?.sub ?? product?.sub ?? item?.subcategoryId ?? item?.subcategory_id ?? product?.subcategoryId ?? null;
        const subcategoryDetails = subcategoryDetailsMap[String(subcategoryId)] || null;
        if (subcategoryDetails?.name) {
          subcategory = subcategoryDetails.name;
          if (!category && subcategoryDetails.parentCategoryName) {
            category = subcategoryDetails.parentCategoryName;
          }
        }
      }

      const details = productDetailsMap[productName] || productDetailsMap[productId] || productDetailsMap[String(product?.name)] || productDetailsMap[String(product?.name).toLowerCase()] || {};
      if (!category && details.category) {
        category = details.category;
      }
      if (!subcategory && details.subcategory) {
        subcategory = details.subcategory;
      }

      if (!category && details.parentCategoryName) {
        category = details.parentCategoryName;
      }

      return {
        category: category || 'Uncategorized',
        subcategory: subcategory || 'Uncategorized'
      };
    }

    function getOrderTableName(order) {
      return String(order?.tableName || order?.table || order?.orderData?.tableName || order?.order_data?.tableName || 'N/A').trim() || 'N/A';
    }

    function getOrderIdValue(order) {
      return String(order?.id || order?.orderId || order?.orderData?.id || order?.order_data?.id || 'N/A');
    }

    async function loadVoidedItemsReport() {
      try {
        const orders = await getOrdersForReports();
        const searchTerm = (voidedSearchInput?.value || '').toLowerCase();
        
        let allVoidedItems = [];
        let totalVoidedValue = 0;
        let totalVoidedCount = 0;
        
        orders.forEach(order => {
          if (!shouldIncludeOrderInReports(order)) return;
          if (!Array.isArray(order?.voidedItems) || order.voidedItems.length === 0) return;
          
          order.voidedItems.forEach(voidedItem => {
            const productName = String(voidedItem?.productName || voidedItem?.name || 'Unknown').trim();
            const quantity = Number(voidedItem?.quantity ?? voidedItem?.qty ?? 0) || 0;
            const unitPrice = Number(voidedItem?.unitPrice ?? voidedItem?.price ?? 0) || 0;
            const itemValue = unitPrice * quantity;
            const tableName = getOrderTableName(order);
            const orderId = getOrderIdValue(order);

            const searchMatch = !searchTerm ||
              String(tableName).toLowerCase().includes(searchTerm) ||
              String(orderId).toLowerCase().includes(searchTerm) ||
              productName.toLowerCase().includes(searchTerm);
            
            if (!searchMatch) return;
            
            allVoidedItems.push({
              orderCreatedAt: order.createdAt || order.updatedAt || new Date().toISOString(),
              orderId,
              tableName,
              productName,
              quantity,
              unitPrice,
              totalValue: itemValue
            });
            
            totalVoidedValue += itemValue;
            totalVoidedCount += quantity;
          });
        });
        
        // Sort by date (newest first)
        allVoidedItems.sort((a, b) => new Date(b.orderCreatedAt) - new Date(a.orderCreatedAt));
        
        // Render table
        if (allVoidedItems.length === 0) {
          voidedItemsTbody.innerHTML = '<tr><td colspan="7" style="padding: 20px; text-align: center; color: #9ca3af;">No voided items found</td></tr>';
        } else {
          voidedItemsTbody.innerHTML = allVoidedItems.map((item, idx) => {
            const dateStr = new Date(item.orderCreatedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            
            return `
              <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
                <td style="padding: 12px; font-size: 0.9rem;">${dateStr}</td>
                <td style="padding: 12px; font-size: 0.9rem; font-family: monospace;">${String(item.orderId).substring(0, 8)}...</td>
                <td style="padding: 12px; font-size: 0.9rem;">${item.tableName}</td>
                <td style="padding: 12px; font-size: 0.9rem;">${item.productName}</td>
                <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${item.quantity}</td>
                <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${formatCurrency(item.unitPrice)}</td>
                <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formatCurrency(item.totalValue)}</td>
              </tr>
            `;
          }).join('');
        }
        
        // Update totals
        if (voidedTotalValue) {
          voidedTotalValue.textContent = '₦' + formatCurrency(totalVoidedValue);
        }
        if (voidedTotalItems) {
          voidedTotalItems.textContent = totalVoidedCount;
        }
      } catch (err) {
        console.error('Error loading voided items report:', err);
        voidedItemsTbody.innerHTML = '<tr><td colspan="7" style="padding: 20px; text-align: center; color: #ef4444;">Error loading report: ' + err.message + '</td></tr>';
      }
    }
    
    // Refresh button
    if (btnRefreshVoidedReport) {
      btnRefreshVoidedReport.addEventListener('click', loadVoidedItemsReport);
    }
    
    // Search input
    if (voidedSearchInput) {
      voidedSearchInput.addEventListener('input', loadVoidedItemsReport);
    }

    // **ITEMS SUMMARY REPORT**
    const itemsSummaryTbody = document.getElementById('items-summary-tbody');
    const itemsSummarySearch = document.getElementById('items-summary-search');
    const btnRefreshItemsSummary = document.getElementById('btn-refresh-items-summary');

    // Helper function to get product price by name
    async function getProductPriceByName(productName) {
      try {
        const allProducts = await RestaurantDB.getAllProducts();
        const product = allProducts.find(p => p.name && p.name.toLowerCase() === productName.toLowerCase());
        return product ? (product.price || 0) : 0;
      } catch (error) {
        console.error('Error fetching product price:', error);
        return 0;
      }
    }

    // Helper function to get all products with prices
    async function getAllProductsWithPrices() {
      try {
        return await RestaurantDB.getAllProducts();
      } catch (error) {
        console.error('Error fetching products:', error);
        return [];
      }
    }

    async function loadItemsSummaryReport() {
      try {
        const allOrders = await getOrdersForReports();
        const allProducts = await getProductsForReports();
        
        const productPriceMap = {};
        allProducts.forEach(product => {
          if (product.name) {
            productPriceMap[String(product.name).toLowerCase()] = Number(product.price || 0);
          }
        });
        
        const itemsSummary = {};
        
        allOrders.forEach(order => {
          if (!shouldIncludeOrderInReports(order)) return;
          if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
              const productName = getItemProductName(item);
              const quantity = getItemQuantity(item);
              const unitPrice = getItemPrice(item, productPriceMap);
              
              if (!itemsSummary[productName]) {
                itemsSummary[productName] = {
                  productName,
                  unitPrice,
                  totalQuantity: 0
                };
              }
              
              itemsSummary[productName].totalQuantity += quantity;
              itemsSummary[productName].unitPrice = unitPrice;
            });
          }
        });
        
        // Convert to array, calculate total value, and sort by total value (descending)
        let summaryArray = Object.values(itemsSummary).map(item => ({
          ...item,
          totalValue: item.unitPrice * item.totalQuantity
        })).sort((a, b) => b.totalValue - a.totalValue);
        
        // Apply search filter if provided
        const searchTerm = (itemsSummarySearch?.value || '').toLowerCase();
        if (searchTerm) {
          summaryArray = summaryArray.filter(item => 
            item.productName.toLowerCase().includes(searchTerm)
          );
        }
        
        // Calculate grand totals
        const grandTotalQuantity = summaryArray.reduce((sum, item) => sum + item.totalQuantity, 0);
        const grandTotalValue = summaryArray.reduce((sum, item) => sum + item.totalValue, 0);
        
        // Render table
        itemsSummaryTbody.innerHTML = summaryArray.map((item, idx) => {
          const formattedUnitPrice = (item.unitPrice || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const formattedTotalValue = (item.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return `
          <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
            <td style="padding: 12px; font-size: 0.9rem;">${item.productName}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 500;">₦${formattedUnitPrice}</td>
            <td style="padding: 12px; text-align: center; font-size: 0.9rem; font-weight: 500;">${item.totalQuantity}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formattedTotalValue}</td>
          </tr>
        `;
        }).join('') + `
          <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
            <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem;">-</td>
            <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${grandTotalQuantity}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${(grandTotalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        `;
      } catch (error) {
        console.error('Error loading items summary report:', error);
        itemsSummaryTbody.innerHTML = '<tr><td colspan="4" style="padding: 12px; text-align: center; color: #ef4444;">Error loading report</td></tr>';
      }
    }

    if (btnRefreshItemsSummary) {
      btnRefreshItemsSummary.addEventListener('click', loadItemsSummaryReport);
    }
    
    if (itemsSummarySearch) {
      itemsSummarySearch.addEventListener('input', loadItemsSummaryReport);
    }

    // **CATEGORY SUMMARY REPORT**
    const categorySummaryTbody = document.getElementById('category-summary-tbody');
    const categorySummarySearch = document.getElementById('category-summary-search');
    const btnRefreshCategorySummary = document.getElementById('btn-refresh-category-summary');

    async function loadCategorySummaryReport() {
      try {
        const allOrders = await getOrdersForReports();
        const allProducts = await getProductsForReports();
        
        const allCategories = await getCategoriesForReports();
        const categoryNameMap = Object.fromEntries((allCategories || []).map(category => [String(category.id), category.name || 'Uncategorized']));
        
        const allSubcategories = await getSubcategoriesForReports();
        const subcategoryDetailsMap = Object.fromEntries((allSubcategories || []).map(subcategory => [
          String(subcategory.id),
          {
            name: subcategory.name || 'Uncategorized',
            parentCategoryName: categoryNameMap[String(subcategory.parent ?? subcategory.parent_category_id ?? '')] || ''
          }
        ]));
        
        const productDetailsMap = {};
        allProducts.forEach(product => {
          if (!product) return;
          const categoryName = categoryNameMap[String(product.cat ?? product.categoryId ?? product.category_id)] || String(product.categoryName || product.category || '').trim() || 'Uncategorized';
          const subcategoryName = subcategoryDetailsMap[String(product.sub ?? product.subcategoryId ?? product.subcategory_id)]?.name || String(product.subcategoryName || product.subcategory || '').trim() || 'Uncategorized';
          const details = {
            price: product.price || 0,
            category: categoryName,
            subcategory: subcategoryName,
            parentCategoryName: categoryName
          };
          if (product.name) {
            productDetailsMap[String(product.name).toLowerCase()] = details;
            productDetailsMap[String(product.name)] = details;
          }
          if (product.id != null) {
            productDetailsMap[String(product.id)] = details;
          }
        });
        
        const categorySummary = {};
        
        allOrders.forEach(order => {
          if (!shouldIncludeOrderInReports(order)) return;
          if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
              const quantity = getItemQuantity(item);
              const categoryInfo = getItemCategoryInfo(item, productDetailsMap, categoryNameMap, subcategoryDetailsMap);
              const unitPrice = getItemPrice(item, Object.fromEntries(allProducts.map(product => [String(product.name).toLowerCase(), Number(product.price || 0)])));
              const itemTotal = quantity * unitPrice;
              const category = categoryInfo.category || 'Uncategorized';
              
              if (!categorySummary[category]) {
                categorySummary[category] = {
                  category,
                  itemCount: 0,
                  totalQuantity: 0,
                  totalValue: 0
                };
              }
              
              categorySummary[category].itemCount += 1;
              categorySummary[category].totalQuantity += quantity;
              categorySummary[category].totalValue += itemTotal;
            });
          }
        });
        
        // Convert to array and sort by total value (descending)
        let summaryArray = Object.values(categorySummary).sort((a, b) => b.totalValue - a.totalValue);
        
        // Apply search filter if provided
        const searchTerm = (categorySummarySearch?.value || '').toLowerCase();
        if (searchTerm) {
          summaryArray = summaryArray.filter(item => 
            item.category.toLowerCase().includes(searchTerm)
          );
        }
        
        // Calculate grand totals
        const grandTotalItems = summaryArray.reduce((sum, item) => sum + item.itemCount, 0);
        const grandTotalQuantity = summaryArray.reduce((sum, item) => sum + item.totalQuantity, 0);
        const grandTotalValue = summaryArray.reduce((sum, item) => sum + item.totalValue, 0);
        
        // Render table
        categorySummaryTbody.innerHTML = summaryArray.map((item, idx) => `
          <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
            <td style="padding: 12px; font-size: 0.9rem; font-weight: 600;">${item.category}</td>
            <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${item.itemCount}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formatCurrency(item.totalValue)}</td>
          </tr>
        `).join('') + `
          <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
            <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
            <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${grandTotalItems}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${formatCurrency(grandTotalValue)}</td>
          </tr>
        `;
      } catch (error) {
        console.error('Error loading category summary report:', error);
        categorySummaryTbody.innerHTML = '<tr><td colspan="4" style="padding: 12px; text-align: center; color: #ef4444;">Error loading report</td></tr>';
      }
    }

    if (btnRefreshCategorySummary) {
      btnRefreshCategorySummary.addEventListener('click', loadCategorySummaryReport);
    }
    
    if (categorySummarySearch) {
      categorySummarySearch.addEventListener('input', loadCategorySummaryReport);
    }

    // **SUBCATEGORY SUMMARY REPORT**
    const subcategorySummaryTbody = document.getElementById('subcategory-summary-tbody');
    const subcategorySummarySearch = document.getElementById('subcategory-summary-search');
    const btnRefreshSubcategorySummary = document.getElementById('btn-refresh-subcategory-summary');

    async function loadSubcategorySummaryReport() {
      try {
        const allOrders = await getOrdersForReports();
        const allProducts = await getProductsForReports();
        
        const allCategories = await getCategoriesForReports();
        const categoryNameMap = Object.fromEntries((allCategories || []).map(category => [String(category.id), category.name || 'Uncategorized']));

        const allSubcategories = await getSubcategoriesForReports();
        const subcategoryDetailsMap = Object.fromEntries((allSubcategories || []).map(subcategory => [
          String(subcategory.id),
          {
            name: subcategory.name || 'Uncategorized',
            parentCategoryName: categoryNameMap[String(subcategory.parent ?? subcategory.parent_category_id ?? '')] || ''
          }
        ]));
        
        const productDetailsMap = {};
        allProducts.forEach(product => {
          if (!product) return;
          const subcategoryName = subcategoryDetailsMap[String(product.sub ?? product.subcategoryId ?? product.subcategory_id)]?.name || String(product.subcategoryName || product.subcategory || '').trim() || 'Uncategorized';
          const categoryName = categoryNameMap[String(product.cat ?? product.categoryId ?? product.category_id)] || String(product.categoryName || product.category || '').trim() || 'Uncategorized';
          const details = {
            price: product.price || 0,
            category: categoryName,
            subcategory: subcategoryName,
            parentCategoryName: categoryName
          };
          if (product.name) {
            productDetailsMap[String(product.name).toLowerCase()] = details;
            productDetailsMap[String(product.name)] = details;
          }
          if (product.id != null) {
            productDetailsMap[String(product.id)] = details;
          }
        });
        
        const subcategorySummary = {};
        
        allOrders.forEach(order => {
          if (!shouldIncludeOrderInReports(order)) return;
          if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
              const quantity = getItemQuantity(item);
              const categoryInfo = getItemCategoryInfo(item, productDetailsMap, categoryNameMap, subcategoryDetailsMap);
              const unitPrice = getItemPrice(item, Object.fromEntries(allProducts.map(product => [String(product.name).toLowerCase(), Number(product.price || 0)])));
              const itemTotal = quantity * unitPrice;
              const subcategory = categoryInfo.subcategory || 'Uncategorized';
              
              if (!subcategorySummary[subcategory]) {
                subcategorySummary[subcategory] = {
                  subcategory,
                  itemCount: 0,
                  totalQuantity: 0,
                  totalValue: 0
                };
              }
              
              subcategorySummary[subcategory].itemCount += 1;
              subcategorySummary[subcategory].totalQuantity += quantity;
              subcategorySummary[subcategory].totalValue += itemTotal;
            });
          }
        });
        
        // Convert to array and sort by total value (descending)
        let summaryArray = Object.values(subcategorySummary).sort((a, b) => b.totalValue - a.totalValue);
        
        // Apply search filter if provided
        const searchTerm = (subcategorySummarySearch?.value || '').toLowerCase();
        if (searchTerm) {
          summaryArray = summaryArray.filter(item => 
            item.subcategory.toLowerCase().includes(searchTerm)
          );
        }
        
        // Calculate grand totals
        const grandTotalItems = summaryArray.reduce((sum, item) => sum + item.itemCount, 0);
        const grandTotalQuantity = summaryArray.reduce((sum, item) => sum + item.totalQuantity, 0);
        const grandTotalValue = summaryArray.reduce((sum, item) => sum + item.totalValue, 0);
        
        // Render table
        subcategorySummaryTbody.innerHTML = summaryArray.map((item, idx) => `
          <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
            <td style="padding: 12px; font-size: 0.9rem; font-weight: 600;">${item.subcategory}</td>
            <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${item.itemCount}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formatCurrency(item.totalValue)}</td>
          </tr>
        `).join('') + `
          <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
            <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
            <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${grandTotalItems}</td>
            <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${formatCurrency(grandTotalValue)}</td>
          </tr>
        `;
      } catch (error) {
        console.error('Error loading subcategory summary report:', error);
        subcategorySummaryTbody.innerHTML = '<tr><td colspan="4" style="padding: 12px; text-align: center; color: #ef4444;">Error loading report</td></tr>';
      }
    }

    if (btnRefreshSubcategorySummary) {
      btnRefreshSubcategorySummary.addEventListener('click', loadSubcategorySummaryReport);
    }
    
    if (subcategorySummarySearch) {
      subcategorySummarySearch.addEventListener('input', loadSubcategorySummaryReport);
    }

    // **TRANSACTION HISTORY**
    const transactionHistoryTbody = document.getElementById('transaction-history-tbody');
    const transactionHistorySearch = document.getElementById('transaction-history-search');
    const btnRefreshTransactionHistory = document.getElementById('btn-refresh-transaction-history');
    const btnEndOfDayReport = document.getElementById('btn-end-of-day-report');
    const transactionHistoryPageInfo = document.getElementById('transaction-history-page-info');
    const transactionHistoryPagePrev = document.getElementById('transaction-history-page-prev');
    const transactionHistoryPageNext = document.getElementById('transaction-history-page-next');
    const TRANSACTION_HISTORY_PAGE_SIZE = 10;
    let transactionHistoryPage = 1;

    async function loadTransactionHistory() {
      try {
        const response = await fetchBackend('/api/orders/all');
        const allOrders = response.orders || [];
        
        // Map through all orders to create transaction records
        let transactions = allOrders.map(order => {
          // Extract table number (just the number part)
          let tableNumber = 'N/A';
          if (order.tableName) {
            const match = order.tableName.match(/\d+/);
            tableNumber = match ? match[0] : order.tableName;
          }
          
          // Build reference details
          let refDetails = '';
          if (order.splitReference) {
            refDetails = `Split: ${order.splitReference}`;
          } else if (order.joinedTables && order.joinedTables.length > 0) {
            refDetails = `Joined: ${order.joinedTables.join(', ')}`;
          } else {
            refDetails = 'N/A';
          }
          
          const paymentMethodDisplay = getOrderPaymentMethod(order);
          
          // Format date for display (e.g., "Jan 15, 10:30 AM")
          const date = new Date(order.createdAt || new Date().toISOString());
          const dateStr = date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
          });
          const timeStr = date.toLocaleTimeString('en-US', { 
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          const displayDate = `${dateStr} ${timeStr}`;
          
          return {
            id: order.id,
            createdAt: order.createdAt || new Date().toISOString(),
            date: displayDate,
            tableNumber: tableNumber,
            itemCount: (order.items || []).length,
            waiter: order.waiterName || 'N/A',
            cashier: order.cashierName || order.createdBy || 'N/A',
            total: (order.items || []).reduce((sum, item) => sum + ((item.quantity || 0) * (item.unitPrice || 0)), 0),
            paymentMethod: paymentMethodDisplay,
            ref: refDetails,
            status: order.status || 'pending'
          };
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply search filter if provided
        const searchTerm = (transactionHistorySearch?.value || '').toLowerCase();
        if (searchTerm) {
          transactions = transactions.filter(t => 
            String(t.date).toLowerCase().includes(searchTerm) ||
            String(t.tableNumber).toLowerCase().includes(searchTerm) ||
            String(t.waiter).toLowerCase().includes(searchTerm) ||
            t.status.toLowerCase().includes(searchTerm)
          );
        }

        const totalPages = Math.max(1, Math.ceil(transactions.length / TRANSACTION_HISTORY_PAGE_SIZE));
        if (transactionHistoryPage > totalPages) transactionHistoryPage = totalPages;
        const startIndex = (transactionHistoryPage - 1) * TRANSACTION_HISTORY_PAGE_SIZE;
        const pageTransactions = transactions.slice(startIndex, startIndex + TRANSACTION_HISTORY_PAGE_SIZE);

        if (transactionHistoryPageInfo) {
          transactionHistoryPageInfo.textContent = `Page ${transactionHistoryPage} of ${totalPages}`;
        }
        if (transactionHistoryPagePrev) {
          transactionHistoryPagePrev.disabled = transactionHistoryPage <= 1;
          transactionHistoryPagePrev.style.opacity = transactionHistoryPage <= 1 ? '0.6' : '1';
        }
        if (transactionHistoryPageNext) {
          transactionHistoryPageNext.disabled = transactionHistoryPage >= totalPages;
          transactionHistoryPageNext.style.opacity = transactionHistoryPage >= totalPages ? '0.6' : '1';
        }

        // Render table with new column order: Date, Table Number, Items, Waiter, Cashier, Total, Payment Method, Ref, Status
        transactionHistoryTbody.innerHTML = pageTransactions.length === 0 
          ? '<tr><td colspan="9" style="padding: 20px; text-align: center; color: #9ca3af;">No transactions found</td></tr>'
          : pageTransactions.map((tx, idx) => {
            const statusColor = tx.status === 'completed' ? '#10b981' : tx.status === 'sent' ? '#3b82f6' : '#ef4444';
            return `
            <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
              <td style="padding: 12px; font-size: 0.9rem; font-weight: 500;">${tx.date}</td>
              <td style="padding: 12px; font-size: 0.9rem;">${tx.tableNumber}</td>
              <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${tx.itemCount}</td>
              <td style="padding: 12px; font-size: 0.9rem;">${tx.waiter}</td>
              <td style="padding: 12px; font-size: 0.9rem;">${tx.cashier}</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 500;">₦${formatCurrency(tx.total)}</td>
              <td style="padding: 12px; font-size: 0.9rem;">${tx.paymentMethod && tx.paymentMethod !== 'N/A' ? `<span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:0.8rem;font-weight:600;">${tx.paymentMethod}</span>` : '<span style="color:#6b7280;">N/A</span>'}</td>
              <td style="padding: 12px; font-size: 0.9rem;">${tx.ref}</td>
              <td style="padding: 12px; text-align: center;"><span style="display: inline-block; padding: 4px 8px; border-radius: 4px; background: ${statusColor}; color: white; font-size: 0.8rem; font-weight: 500;">${tx.status}</span></td>
            </tr>
            `;
          }).join('');
      } catch (error) {
        console.error('Error loading transaction history:', error);
        transactionHistoryTbody.innerHTML = '<tr><td colspan="9" style="padding: 12px; text-align: center; color: #ef4444;">Error loading transactions</td></tr>';
      }
    }

    if (btnRefreshTransactionHistory) {
      btnRefreshTransactionHistory.addEventListener('click', () => {
        transactionHistoryPage = 1;
        loadTransactionHistory();
      });
    }
    
    if (transactionHistorySearch) {
      transactionHistorySearch.addEventListener('input', () => {
        transactionHistoryPage = 1;
        loadTransactionHistory();
      });
    }

    if (transactionHistoryPagePrev) {
      transactionHistoryPagePrev.addEventListener('click', () => {
        if (transactionHistoryPage > 1) {
          transactionHistoryPage -= 1;
          loadTransactionHistory();
        }
      });
    }

    if (transactionHistoryPageNext) {
      transactionHistoryPageNext.addEventListener('click', () => {
        transactionHistoryPage += 1;
        loadTransactionHistory();
      });
    }





    // **DISPLAY CONSOLIDATED DATA IN REPORT TABLES**
    async function displayConsolidatedDataInTables(consolidatedData) {
      try {
        // Display Items Summary
        const itemsArray = Object.entries(consolidatedData.items).map(([product, data]) => ({
          productName: product,
          totalQuantity: data.qty,
          totalValue: data.amount
        })).sort((a, b) => b.totalValue - a.totalValue);

        const itemsTotalQty = itemsArray.reduce((sum, item) => sum + item.totalQuantity, 0);
        const itemsTotalValue = itemsArray.reduce((sum, item) => sum + item.totalValue, 0);

        if (itemsSummaryTbody) {
          itemsSummaryTbody.innerHTML = itemsArray.map((item, idx) => {
            const formattedTotalValue = (item.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return `
            <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
              <td style="padding: 12px; font-size: 0.9rem;">${item.productName}</td>
              <td style="padding: 12px; text-align: center; font-size: 0.9rem; font-weight: 500;">${item.totalQuantity}</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formattedTotalValue}</td>
            </tr>
          `;
          }).join('') + `
            <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
              <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
              <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${itemsTotalQty}</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${(itemsTotalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          `;
        }

        // Display Category Summary
        const categoriesArray = Object.entries(consolidatedData.categories).map(([category, total]) => ({
          categoryName: category,
          totalValue: total
        })).sort((a, b) => b.totalValue - a.totalValue);

        const categoriesTotalValue = categoriesArray.reduce((sum, cat) => sum + cat.totalValue, 0);

        if (categorySummaryTbody) {
          categorySummaryTbody.innerHTML = categoriesArray.map((category, idx) => {
            const formattedTotal = (category.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return `
            <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
              <td style="padding: 12px; font-size: 0.9rem;">${category.categoryName}</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formattedTotal}</td>
            </tr>
          `;
          }).join('') + `
            <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
              <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${(categoriesTotalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          `;
        }

        // Display Subcategory Summary
        const subcategoriesArray = Object.entries(consolidatedData.subcategories).map(([subcategory, total]) => ({
          subcategoryName: subcategory,
          totalValue: total
        })).sort((a, b) => b.totalValue - a.totalValue);

        const subcategoriesTotalValue = subcategoriesArray.reduce((sum, subcat) => sum + subcat.totalValue, 0);

        if (subcategorySummaryTbody) {
          subcategorySummaryTbody.innerHTML = subcategoriesArray.map((subcategory, idx) => {
            const formattedTotal = (subcategory.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return `
            <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
              <td style="padding: 12px; font-size: 0.9rem;">${subcategory.subcategoryName}</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formattedTotal}</td>
            </tr>
          `;
          }).join('') + `
            <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
              <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
              <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${(subcategoriesTotalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          `;
        }

        // Display Voided Items
        if (consolidatedData.voidedItems && consolidatedData.voidedItems.length > 0) {
          const voidedArray = consolidatedData.voidedItems.sort((a, b) => new Date(b.voidedAt || 0) - new Date(a.voidedAt || 0));
          
          let voidedQtyTotal = 0;
          let voidedValueTotal = 0;

          if (voidedItemsTbody) {
            voidedItemsTbody.innerHTML = voidedArray.map((item, idx) => {
              const formattedValue = (item.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              voidedQtyTotal += item.qty;
              voidedValueTotal += item.total;
              
              return `
              <tr style="border-bottom: 1px solid #e5e7eb; ${idx % 2 === 0 ? 'background: #f9fafb;' : ''}">
                <td style="padding: 12px; font-size: 0.9rem;">${item.table || '—'}</td>
                <td style="padding: 12px; font-size: 0.9rem;">${item.product}</td>
                <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${item.qty}</td>
                <td style="padding: 12px; text-align: right; font-size: 0.9rem; font-weight: 600;">₦${formattedValue}</td>
              </tr>
            `;
            }).join('') + `
              <tr style="background: #f3f4f6; border-top: 2px solid #d1d5db; font-weight: 600;">
                <td style="padding: 12px; font-size: 0.9rem;">TOTAL</td>
                <td style="padding: 12px; font-size: 0.9rem;">—</td>
                <td style="padding: 12px; text-align: center; font-size: 0.9rem;">${voidedQtyTotal}</td>
                <td style="padding: 12px; text-align: right; font-size: 0.9rem;">₦${(voidedValueTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            `;
          }

          if (voidedTotalValue) {
            voidedTotalValue.textContent = '₦' + formatCurrency(voidedValueTotal);
          }
          if (voidedTotalItems) {
            voidedTotalItems.textContent = voidedQtyTotal;
          }
        } else {
          if (voidedItemsTbody) {
            voidedItemsTbody.innerHTML = '<tr><td colspan="4" style="padding: 20px; text-align: center; color: #9ca3af;">No voided items</td></tr>';
          }
        }

        console.log('Consolidated data displayed in all report tables');
      } catch (err) {
        console.error('Error displaying consolidated data in tables:', err);
      }
    }
    
    async function importReportCSV(event) {
      const file = event.target.files[0];
      if (!file) {
        console.warn('No file selected');
        return;
      }
      
      console.log('Importing file:', file.name);
      
      try {
        const text = await file.text();
        const lines = text.trim().split('\n');
        
        if (lines.length < 2) {
          alert('CSV file appears to be empty or invalid');
          return;
        }
        
        console.log('Total lines:', lines.length);
        console.log('First 5 lines:', lines.slice(0, 5));
        
        // Check if this is an End of Day Report (multi-section CSV)
        const isEODReport = lines[0].trim().toLowerCase().includes('end of day report') ||
                           lines.some(l => l.trim().toLowerCase().includes('item summary')) ||
                           lines.some(l => l.trim().toLowerCase().includes('category summary'));
        
        if (isEODReport) {
          console.log('Detected End of Day Report format');
          
          // Parse EOD report sections
          let currentSection = '';
          const reportData = {
            eventName: '',
            dateStr: '',
            timeStr: '',
            items: {},
            categories: {},
            subcategories: {},
            voidedItems: []
          };
          
          // Extract metadata from first few lines
          for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i].trim();
            if (line.toLowerCase().includes('event:')) {
              reportData.eventName = line.split(':')[1]?.trim() || '';
            } else if (line.toLowerCase().includes('date:')) {
              reportData.dateStr = line.split(':')[1]?.trim() || '';
            } else if (line.toLowerCase().includes('time:')) {
              reportData.timeStr = line.split(':')[1]?.trim() || '';
            }
          }
          
          // Parse sections
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.toLowerCase().includes('item summary')) {
              currentSection = 'items';
              i++; // Skip header row
              continue;
            } else if (line.toLowerCase().includes('category summary')) {
              currentSection = 'categories';
              i++; // Skip header row
              continue;
            } else if (line.toLowerCase().includes('subcategory summary')) {
              currentSection = 'subcategories';
              i++; // Skip header row
              continue;
            } else if (line.toLowerCase().includes('voided items')) {
              currentSection = 'voided';
              i++; // Skip header row
              continue;
            }
            
            if (!line || line.includes('---') || line.toLowerCase() === 'total') continue;
            
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            
            if (currentSection === 'items' && values.length >= 3) {
              const product = values[0];
              if (product && product.toLowerCase() !== 'product' && product.toLowerCase() !== 'total') {
                reportData.items[product] = {
                  qty: parseInt(values[1]) || 0,
                  amount: parseFloat(values[2]) || 0
                };
              }
            } else if (currentSection === 'categories' && values.length >= 2) {
              const category = values[0];
              if (category && category.toLowerCase() !== 'category' && category.toLowerCase() !== 'total') {
                reportData.categories[category] = parseFloat(values[1]) || 0;
              }
            } else if (currentSection === 'subcategories' && values.length >= 2) {
              const subcategory = values[0];
              if (subcategory && subcategory.toLowerCase() !== 'subcategory' && subcategory.toLowerCase() !== 'total') {
                reportData.subcategories[subcategory] = parseFloat(values[1]) || 0;
              }
            } else if (currentSection === 'voided' && values.length >= 4) {
              const table = values[0];
              if (table && table.toLowerCase() !== 'table' && table.toLowerCase() !== 'total') {
                reportData.voidedItems.push({
                  table: table,
                  product: values[1],
                  qty: parseInt(values[2]) || 0,
                  total: parseFloat(values[3]) || 0
                });
              }
            }
          }
          
          // Store the report data for display
          window.importedEODReportData = reportData;
          
          // Merge with any previously imported EOD reports
          // This allows consolidating data from multiple systems into one master EOD report
          let consolidatedData = {
            eventName: reportData.eventName || 'Multi-System Event',
            dateStr: reportData.dateStr,
            timeStr: reportData.timeStr,
            items: {},
            categories: {},
            subcategories: {},
            voidedItems: [],
            importedSystems: []
          };
          
          // Load existing consolidated data if it exists
          try {
            const existingConsolidated = await RestaurantDB.getSetting('consolidatedEODReport');
            if (existingConsolidated && existingConsolidated.value) {
              const parsed = JSON.parse(existingConsolidated.value);
              consolidatedData = parsed;
              console.log('Loaded existing consolidated data');
            }
          } catch (err) {
            console.warn('No existing consolidated data found, creating new');
          }
          
          // Merge current import with consolidated data
          try {
            // Merge items (add quantities and amounts)
            for (const [productName, itemData] of Object.entries(reportData.items)) {
              if (!consolidatedData.items[productName]) {
                consolidatedData.items[productName] = { qty: 0, amount: 0 };
              }
              consolidatedData.items[productName].qty += itemData.qty;
              consolidatedData.items[productName].amount += itemData.amount;
            }
            
            // Merge categories (add amounts)
            for (const [categoryName, amount] of Object.entries(reportData.categories)) {
              if (!consolidatedData.categories[categoryName]) {
                consolidatedData.categories[categoryName] = 0;
              }
              consolidatedData.categories[categoryName] += amount;
            }
            
            // Merge subcategories (add amounts)
            for (const [subcategoryName, amount] of Object.entries(reportData.subcategories)) {
              if (!consolidatedData.subcategories[subcategoryName]) {
                consolidatedData.subcategories[subcategoryName] = 0;
              }
              consolidatedData.subcategories[subcategoryName] += amount;
            }
            
            // Merge voided items (just add them)
            consolidatedData.voidedItems = consolidatedData.voidedItems.concat(reportData.voidedItems);
            
            // Track which systems have been imported
            consolidatedData.importedSystems.push({
              systemName: reportData.eventName || 'Unknown System',
              dateStr: reportData.dateStr,
              timeStr: reportData.timeStr,
              importedAt: new Date().toISOString()
            });
            
            // Save the consolidated data back to database
            await RestaurantDB.setSetting('consolidatedEODReport', JSON.stringify(consolidatedData));
            console.log('Consolidated data updated and saved');
          } catch (mergeErr) {
            console.warn('Error merging EOD data:', mergeErr);
          }
          
          // Calculate totals
          const itemsCount = Object.keys(consolidatedData.items).length;
          const categoriesCount = Object.keys(consolidatedData.categories).length;
          const subcategoriesCount = Object.keys(consolidatedData.subcategories).length;
          const voidedCount = consolidatedData.voidedItems.length;
          const totalAmount = Object.values(consolidatedData.items).reduce((sum, item) => sum + (item.amount || 0), 0);
          const systemsImported = consolidatedData.importedSystems.length;
          
          // Display consolidated data in all report tables
          await displayConsolidatedDataInTables(consolidatedData);
          
          alert(`✓ EOD Report Imported & Consolidated Successfully!\n\nCurrent Import:\nEvent: ${reportData.eventName}\nDate: ${reportData.dateStr}\nTime: ${reportData.timeStr}\n\n📊 CONSOLIDATED TOTALS (All Systems):\n• Items Sold: ${itemsCount}\n• Total Sales: ₦${formatCurrency(totalAmount)}\n• Categories: ${categoriesCount}\n• Subcategories: ${subcategoriesCount}\n• Voided Items: ${voidedCount}\n\n🖥️ Systems Imported: ${systemsImported}\n\nData from multiple systems is now merged. You can continue importing reports from other systems, or export the complete consolidated EOD report.`);
          
          console.log('EOD Report imported and consolidated:', consolidatedData);
          event.target.value = '';
          return;
        }
        
        // Otherwise, try to parse as transaction data (simple CSV format)
        // Find the first line that looks like CSV headers
        let headerLineIndex = -1;
        let headers = [];
        
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          const potentialHeaders = lines[i].split(',').map(h => h.trim().toLowerCase());
          
          // Check if this line contains common header patterns
          if (potentialHeaders.some(h => h.includes('order') || h.includes('table') || h.includes('product') || h.includes('id'))) {
            headerLineIndex = i;
            headers = potentialHeaders;
            console.log('Found headers at line', i, ':', headers);
            break;
          }
        }
        
        if (headerLineIndex === -1) {
          alert('Invalid CSV format. Could not find column headers. Expected columns like: Order ID, Table, Items, Total');
          return;
        }
        
        // Parse data rows starting after headers
        const importedOrders = [];
        let skippedCount = 0;
        
        for (let i = headerLineIndex + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue; // Skip empty lines
          
          // Skip section headers and totals
          if (line.toUpperCase().includes('SUMMARY') || 
              line.toUpperCase().includes('TOTAL') ||
              line.toUpperCase().includes('VOIDED')) {
            continue;
          }
          
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, '')); // Remove quotes
          
          if (values.length < 1 || !values[0]) continue;
          
          try {
            // Map CSV columns to order fields
            const orderId = values[0];
            const tableName = values[1] || 'N/A';
            const itemCount = parseInt(values[2]) || 0;
            const totalAmount = parseFloat(values[3]) || 0;
            
            // Skip if invalid data
            if (!orderId || totalAmount === 0) continue;
            
            // Check if order already exists
            const existingOrder = await RestaurantDB.getOrder(orderId);
            
            if (existingOrder) {
              skippedCount++;
              console.log('Skipping duplicate order:', orderId);
              continue;
            }
            
            // Create order object
            const newOrder = {
              id: orderId,
              tableName: tableName,
              waiterName: 'Imported',
              clientName: '',
              items: [],
              voidedItems: [],
              totalAmount: totalAmount,
              status: 'completed',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              billingBreakdown: {
                subtotal: totalAmount,
                tax: 0,
                taxPercentage: 0,
                discount: 0,
                discountPercentage: 0,
                serviceCharge: 0,
                serviceChargePercentage: 0
              }
            };
            
            importedOrders.push(newOrder);
            console.log('Parsed order:', orderId, 'Table:', tableName, 'Total:', totalAmount);
          } catch (parseErr) {
            console.warn('Error parsing row', i, ':', parseErr);
          }
        }
        
        if (importedOrders.length === 0) {
          alert('No valid orders found in the CSV file to import.');
          return;
        }
        
        // Add imported orders to database
        for (const order of importedOrders) {
          await RestaurantDB.addOrder(order);
        }
        
        alert(`✓ Successfully imported ${importedOrders.length} orders${skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : ''}!`);
        console.log('Import complete: ' + importedOrders.length + ' orders added');
        
        // Reset file input
        event.target.value = '';
        
      } catch (error) {
        console.error('Error importing CSV:', error);
        alert('Error importing CSV file: ' + error.message);
      }
    }

    // **END OF DAY REPORT**
    async function generateEndOfDayReport() {
      try {
        const allOrders = await getOrdersForReports();
        const allProducts = await getProductsForReports();
        
        const settings = await RestaurantDB.getSetting('eventName');
        const eventName = settings?.value || 'Restaurant';
        
        // Fetch categories and subcategories for lookups
        const allCategories = await RestaurantDB.getAllCategories();
        const allSubcategories = await RestaurantDB.getAllSubcategories();
        
        const categoryMap = {};
        allCategories.forEach(c => categoryMap[c.id] = c.name);
        
        const subcategoryMap = {};
        allSubcategories.forEach(s => subcategoryMap[s.id] = s.name);
        
        const productDetailsMap = {};
        allProducts.forEach(p => {
          if (p.name) {
            productDetailsMap[p.name.toLowerCase()] = {
              price: p.price || 0,
              category: categoryMap[p.cat] || 'Uncategorized',
              subcategory: subcategoryMap[p.sub] || 'Uncategorized'
            };
          }
        });

        // Generate items summary
        const itemsSummary = {};
        const categorySummary = {};
        const subcategorySummary = {};
        const voidedItems = [];
        
        allOrders.forEach(order => {
          if (!shouldIncludeOrderInReports(order)) return;
          if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
              const productName = getItemProductName(item);
              const quantity = getItemQuantity(item);
              const productNameLower = productName.toLowerCase();
              const productDetails = productDetailsMap[productNameLower] || { price: 0, category: 'Uncategorized', subcategory: 'Uncategorized' };
              const unitPrice = getItemPrice(item, Object.fromEntries(allProducts.map(product => [String(product.name).toLowerCase(), Number(product.price || 0)])));
              const total = quantity * unitPrice;
              
              if (!itemsSummary[productName]) {
                itemsSummary[productName] = { qty: 0, amount: 0 };
              }
              itemsSummary[productName].qty += quantity;
              itemsSummary[productName].amount += total;
              
              const category = productDetails.category || 'Uncategorized';
              if (!categorySummary[category]) {
                categorySummary[category] = 0;
              }
              categorySummary[category] += total;
              
              const subcategory = productDetails.subcategory || 'Uncategorized';
              if (!subcategorySummary[subcategory]) {
                subcategorySummary[subcategory] = 0;
              }
              subcategorySummary[subcategory] += total;
            });
          }
          
          if (Array.isArray(order.voidedItems)) {
            order.voidedItems.forEach(item => {
              const productName = String(item?.productName || item?.name || 'Unknown').trim();
              const quantity = Number(item?.quantity ?? item?.qty ?? 0) || 0;
              const unitPrice = Number(item?.unitPrice ?? item?.price ?? 0) || 0;
              const total = quantity * unitPrice;
              
              voidedItems.push({
                table: getOrderTableName(order),
                product: productName,
                qty: quantity,
                total
              });
            });
          }
        });

        // Create report content
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        const timeStr = now.toLocaleTimeString();
        
        const itemsArray = Object.entries(itemsSummary).sort((a, b) => b[1].amount - a[1].amount);
        const categoriesArray = Object.entries(categorySummary).sort((a, b) => b[1] - a[1]);
        const subcategoriesArray = Object.entries(subcategorySummary).sort((a, b) => b[1] - a[1]);
        
        const paymentBreakdown = {};
        const staffSummary = { waiters: {}, cashiers: {} };
        
        allOrders.forEach(order => {
          if (!shouldIncludeOrderInReports(order)) return;
          const orderAmount = getOrderAmount(order);
          const paymentMethod = String(getOrderPaymentMethod(order) || 'N/A').trim() || 'N/A';
          if (!paymentBreakdown[paymentMethod]) {
            paymentBreakdown[paymentMethod] = { label: paymentMethod, count: 0, revenue: 0 };
          }
          paymentBreakdown[paymentMethod].count += 1;
          paymentBreakdown[paymentMethod].revenue += orderAmount;

          const waiter = getOrderPerson(order, ['waiterName', 'waiter', 'waiter_name', 'orderData.waiterName', 'orderData.waiter', 'orderData.waiter_name', 'order.orderData.waiterName', 'order.orderData.waiter', 'order.orderData.waiter_name']);
          const cashier = getOrderPerson(order, ['cashierName', 'cashier', 'createdBy', 'created_by', 'orderData.cashierName', 'orderData.cashier', 'orderData.createdBy', 'orderData.created_by', 'order.orderData.cashierName', 'order.orderData.cashier', 'order.orderData.createdBy', 'order.orderData.created_by']);
          if (waiter && waiter !== 'N/A') {
            staffSummary.waiters[waiter] = (staffSummary.waiters[waiter] || 0) + orderAmount;
          }
          if (cashier && cashier !== 'N/A') {
            staffSummary.cashiers[cashier] = (staffSummary.cashiers[cashier] || 0) + orderAmount;
          }
        });

        const paymentEntries = Object.values(paymentBreakdown).sort((a, b) => b.revenue - a.revenue);
        const topProducts = itemsArray
          .map(([product, data]) => ({ product, qty: data.qty, amount: data.amount }))
          .sort((a, b) => b.qty - a.qty || b.amount - a.amount)
          .slice(0, 10);
        const topWaiters = Object.entries(staffSummary.waiters)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, revenue]) => ({ name, revenue }));
        const topCashiers = Object.entries(staffSummary.cashiers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, revenue]) => ({ name, revenue }));

        // Calculate totals
        const itemsTotalQty = itemsArray.reduce((sum, item) => sum + item[1].qty, 0);
        const itemsTotalAmount = itemsArray.reduce((sum, item) => sum + item[1].amount, 0);
        const categoriesTotalValue = categoriesArray.reduce((sum, cat) => sum + cat[1], 0);
        const subcategoriesTotalValue = subcategoriesArray.reduce((sum, sub) => sum + sub[1], 0);
        const voidedTotalQty = voidedItems.reduce((sum, item) => sum + item.qty, 0);
        const voidedTotalValue = voidedItems.reduce((sum, item) => sum + item.total, 0);
        const itemsCount = itemsArray.length;
        const categoriesCount = categoriesArray.length;
        const subcategoriesCount = subcategoriesArray.length;
        const voidedCount = voidedItems.length;
        
        let html = `
          <div style="font-family: Arial, sans-serif; color: #1f2937;">
            <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #d1d5db; padding-bottom: 20px;">
              <h1 style="margin: 0; font-size: 1.5rem; font-weight: 700;">${eventName}</h1>
              <h2 style="margin: 10px 0 0 0; font-size: 1.2rem; color: #6b7280;">END OF DAY REPORT</h2>
              <p style="margin: 10px 0 0 0; color: #9ca3af; font-size: 0.95rem;">
                <strong>Date:</strong> ${dateStr}<br>
                <strong>Time:</strong> ${timeStr}
              </p>
            </div>

            <!-- Items Summary -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">ITEM SUMMARY</h3>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                  <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb;">Product</th>
                    <th style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">Qty</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsArray.map(([product, data]) => `
                    <tr>
                      <td style="padding: 12px; border: 1px solid #e5e7eb;">${product}</td>
                      <td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">${data.qty}</td>
                      <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(data.amount)}</td>
                    </tr>
                  `).join('')}
                  <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                    <td style="padding: 12px; border: 1px solid #e5e7eb;">TOTAL</td>
                    <td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">${itemsTotalQty}</td>
                    <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(itemsTotalAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Category Summary -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">CATEGORY SUMMARY</h3>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                  <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb;">Category</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${categoriesArray.map(([category, total]) => `
                    <tr>
                      <td style="padding: 12px; border: 1px solid #e5e7eb;">${category}</td>
                      <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(total)}</td>
                    </tr>
                  `).join('')}
                  <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                    <td style="padding: 12px; border: 1px solid #e5e7eb;">TOTAL</td>
                    <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(categoriesTotalValue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Subcategory Summary -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">SUBCATEGORY SUMMARY</h3>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                  <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb;">Subcategory</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${subcategoriesArray.map(([subcategory, total]) => `
                    <tr>
                      <td style="padding: 12px; border: 1px solid #e5e7eb;">${subcategory}</td>
                      <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(total)}</td>
                    </tr>
                  `).join('')}
                  <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                    <td style="padding: 12px; border: 1px solid #e5e7eb;">TOTAL</td>
                    <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(subcategoriesTotalValue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Voided Items -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">VOIDED ITEMS</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb;">Table</th>
                    <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb;">Product</th>
                    <th style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">Qty</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${voidedItems.length === 0 
                    ? '<tr><td colspan="4" style="padding: 12px; text-align: center; border: 1px solid #e5e7eb; color: #9ca3af;">No voided items</td></tr>'
                    : voidedItems.map(item => `
                    <tr>
                      <td style="padding: 12px; border: 1px solid #e5e7eb;">${item.table}</td>
                      <td style="padding: 12px; border: 1px solid #e5e7eb;">${item.product}</td>
                      <td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">${item.qty}</td>
                      <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(item.total)}</td>
                    </tr>
                  `).join('')
                  }
                  ${voidedItems.length > 0 ? `
                  <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                    <td colspan="2" style="padding: 12px; border: 1px solid #e5e7eb;">TOTAL</td>
                    <td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">${voidedTotalQty}</td>
                    <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(voidedTotalValue)}</td>
                  </tr>
                  ` : ''}
                </tbody>
              </table>
            </div>
          </div>

            <!-- Payment Breakdown -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">PAYMENT BREAKDOWN</h3>
              ${paymentEntries.length === 0 ? '<div style="color:#6b7280;">No payment records available.</div>' : `
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
                  ${paymentEntries.map((entry) => `
                    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;">
                      <div style="font-weight:700; margin-bottom: 8px;">${entry.label}</div>
                      <div style="font-size:0.95rem; color:#475569;">Orders: ${entry.count}</div>
                      <div style="font-size:0.95rem; color:#475569;">Revenue: ₦${formatCurrency(entry.revenue)}</div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>

            <!-- Top Selling Products -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">TOP SELLING PRODUCTS</h3>
              ${topProducts.length === 0 ? '<div style="color:#6b7280;">No sold products yet.</div>' : `
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                  <thead>
                    <tr style="background: #f3f4f6;">
                      <th style="padding: 12px; text-align: left; border: 1px solid #e5e7eb;">Product</th>
                      <th style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">Qty Sold</th>
                      <th style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${topProducts.map((item) => `
                      <tr>
                        <td style="padding: 12px; border: 1px solid #e5e7eb;">${item.product}</td>
                        <td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">${item.qty}</td>
                        <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">₦${formatCurrency(item.amount)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>

            <!-- Staff Performance -->
            <div style="margin-bottom: 30px;">
              <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px;">STAFF PERFORMANCE</h3>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">
                <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;">
                  <div style="font-weight:700; margin-bottom: 10px;">Top Waiters</div>
                  ${topWaiters.length === 0 ? '<div style="color:#6b7280;">No waiter performance yet.</div>' : `<ol style="margin:0;padding-left:18px;color:#111827;">${topWaiters.map((person) => `<li style="margin-bottom:8px;">${person.name} — ₦${formatCurrency(person.revenue)}</li>`).join('')}</ol>`}
                </div>
                <div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;">
                  <div style="font-weight:700; margin-bottom: 10px;">Top Cashiers</div>
                  ${topCashiers.length === 0 ? '<div style="color:#6b7280;">No cashier performance yet.</div>' : `<ol style="margin:0;padding-left:18px;color:#111827;">${topCashiers.map((person) => `<li style="margin-bottom:8px;">${person.name} — ₦${formatCurrency(person.revenue)}</li>`).join('')}</ol>`}
                </div>
              </div>
            </div>
          </div>
        `;

        // Display in modal
        const eodContent = document.getElementById('eod-content');
        const eodModal = document.getElementById('end-of-day-modal');
        
        if (eodContent) {
          eodContent.innerHTML = html;
        }
        
        if (eodModal) {
          eodModal.setAttribute('aria-hidden', 'false');
          eodModal.style.display = 'flex';
        }

        // Store report data for export and archiving
        window.eodReportData = {
          eventName,
          dateStr,
          timeStr,
          itemsArray,
          categoriesArray,
          subcategoriesArray,
          voidedItems,
          itemsTotalQty,
          itemsTotalAmount,
          categoriesTotalValue,
          subcategoriesTotalValue,
          voidedTotalQty,
          voidedTotalValue,
          itemsCount,
          categoriesCount,
          subcategoriesCount,
          voidedCount,
          paymentBreakdown,
          paymentEntries,
          topProducts,
          topWaiters,
          topCashiers,
          staffPerformance: {
            waiters: topWaiters,
            cashiers: topCashiers
          },
          html
        };
      } catch (error) {
        console.error('Error generating end of day report:', error);
        alert('Error generating report: ' + error.message);
      }
    }

    if (btnEndOfDayReport) {
      btnEndOfDayReport.addEventListener('click', generateEndOfDayReport);
    }

    // Print End of Day Report
    const btnPrintEod = document.getElementById('btn-print-eod');
    if (btnPrintEod) {
      btnPrintEod.addEventListener('click', () => {
        if (window.eodReportData) {
          const printWindow = window.open('', '_blank');
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>End of Day Report - ${window.eodReportData.eventName}</title>
                <style>
                  body { font-family: Arial, sans-serif; margin: 20px; color: #1f2937; }
                  h1, h2, h3 { margin-bottom: 10px; }
                  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                  th, td { padding: 12px; border: 1px solid #e5e7eb; text-align: left; }
                  th { background: #f3f4f6; font-weight: 600; }
                  tr:nth-child(even) { background: #f9fafb; }
                  .text-right { text-align: right; }
                  .text-center { text-align: center; }
                  .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #d1d5db; padding-bottom: 20px; }
                  .section-header { font-size: 1.1rem; font-weight: 600; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 10px; }
                  @media print { body { margin: 0; } }
                </style>
              </head>
              <body>
                <div class="header">
                  <h1>${window.eodReportData.eventName}</h1>
                  <h2>END OF DAY REPORT</h2>
                  <p><strong>Date:</strong> ${window.eodReportData.dateStr}<br><strong>Time:</strong> ${window.eodReportData.timeStr}</p>
                </div>

                <h3 class="section-header">ITEM SUMMARY</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th class="text-center">Qty</th>
                      <th class="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${window.eodReportData.itemsArray.map(([product, data]) => `
                      <tr>
                        <td>${product}</td>
                        <td class="text-center">${data.qty}</td>
                        <td class="text-right">₦${formatCurrency(data.amount)}</td>
                      </tr>
                    `).join('')}
                    <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                      <td>TOTAL</td>
                      <td class="text-center">${window.eodReportData.itemsTotalQty}</td>
                      <td class="text-right">₦${formatCurrency(window.eodReportData.itemsTotalAmount)}</td>
                    </tr>
                  </tbody>
                </table>

                <h3 class="section-header">CATEGORY SUMMARY</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th class="text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${window.eodReportData.categoriesArray.map(([category, total]) => `
                      <tr>
                        <td>${category}</td>
                        <td class="text-right">₦${formatCurrency(total)}</td>
                      </tr>
                    `).join('')}
                    <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                      <td>TOTAL</td>
                      <td class="text-right">₦${formatCurrency(window.eodReportData.categoriesTotalValue)}</td>
                    </tr>
                  </tbody>
                </table>

                <h3 class="section-header">SUBCATEGORY SUMMARY</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Subcategory</th>
                      <th class="text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${window.eodReportData.subcategoriesArray.map(([subcategory, total]) => `
                      <tr>
                        <td>${subcategory}</td>
                        <td class="text-right">₦${formatCurrency(total)}</td>
                      </tr>
                    `).join('')}
                    <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                      <td>TOTAL</td>
                      <td class="text-right">₦${formatCurrency(window.eodReportData.subcategoriesTotalValue)}</td>
                    </tr>
                  </tbody>
                </table>

                <h3 class="section-header">VOIDED ITEMS</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Product</th>
                      <th class="text-center">Qty</th>
                      <th class="text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${window.eodReportData.voidedItems.length === 0 
                      ? '<tr><td colspan="4" style="text-align: center; color: #9ca3af;">No voided items</td></tr>'
                      : window.eodReportData.voidedItems.map(item => `
                      <tr>
                        <td>${item.table}</td>
                        <td>${item.product}</td>
                        <td class="text-center">${item.qty}</td>
                        <td class="text-right">₦${formatCurrency(item.total)}</td>
                      </tr>
                    `).join('')
                    }
                    ${window.eodReportData.voidedItems.length > 0 ? `
                    <tr style="background: #f3f4f6; font-weight: 600; border-top: 2px solid #d1d5db;">
                      <td colspan="2">TOTAL</td>
                      <td class="text-center">${window.eodReportData.voidedTotalQty}</td>
                      <td class="text-right">₦${formatCurrency(window.eodReportData.voidedTotalValue)}</td>
                    </tr>
                    ` : ''}
                  </tbody>
                </table>
              </body>
            </html>
          `);
          printWindow.document.close();
          printWindow.print();
        }
      });
    }

    // Export End of Day Report as CSV
    const btnExportCsvEod = document.getElementById('btn-export-csv-eod');
    if (btnExportCsvEod) {
      btnExportCsvEod.addEventListener('click', () => {
        if (window.eodReportData) {
          let csv = `END OF DAY REPORT\n`;
          csv += `Event: ${window.eodReportData.eventName}\n`;
          csv += `Date: ${window.eodReportData.dateStr}\n`;
          csv += `Time: ${window.eodReportData.timeStr}\n\n`;

          // Item Summary
          csv += `ITEM SUMMARY\n`;
          csv += `Product,Quantity,Amount\n`;
          window.eodReportData.itemsArray.forEach(([product, data]) => {
            csv += `"${product}",${data.qty},${data.amount}\n`;
          });
          csv += `TOTAL,${window.eodReportData.itemsTotalQty},${window.eodReportData.itemsTotalAmount}\n`;
          csv += `\n`;

          // Category Summary
          csv += `CATEGORY SUMMARY\n`;
          csv += `Category,Total Value\n`;
          window.eodReportData.categoriesArray.forEach(([category, total]) => {
            csv += `"${category}",${total}\n`;
          });
          csv += `TOTAL,${window.eodReportData.categoriesTotalValue}\n`;
          csv += `\n`;

          // Subcategory Summary
          csv += `SUBCATEGORY SUMMARY\n`;
          csv += `Subcategory,Total Value\n`;
          window.eodReportData.subcategoriesArray.forEach(([subcategory, total]) => {
            csv += `"${subcategory}",${total}\n`;
          });
          csv += `TOTAL,${window.eodReportData.subcategoriesTotalValue}\n`;
          csv += `\n`;

          // Voided Items
          csv += `VOIDED ITEMS\n`;
          csv += `Table,Product,Quantity,Total Value\n`;
          window.eodReportData.voidedItems.forEach(item => {
            csv += `"${item.table}","${item.product}",${item.qty},${item.total}\n`;
          });
          if (window.eodReportData.voidedItems.length > 0) {
            csv += `TOTAL,,${window.eodReportData.voidedTotalQty},${window.eodReportData.voidedTotalValue}\n`;
          }

          // Download CSV
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          link.setAttribute('href', URL.createObjectURL(blob));
          link.setAttribute('download', `end_of_day_report_${window.eodReportData.dateStr.replace(/\//g, '-')}.csv`);
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      });
    }

    const btnSaveEod = document.getElementById('btn-save-eod');
    const btnRefreshArchives = document.getElementById('btn-refresh-archives');
    const eodArchivesList = document.getElementById('eod-archives-list');
    const eodArchivesPagination = document.getElementById('eod-archives-pagination');
    let eodArchivesCurrentPage = 1;
    const EOD_ARCHIVES_PAGE_SIZE = 20;

    function renderEodArchivesPagination(totalCount, currentPage) {
      if (!eodArchivesPagination) return;
      const totalPages = Math.max(1, Math.ceil(totalCount / EOD_ARCHIVES_PAGE_SIZE));
      const pageButtons = [];
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, startPage + 4);
      if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
      }
      for (let page = startPage; page <= endPage; page += 1) {
        pageButtons.push(`
          <button type="button" data-page="${page}" style="padding:8px 12px;border-radius:8px;border:1px solid ${page === currentPage ? '#1d4ed8' : '#d1d5db'};background:${page === currentPage ? '#eff6ff' : '#ffffff'};color:${page === currentPage ? '#1d4ed8' : '#111827'};cursor:pointer;" ${page === currentPage ? 'disabled' : ''}>${page}</button>
        `);
      }
      eodArchivesPagination.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button type="button" data-page="${Math.max(currentPage - 1, 1)}" style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;background:#ffffff;color:#111827;cursor:pointer;" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
          ${pageButtons.join('')}
          <button type="button" data-page="${Math.min(currentPage + 1, totalPages)}" style="padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;background:#ffffff;color:#111827;cursor:pointer;" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
          <span style="color:#6b7280;font-size:0.95rem;">Page ${currentPage} of ${totalPages}</span>
        </div>
      `;
      eodArchivesPagination.querySelectorAll('button[data-page]').forEach((button) => {
        button.addEventListener('click', async () => {
          const page = Number(button.dataset.page);
          if (!Number.isInteger(page) || page < 1 || page === eodArchivesCurrentPage) return;
          await loadEodArchives(page);
        });
      });
    }

    async function loadEodArchives(page = 1) {
      if (!eodArchivesList) return;
      eodArchivesCurrentPage = Number(page) || 1;
      if (eodArchivesPagination) {
        eodArchivesPagination.innerHTML = '';
      }
      eodArchivesList.innerHTML = `
        <div style="padding: 32px 20px; text-align: center; color: #6b7280; grid-column: 1 / -1;">Loading archived reports...</div>
      `;

      try {
        if (typeof BACKEND_AVAILABLE !== 'undefined' && BACKEND_AVAILABLE && typeof fetchBackend === 'function') {
          const resp = await fetchBackend(`/api/reports/eod?page=${eodArchivesCurrentPage}&pageSize=${EOD_ARCHIVES_PAGE_SIZE}`);
          if (resp && resp.success && Array.isArray(resp.reports)) {
            const archives = resp.reports.map(r => ({
              id: r.id,
              reportId: r.id,
              title: r.title || 'End of Day Report',
              dateDisplay: (r.timestamp ? new Date(r.timestamp).toLocaleString() : ''),
              date: (r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ''),
              time: (r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : ''),
              totalValue: Number(r.totalValue || 0),
              data: r.reportData || {},
              summary: {}
            }));

            if (archives.length === 0) {
              eodArchivesList.innerHTML = `
                <div id="eod-archives-empty" style="padding: 20px; text-align: center; color: #9ca3af; grid-column: 1 / -1;">No archived reports yet.</div>
              `;
            } else {
              eodArchivesList.innerHTML = archives.map((entry) => {
                const topProducts = entry.data?.topProducts || entry.summary?.topProducts || (entry.data?.itemsArray || []).slice(0, 10).map(([product, data]) => ({ product, qty: data.qty, amount: data.amount || data.total || 0 }));
                const topProductsSummary = topProducts.slice(0, 3).map((item) => `${item.product} (${item.qty || 0})`).join(', ') || 'No products';
                const paymentEntries = entry.data?.paymentEntries || entry.data?.paymentBreakdown || entry.summary?.paymentBreakdown || [];
                const paymentSummary = paymentEntries.slice(0, 2).map(entry => `${entry.label}: ₦${formatCurrency(entry.revenue || 0)}`).join(' · ') || 'No payment data';
                const topWaiterEntry = (entry.data?.topWaiters || entry.data?.staffPerformance?.waiters || entry.summary?.staffPerformance?.waiters || [])[0];
                const topCashierEntry = (entry.data?.topCashiers || entry.data?.staffPerformance?.cashiers || entry.summary?.staffPerformance?.cashiers || [])[0];
                const topWaiter = topWaiterEntry ? `${topWaiterEntry.name} - ₦${formatCurrency(topWaiterEntry.revenue)}` : 'No waiter';
                const topCashier = topCashierEntry ? `${topCashierEntry.name} - ₦${formatCurrency(topCashierEntry.revenue)}` : 'No cashier';
                const itemsCount = entry.data?.itemsCount ?? entry.summary?.itemsCount ?? (entry.data?.itemsArray || []).length;
                const categoriesCount = entry.data?.categoriesCount ?? entry.summary?.categoriesCount ?? (entry.data?.categoriesArray || []).length;
                const subcategoriesCount = entry.data?.subcategoriesCount ?? entry.summary?.subcategoriesCount ?? (entry.data?.subcategoriesArray || []).length;
                const voidedCount = entry.data?.voidedCount ?? entry.summary?.voidedCount ?? (entry.data?.voidedItems || []).length;
                const voidedTotalValue = entry.data?.voidedTotalValue ?? entry.summary?.voidedTotalValue ?? (entry.data?.voidedItems || []).reduce((sum, item) => sum + (item.total || 0), 0);

                return `
                  <article class="card" style="display:flex;flex-direction:column;gap:16px;min-height:240px;">
                    <div>
                      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
                        <div>
                          <div style="font-size:0.9rem;color:#6b7280;margin-bottom:4px;">${entry.title || 'End of Day Report'}</div>
                          <div style="font-size:0.85rem;color:#475569;">${entry.dateDisplay || entry.date || 'Unknown date'}</div>
                        </div>
                        <div style="font-weight:700;font-size:1rem;">₦${formatCurrency(entry.totalValue)}</div>
                      </div>

                      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:14px;">
                        <div style="padding:12px;border-radius:12px;background:#f8fafc;">
                          <div style="font-size:0.82rem;color:#475569;">Items sold</div>
                          <div style="font-weight:700;margin-top:6px;">${itemsCount}</div>
                          <div style="font-size:0.82rem;color:#6b7280;">${topProductsSummary}</div>
                        </div>
                        <div style="padding:12px;border-radius:12px;background:#f8fafc;">
                          <div style="font-size:0.82rem;color:#475569;">Payment mix</div>
                          <div style="font-weight:700;margin-top:6px;">${paymentEntries[0]?.label || 'N/A'}</div>
                          <div style="font-size:0.82rem;color:#6b7280;">${paymentSummary}</div>
                        </div>
                        <div style="padding:12px;border-radius:12px;background:#f8fafc;">
                          <div style="font-size:0.82rem;color:#475569;">Top staff</div>
                          <div style="font-weight:700;margin-top:6px;">${topWaiterEntry?.name || 'No waiter'}</div>
                          <div style="font-size:0.82rem;color:#6b7280;">${topCashierEntry?.name || 'No cashier'}</div>
                        </div>
                      </div>

                      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                        <div style="padding:12px;border-radius:12px;background:#eef2ff;">
                          <div style="font-size:0.82rem;color:#475569;">Categories</div>
                          <div style="margin-top:6px;font-weight:700;">${categoriesCount}</div>
                        </div>
                        <div style="padding:12px;border-radius:12px;background:#eef2ff;">
                          <div style="font-size:0.82rem;color:#475569;">Voided items</div>
                          <div style="margin-top:6px;font-weight:700;">${voidedCount}</div>
                          <div style="font-size:0.82rem;color:#6b7280;">₦${formatCurrency(voidedTotalValue)}</div>
                        </div>
                      </div>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                      <div style="font-size:0.85rem;color:#475569;">${topProducts.length} top product${topProducts.length === 1 ? '' : 's'}</div>
                      <button type="button" class="btn btn-ghost" data-archive-id="${entry.id}" style="padding:10px 14px;">View report</button>
                    </div>
                  </article>
                `;
              }).join('');

              renderEodArchivesPagination(Number(resp.totalCount || resp.reports.length), eodArchivesCurrentPage);

              const viewButtons = eodArchivesList.querySelectorAll('button[data-archive-id]');
              viewButtons.forEach((button) => {
                button.addEventListener('click', async () => {
                  const archivedId = button.dataset.archiveId;
                  await openArchivedReport(archivedId);
                });
              });
            }
            return;
          }
        }
      } catch (err) {
        console.warn('Failed to load remote EOD reports:', err);
      }

      eodArchivesList.innerHTML = `
        <div id="eod-archives-empty" style="padding: 20px; text-align: center; color: #9ca3af; grid-column: 1 / -1;">No archived reports yet.</div>
      `;
      if (eodArchivesPagination) {
        eodArchivesPagination.innerHTML = '';
      }
      return;
    }

    async function saveEodArchive(reportData) {
      if (!reportData) return null;

      // Build basic payload
      const payload = {
        terminalId: (Auth.getSession && Auth.getSession()?.username) || ('admin-' + String(Date.now())),
        title: `${reportData.eventName} End of Day Report`,
        totalValue: reportData.itemsTotalAmount || 0,
        reportData: reportData
      };

      try {
        if (typeof fetchBackend === 'function' && typeof BACKEND_AVAILABLE !== 'undefined' && BACKEND_AVAILABLE) {
          const resp = await fetchBackend('/api/reports/eod', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (resp && resp.success) {
            return resp;
          }
        } else {
          throw new Error('backend_unavailable');
        }
      } catch (err) {
        console.error('Error saving archive entry to backend:', err);
        throw err;
      }
    }


    async function openArchivedReport(archiveId) {
      if (!archiveId) {
        alert('Invalid report id');
        return;
      }

      try {
        if (typeof fetchBackend === 'function' && typeof BACKEND_AVAILABLE !== 'undefined' && BACKEND_AVAILABLE) {
          const resp = await fetchBackend(`/api/reports/eod/${encodeURIComponent(String(archiveId))}`);
          if (resp && resp.success && resp.report) {
            const found = resp.report;
            window.eodReportData = found.reportData || {};
            const eodContent = document.getElementById('eod-content');
            const eodModal = document.getElementById('end-of-day-modal');
            if (eodContent) eodContent.innerHTML = (found.reportData && found.reportData.html) || '<p>No content available.</p>';
            if (eodModal) {
              eodModal.setAttribute('aria-hidden', 'false');
              eodModal.style.display = 'flex';
            }
            return;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch archived report:', err);
      }

      alert('Unable to load archived report.');
    }

    if (btnSaveEod) {
      btnSaveEod.addEventListener('click', async () => {
        if (!window.eodReportData) {
          alert('Generate a report before saving it to archives.');
          return;
        }

        // Save button loading state
        const origHtml = btnSaveEod.innerHTML;
        try {
          btnSaveEod.disabled = true;
          btnSaveEod.innerHTML = '<span class="spinner" aria-hidden="true"></span> Saving...';

          await saveEodArchive(window.eodReportData);
          await loadEodArchives();
          alert('Report saved to archives.');
        } catch (err) {
          console.error('Failed to save EOD report:', err);
          alert('Failed to save report: ' + (err && err.message ? err.message : 'Unknown error'));
        } finally {
          btnSaveEod.disabled = false;
          btnSaveEod.innerHTML = origHtml;
        }
      });
    }

    if (btnRefreshArchives) {
      btnRefreshArchives.addEventListener('click', async () => await loadEodArchives(eodArchivesCurrentPage));
    }

    await loadEodArchives();
    
    // Helper function to format currency
    function formatCurrency(amount) {
      return (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    
    // Load reports on initial page load
    loadVoidedItemsReport();
    loadItemsSummaryReport();
    loadSubcategorySummaryReport();
    loadCategorySummaryReport();
    loadTransactionHistory();
    await renderRecentSalesTable();
  })();
