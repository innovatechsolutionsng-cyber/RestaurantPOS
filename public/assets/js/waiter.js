(async function(){
  if(!Auth.requireRole('waiter')) return;

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
    const token = await Auth.getToken();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, Object.assign({ headers }, options));
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error = body && body.error ? body.error : response.statusText || 'backend_error';
      throw new Error(error);
    }
    return response.json();
  }

  let businessDayCutoff = '00:00';
  let businessDayRefreshTimer = null;

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
        await refreshDashboard();
        showToast('Business day boundary reached. Dashboard refreshed for current business day.', 'info', 2500);
      } catch (err) {
        console.error('Failed to refresh waiter dashboard on business day boundary:', err);
      } finally {
        scheduleBusinessDayRefresh();
      }
    }, delay);
  }

  async function loadBusinessDayCutoff() {
    try {
      const response = await fetchBackend('/api/settings/business-day');
      if (response && response.success) {
        businessDayCutoff = response.value || '00:00';
      }
    } catch (err) {
      console.warn('Failed to load business day cutoff:', err);
    }
  }

  function getOrderStatus(order) {
    const rawStatus = order?.status || order?.orderData?.status || order?.orderData?.order?.status || order?.order_data?.status || order?.orderData?.order_data?.status || '';
    return String(rawStatus || '').toLowerCase();
  }

  function getOrderWaiterName(order) {
    return String(order?.waiterName || order?.waiter || order?.orderData?.waiterName || order?.orderData?.order?.waiterName || '').trim();
  }

  function getOrderCashierName(order) {
    return String(
      order?.cashierName ||
      order?.cashier ||
      order?.createdBy ||
      order?.orderData?.cashierName ||
      order?.orderData?.cashier ||
      order?.orderData?.createdBy ||
      order?.orderData?.order?.cashierName ||
      order?.orderData?.order?.createdBy ||
      order?.orderData?.order?.cashier ||
      ''
    ).trim();
  }

  function renderStatusBadge(status) {
    const normalized = String(status || 'pending').trim().toLowerCase();
    const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    return `<span class="status-badge status-${normalized}">${label}</span>`;
  }

  const waiterNameElement = document.getElementById('cashier-name');
  const roleNameElement = document.getElementById('cashier-role');
  const pendingOrdersEl = document.getElementById('stat-pending-orders');
  const totalOrdersEl = document.getElementById('stat-orders');
  const revenueEl = document.getElementById('stat-revenue');
  const recentSalesBody = document.getElementById('recent-sales-body');
  const recentSalesTotal = document.getElementById('recent-sales-total');
  const sidebar = document.querySelector('.sidebar-card');
  const split = document.querySelector('.split');

  function isMobile() {
    return window.innerWidth <= 960;
  }

  const sidebarToggle = document.getElementById('mobile-nav-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  function setMobileSidebarState(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('mobile-sidebar-open', open);
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.toggle('active', open);
    }
    if (sidebarToggle) {
      sidebarToggle.setAttribute('aria-expanded', String(open));
    }
  }

  function expandSidebar() {
    if (!sidebar || !split) return;
    if (isMobile()) {
      setMobileSidebarState(true);
      return;
    }
    sidebar.classList.add('expanded');
    split.classList.add('sidebar-expanded');
  }

  function collapseSidebar() {
    if (!sidebar || !split) return;
    if (isMobile()) {
      setMobileSidebarState(false);
      return;
    }
    sidebar.classList.remove('expanded');
    split.classList.remove('sidebar-expanded');
  }

  if (sidebar) {
    sidebar.addEventListener('mouseenter', () => { if (!isMobile()) expandSidebar(); });
    sidebar.addEventListener('mouseleave', () => { if (!isMobile()) collapseSidebar(); });
    sidebar.addEventListener('focusin', () => { if (!isMobile()) expandSidebar(); });
    sidebar.addEventListener('focusout', (event) => {
      if (!sidebar.contains(event.relatedTarget)) collapseSidebar();
    });
    sidebar.addEventListener('click', (event) => {
      if (isMobile() && event.target.closest('.nav-link')) {
        collapseSidebar();
      }
    });
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      const willOpen = !sidebar.classList.contains('is-open');
      setMobileSidebarState(willOpen);
    });
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      setMobileSidebarState(false);
    });
  }

  window.addEventListener('resize', () => {
    if (isMobile()) collapseSidebar();
  });

  function initializePanels() {
    const panels = Array.from(document.querySelectorAll('.panel'));
    const savedPanel = localStorage.getItem('waiter-active-panel');
    const initialPanelId = savedPanel && panels.some((panel) => panel.id === savedPanel)
      ? savedPanel
      : (panels.find((panel) => panel.id === 'dashboard') || panels[0])?.id;

    if (initialPanelId) {
      showPanel(initialPanelId);
    }
  }

  function showPanel(panelId) {
    document.querySelectorAll('.nav-link[data-panel]').forEach((link) => {
      link.classList.toggle('active', link.dataset.panel === panelId);
    });
    localStorage.setItem('waiter-active-panel', panelId);

    document.querySelectorAll('.panel').forEach((panel) => {
      const isTarget = panel.id === panelId;
      if (isTarget) {
        panel.removeAttribute('aria-hidden');
        panel.style.display = 'block';
      } else {
        panel.setAttribute('aria-hidden', 'true');
        panel.style.display = 'none';
      }
    });

    if (isMobile()) {
      setMobileSidebarState(false);
    }
  }

  document.querySelectorAll('.nav-link[data-panel]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const panelId = link.dataset.panel;
      if (panelId) {
        showPanel(panelId);
      }
    });
  });

  initializePanels();

  const session = Auth.getSession();
  if (waiterNameElement) waiterNameElement.textContent = session?.username || 'Waiter';
  if (roleNameElement) roleNameElement.textContent = 'Waiter';

  async function getOrders() {
    const waiterName = String(session?.username || '').trim().toLowerCase();
    if (!waiterName) {
      return [];
    }
    const response = await fetchBackend(`/api/orders/all?waiterName=${encodeURIComponent(waiterName)}`);
    const orders = Array.isArray(response.orders) ? response.orders : [];
    return orders.filter((order) => getOrderWaiterName(order).toLowerCase() === waiterName);
  }

  async function refreshDashboard() {
    await loadBusinessDayCutoff();
    const orders = await getOrders();
    const waiterName = String(session?.username || '').trim().toLowerCase();
    const range = getBusinessDayRange(businessDayCutoff);

    const waiterOrders = (orders || [])
      .filter(order => getOrderWaiterName(order).toLowerCase() === waiterName)
      .filter(order => {
        const createdAt = order.createdAt || order.orderData?.createdAt || order.created_at || order.date || order.orderData?.order?.createdAt || order.orderData?.order?.created_at;
        const created = new Date(createdAt || '');
        return !Number.isNaN(created.getTime()) && created >= range.start && created < range.end;
      });

    currentWaiterOrders = waiterOrders;
    const pendingOrders = waiterOrders.filter(order => getOrderStatus(order) === 'pending');
    const todayRevenue = waiterOrders.reduce((sum, order) => {
      const amount = Number(order.totalAmount || order.subtotal || order.amount || 0);
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);

    if (pendingOrdersEl) pendingOrdersEl.textContent = String(pendingOrders.length);
    if (totalOrdersEl) totalOrdersEl.textContent = String(waiterOrders.length);
    if (revenueEl) revenueEl.textContent = `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(todayRevenue)}`;

    if (recentSalesBody) {
      if (!waiterOrders.length) {
        recentSalesBody.innerHTML = '<tr><td colspan="7" class="muted" style="padding:12px;text-align:center;">No sales yet.</td></tr>';
      } else {
        let total = 0;
        recentSalesBody.innerHTML = waiterOrders.slice(0, 8).map(order => {
          const createdAt = order.createdAt || order.orderData?.createdAt || order.created_at || order.date || order.orderData?.order?.createdAt || order.orderData?.order?.created_at;
          const created = new Date(createdAt || '');
          const time = isNaN(created.getTime()) ? 'Unknown' : created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const tableName = order.tableName || order.orderData?.tableName || order.orderData?.order?.tableName || 'N/A';
          const amount = Number(order.totalAmount || order.subtotal || order.amount || 0);
          total += amount;
          return `
            <tr>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${time}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${tableName}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${order.waiterName || order.waiter || 'N/A'}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${getOrderCashierName(order) || 'N/A'}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${(order.items || []).length}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${renderStatusBadge(getOrderStatus(order))}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);text-align:right;">₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</td>
            </tr>`;
        }).join('');
        if (recentSalesTotal) recentSalesTotal.textContent = `Total: ₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total)}`;
      }
    }
    renderPosOrderCards(currentWaiterOrders);
  }

  async function handleSharedOrderChange(event) {
    const detail = event?.detail || null;
    const shouldRefresh = event?.type === 'storage'
      ? event.key === 'restaurant:orders:refresh'
      : Boolean(detail || event);

    if (!shouldRefresh) return;
    try {
      await refreshDashboard();
    } catch (err) {
      console.warn('Failed to refresh waiter dashboard after shared order change:', err);
    }
  }

  window.addEventListener('restaurant:orders-changed', handleSharedOrderChange);
  window.addEventListener('storage', (event) => {
    if (event.key === 'restaurant:orders:refresh') {
      handleSharedOrderChange(event);
    }
  });

  const $ = (id) => document.getElementById(id);
  let currentWaiterOrders = [];
  let currentOrderStatusFilter = 'all';
  let realtimeRefreshTimer = null;
  const REALTIME_REFRESH_INTERVAL = 15000;

  function applyStatusFilter(orders) {
    if (!Array.isArray(orders)) return [];
    if (currentOrderStatusFilter === 'pending') {
      return orders.filter((order) => getOrderStatus(order) === 'pending');
    }
    if (currentOrderStatusFilter === 'completed') {
      return orders.filter((order) => getOrderStatus(order) === 'completed');
    }
    return orders;
  }

  function updateStatusTabActive(tabId) {
    ['pos-status-all', 'pos-status-pending', 'pos-status-completed'].forEach((id) => {
      const btn = $(id);
      if (btn) {
        btn.classList.toggle('active', id === tabId);
      }
    });
  }

  function bindStatusTabEvents() {
    const mapping = [
      ['pos-status-all', 'all'],
      ['pos-status-pending', 'pending'],
      ['pos-status-completed', 'completed']
    ];
    mapping.forEach(([id, filter]) => {
      const btn = $(id);
      if (btn) {
        btn.addEventListener('click', () => {
          currentOrderStatusFilter = filter;
          updateStatusTabActive(id);
          renderPosOrderCards(currentWaiterOrders);
        });
      }
    });
  }

  async function refreshWaiterRealtime() {
    try {
      await refreshDashboard();
    } catch (err) {
      console.warn('Failed to refresh waiter realtime dashboard:', err);
    }
  }

  function startWaiterRealtimeRefresh() {
    if (realtimeRefreshTimer) {
      clearInterval(realtimeRefreshTimer);
    }
    realtimeRefreshTimer = setInterval(refreshWaiterRealtime, REALTIME_REFRESH_INTERVAL);
  }

  await refreshDashboard();
  scheduleBusinessDayRefresh();
  bindStatusTabEvents();
  startWaiterRealtimeRefresh();

  const btnLogout = document.getElementById('btn-logout');
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
  if (btnLogout) {
    btnLogout.addEventListener('click', (ev) => {
      ev.preventDefault();
      showConfirmDialog({
        title: 'Logout confirmation',
        message: 'Are you sure you want to logout?',
        confirmText: 'Logout',
        cancelText: 'Stay logged in',
        onConfirm: () => { Auth.logout(); location.replace('index.html'); }
      });
    });
  }

  let waiterTables = [];
  let allCategories = [];
  let allSubcategories = [];
  let allProducts = [];
  let selectedTableId = null;
  let selectedCategoryId = null;
  let selectedSubcategoryId = null;
  let currentOrderItems = [];
  let currentOrderId = null;

  function normalizeTableList(tables) {
    const entries = [];
    if (Array.isArray(tables)) {
      entries.push(...tables.map((t) => String(t).trim()));
    } else if (typeof tables === 'string') {
      entries.push(...tables.split(',').map((t) => String(t).trim()));
    }
    const tableSet = new Set();
    entries.filter(Boolean).forEach((entry) => {
      const rangeMatch = entry.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        let start = Number(rangeMatch[1]);
        let end = Number(rangeMatch[2]);
        if (Number.isInteger(start) && Number.isInteger(end)) {
          if (start > end) [start, end] = [end, start];
          for (let table = start; table <= end; table += 1) {
            tableSet.add(String(table));
          }
          return;
        }
      }
      tableSet.add(entry);
    });
    return Array.from(tableSet);
  }

  function formatCurrency(value) {
    return `₦${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
  }

  async function loadWaiterTables() {
    waiterTables = [];
    try {
      if (!session?.id) return;
      const response = await fetchBackend(`/api/users/${encodeURIComponent(session.id)}`);
      if (response && response.success && response.user) {
        waiterTables = normalizeTableList(response.user.tables);
      }
    } catch (err) {
      console.warn('Failed to load waiter profile tables:', err);
      try {
        const localUser = await RestaurantDB.getUserById(Number(session?.id));
        if (localUser) {
          waiterTables = normalizeTableList(localUser.tables);
        }
      } catch (localErr) {
        console.warn('Failed to load local waiter tables:', localErr);
      }
    }
    renderAssignedTables();
  }

  async function loadInventoryData() {
    allCategories = [];
    allSubcategories = [];
    allProducts = [];
    try {
      const [catsRes, subsRes, prodsRes] = await Promise.all([
        fetchBackend('/api/categories'),
        fetchBackend('/api/subcategories'),
        fetchBackend('/api/products')
      ]);
      allCategories = catsRes.categories || [];
      allSubcategories = subsRes.subcategories || [];
      allProducts = prodsRes.products || [];
    } catch (err) {
      console.warn('Failed to load inventory from backend, falling back to local DB:', err);
      try {
        allCategories = await RestaurantDB.getAllCategories();
        allSubcategories = await RestaurantDB.getAllSubcategories();
        allProducts = await RestaurantDB.getAllProducts();
      } catch (localErr) {
        console.warn('Failed to load inventory from local DB:', localErr);
      }
    }
  }

  function renderAssignedTables() {
    const container = $('pos-assigned-tables');
    if (!container) return;
    if (!waiterTables || !waiterTables.length) {
      container.innerHTML = '<div class="pos-section-empty">No tables assigned to this waiter.</div>';
      return;
    }
    container.innerHTML = waiterTables.map((table) => `
      <span class="pos-chip table">${table}</span>
    `).join('');
  }

  function renderPosOrderCards(orders) {
    const container = $('pos-order-cards');
    if (!container) return;
    const filteredOrders = applyStatusFilter(orders);
    if (!filteredOrders || !filteredOrders.length) {
      container.innerHTML = '<div class="order-card" style="grid-column:1/-1;"><span class="order-card-title">No open orders</span><div class="muted">No orders match the selected status.</div></div>';
      return;
    }
    container.innerHTML = filteredOrders.map((order) => {
      const status = getOrderStatus(order);
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      return `
        <div class="order-card">
          <div class="order-card-header">
            <h4 class="order-card-title">Table ${order.tableName || 'N/A'}</h4>
            <span class="order-card-badge">${statusLabel}</span>
          </div>
          <div class="order-card-detail">
            <span class="order-card-label">Waiter:</span>
            <span class="order-card-value">${getOrderWaiterName(order) || 'N/A'}</span>
          </div>
          ${getOrderCashierName(order) ? `
          <div class="order-card-detail">
            <span class="order-card-label">Cashier:</span>
            <span class="order-card-value">${getOrderCashierName(order)}</span>
          </div>
          ` : ''}
          <div class="order-card-detail">
            <span class="order-card-label">Items:</span>
            <span class="order-card-value">${(order.items || []).length}</span>
          </div>
          <div class="order-card-detail">
            <span class="order-card-label">Total:</span>
            <span class="order-card-value">${formatCurrency(order.totalAmount)}</span>
          </div>
          <div class="order-card-actions" style="justify-content:flex-end;">
            <button type="button" class="btn btn-accent btn-update-order" data-order-id="${order.id}" style="border:none;">Update Order</button>
          </div>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.btn-update-order').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const orderId = btn.dataset.orderId;
        const orders = await getOrders();
        const order = orders.find((o) => String(o.id) === String(orderId));
        if (order) {
          await loadWaiterTables();
          await loadInventoryData();
          openOrderModal(order);
        }
      });
    });
  }

  function createModal(html) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('aria-hidden', 'false');
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-panel waiter-order-modal" role="dialog" aria-modal="true">
        ${html}
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
    modal.querySelectorAll('.modal-close').forEach((btn) => btn.addEventListener('click', close));
    return { modal, close };
  }

  function findProductById(productId) {
    return allProducts.find((product) => String(product.id) === String(productId)) || null;
  }

  function getOrderItem(productId) {
    return currentOrderItems.find((item) => String(item.productId) === String(productId));
  }

  function renderModalTableCards(modal) {
    const container = modal.querySelector('#modal-table-container');
    if (!container) return;
    if (!waiterTables.length) {
      container.innerHTML = '<div class="pos-section-empty">No assigned tables available.</div>';
      return;
    }
    if (currentOrderId && selectedTableId) {
      container.innerHTML = `
        <div class="pos-chip table selected" aria-disabled="true" style="cursor:default;">
          ${selectedTableId}
          <span class="muted" style="font-size:0.85rem;margin-left:8px;">Table locked for update</span>
        </div>
      `;
      return;
    }
    container.innerHTML = waiterTables.map((table) => `
      <button type="button" class="pos-chip table${String(selectedTableId) === String(table) ? ' selected' : ''}" data-table="${table}">
        <span class="pos-chip-label">${table}</span>
        ${String(selectedTableId) === String(table) ? '<span class="pos-chip-check">✓</span>' : ''}
      </button>
    `).join('');
    container.querySelectorAll('.pos-chip.table').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedTableId = btn.dataset.table;
        renderModalTableCards(modal);
      });
    });
  }

  function renderModalCategoryCards(modal) {
    const container = modal.querySelector('#modal-category-container');
    if (!container) return;
    if (!allCategories.length) {
      container.innerHTML = '<div class="pos-section-empty">No categories available.</div>';
      return;
    }
    container.innerHTML = allCategories.map((category) => {
      const active = String(selectedCategoryId) === String(category.id) ? ' selected' : '';
      const bg = category.color ? `${category.color}22` : '#eef2ff';
      const border = category.color || '#38bdf8';
      return `
        <button type="button" class="pos-chip category${active}" data-category="${category.id}" style="background:${bg};border-color:${border};color:${category.color || '#1d4ed8'};">
          <span class="pos-chip-label">${category.name}</span>
          ${active ? '<span class="pos-chip-check">✓</span>' : ''}
        </button>
      `;
    }).join('');
    container.querySelectorAll('.pos-chip.category').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCategoryId = btn.dataset.category;
        selectedSubcategoryId = null;
        renderModalCategoryCards(modal);
        renderModalSubcategoryCards(modal);
        renderModalProductCards(modal);
      });
    });
  }

  function renderModalSubcategoryCards(modal) {
    const container = modal.querySelector('#modal-subcategory-container');
    if (!container) return;
    if (!selectedCategoryId) {
      container.innerHTML = '<div class="pos-section-empty">Select a category first.</div>';
      return;
    }
    const matches = allSubcategories.filter((sub) => String(sub.parent) === String(selectedCategoryId));
    if (!matches.length) {
      container.innerHTML = '<div class="pos-section-empty">No subcategories found for this category.</div>';
      return;
    }
    container.innerHTML = matches.map((sub) => {
      const active = String(selectedSubcategoryId) === String(sub.id) ? ' selected' : '';
      const bg = sub.color ? `${sub.color}22` : '#ecfeff';
      const border = sub.color || '#2dd4bf';
      return `
        <button type="button" class="pos-chip category${active}" data-subcategory="${sub.id}" style="background:${bg};border-color:${border};color:${sub.color || '#0f766e'};">
          <span class="pos-chip-label">${sub.name}</span>
          ${active ? '<span class="pos-chip-check">✓</span>' : ''}
        </button>
      `;
    }).join('');
    container.querySelectorAll('.pos-chip.category').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSubcategoryId = btn.dataset.subcategory;
        renderModalSubcategoryCards(modal);
        renderModalProductCards(modal);
      });
    });
  }

  function renderModalProductCards(modal) {
    const container = modal.querySelector('#modal-product-container');
    if (!container) return;
    if (!selectedSubcategoryId) {
      container.innerHTML = '<div class="pos-section-empty">Select a subcategory to view products.</div>';
      return;
    }
    const matches = allProducts.filter((product) => String(product.sub) === String(selectedSubcategoryId));
    if (!matches.length) {
      container.innerHTML = '<div class="pos-section-empty">No products available for this subcategory.</div>';
      return;
    }
    container.innerHTML = matches.map((product) => {
      const existing = getOrderItem(product.id);
      const active = existing ? ' selected' : '';
      const color = product.color || '#c7d2fe';
      return `
        <button type="button" class="pos-product-card${active}" data-product="${product.id}" style="border-left:4px solid ${color};">
          <div class="pos-product-name">${product.name}</div>
          ${existing ? '<span class="pos-product-selected">✓</span>' : ''}
        </button>
      `;
    }).join('');
    container.querySelectorAll('.pos-product-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const productId = btn.dataset.product;
        addProductToOrder(productId);
        renderModalProductCards(modal);
        renderModalOrderItems(modal);
      });
    });
  }

  function renderModalOrderItems(modal) {
    const container = modal.querySelector('#modal-order-items');
    const message = modal.querySelector('#modal-order-message');
    if (!container) return;
    if (!currentOrderItems.length) {
      container.innerHTML = '<div class="pos-section-empty">No products added yet. Click a product to add it to this order.</div>';
      if (message) message.textContent = 'Add at least one product to place the order.';
      return;
    }
    const totalAmount = currentOrderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    container.innerHTML = currentOrderItems.map((item) => {
      const lineTotal = item.price * item.quantity;
      return `
      <div class="order-item-row">
        <div class="order-item-details">
          <div class="item-name">${item.name}</div>
          <div class="item-meta">${item.quantity} × ${formatCurrency(item.price)}${item.isExisting ? ' • original' : ''}</div>
        </div>
        <div class="order-item-right">
          <div class="item-total">${formatCurrency(lineTotal)}</div>
          ${item.isExisting ? '' : `
          <div class="order-item-actions">
            <button type="button" class="btn btn-ghost order-item-decrease" data-id="${item.productId}">-</button>
            <button type="button" class="btn btn-ghost order-item-increase" data-id="${item.productId}">+</button>
            <button type="button" class="btn btn-ghost order-item-remove" data-id="${item.productId}">✕</button>
          </div>
          `}
        </div>
      </div>
    `;
    }).join('');
    container.innerHTML += `
      <div class="order-summary-total">
        <span>Order Total</span>
        <strong>${formatCurrency(totalAmount)}</strong>
      </div>
    `;
    if (message) message.textContent = '';
    const decreaseButtons = modal.querySelectorAll('.order-item-decrease');
    decreaseButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const item = getOrderItem(id);
        if (item && !item.isExisting) {
          item.quantity = Math.max(1, item.quantity - 1);
          renderModalOrderItems(modal);
          renderModalProductCards(modal);
        }
      });
    });
    const increaseButtons = modal.querySelectorAll('.order-item-increase');
    increaseButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const item = getOrderItem(id);
        if (item && !item.isExisting) {
          item.quantity += 1;
          renderModalOrderItems(modal);
        }
      });
    });
    const removeButtons = modal.querySelectorAll('.order-item-remove');
    removeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        currentOrderItems = currentOrderItems.filter((i) => String(i.productId) !== String(id) || i.isExisting);
        renderModalOrderItems(modal);
        renderModalProductCards(modal);
      });
    });
  }

  function addProductToOrder(productId) {
    const product = findProductById(productId);
    if (!product) return;
    const existing = getOrderItem(productId);
    if (existing && !existing.isExisting) {
      existing.quantity += 1;
    } else if (existing && existing.isExisting) {
      currentOrderItems.push({
        productId: product.id,
        name: product.name,
        price: Number(product.price || 0),
        quantity: 1,
        isExisting: false
      });
    } else {
      currentOrderItems.push({
        productId: product.id,
        name: product.name,
        price: Number(product.price || 0),
        quantity: 1,
        isExisting: false
      });
    }
  }

  function renderOrderModal(modal) {
    renderModalTableCards(modal);
    renderModalCategoryCards(modal);
    renderModalSubcategoryCards(modal);
    renderModalProductCards(modal);
    renderModalOrderItems(modal);
  }

  function printReceipt(order) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const itemsHtml = (order.items || []).map((item) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.price)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.price * item.quantity)}</td>
      </tr>
    `).join('');
    const html = `
      <html>
        <head>
          <title>Receipt</title>
          <style>
            body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111827;}
            h1,h2{margin:0 0 16px 0;}
            table{width:100%;border-collapse:collapse;margin-top:16px;}
            th,td{padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;}
            .summary{margin-top:18px;display:flex;justify-content:space-between;font-weight:700;}
          </style>
        </head>
        <body>
          <h1>Receipt</h1>
          <div><strong>Table:</strong> ${order.tableName || 'N/A'}</div>
          <div><strong>Customer:</strong> ${order.customerName || 'Walk-in'}</div>
          <div><strong>Waiter:</strong> ${order.waiterName || ''}</div>
          <div style="margin-top:12px;"><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</div>
          <table>
            <thead>
              <tr><th>Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit</th><th style="text-align:right;">Total</th></tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="summary"><span>Total</span><span>${formatCurrency(order.totalAmount)}</span></div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function saveOrderToBackend(orderData, orderId = null) {
    const finalOrderId = orderId || `waiter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalAmount = currentOrderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const now = new Date().toISOString();
    const orderPayload = {
      id: finalOrderId,
      waiterName: session?.username || 'Waiter',
      customerName: orderData.customerName || null,
      tableName: orderData.tableName,
      status: 'pending',
      items: currentOrderItems.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      })),
      totalAmount,
      createdAt: now,
      updatedAt: now
    };

    if (typeof fetchBackend !== 'function') {
      throw new Error('backend_unavailable');
    }

    const terminalId = `waiter-${String(session?.username || 'waiter')}`;
    await fetchBackend('/api/orders/sync', {
      method: 'POST',
      body: JSON.stringify({ terminalId, orders: [orderPayload], lastSyncTime: new Date(0).toISOString() })
    });
    return orderPayload;
  }

  function openOrderModal(order = null) {
    currentOrderId = order?.id || null;
    selectedTableId = order?.tableName || null;
    selectedCategoryId = null;
    selectedSubcategoryId = null;
    currentOrderItems = Array.isArray(order?.items) ? order.items.map((item) => ({
      productId: item.productId,
      name: item.name || item.productName || item.product?.name || 'Unknown',
      price: Number(item.price ?? item.unitPrice ?? item.product?.price ?? 0),
      quantity: Number(item.quantity || 1),
      isExisting: true
    })) : [];

    const headerText = order ? 'Update Order' : 'Create Order';
    const buttonText = order ? 'Update Order' : 'Place Order';

    const { modal, close } = createModal(`
      <header class="modal-header">
        <h3>${headerText}</h3>
        <button type="button" class="modal-close" aria-label="Close">✕</button>
      </header>
      <div class="modal-body" style="display:grid;gap:16px;max-height:70vh;overflow:auto;">
        <div class="field">
          <label class="label" for="order-customer-name">Customer Name (optional)</label>
          <input id="order-customer-name" type="text" class="input" placeholder="Customer name" />
        </div>
        <div class="field">
          <label class="label">Select Table</label>
          <div id="modal-table-container" class="pos-list"></div>
        </div>
        <div class="field">
          <label class="label">Categories</label>
          <div id="modal-category-container" class="pos-list"></div>
        </div>
        <div class="field">
          <label class="label">Subcategories</label>
          <div id="modal-subcategory-container" class="pos-list"></div>
        </div>
        <div class="field">
          <label class="label">Products</label>
          <div class="modal-section-box">
            <div id="modal-product-container" class="order-products-grid"></div>
          </div>
        </div>
        <div class="field">
          <label class="label">Order Summary & Breakdown</label>
          <div id="modal-order-items"></div>
          <div id="modal-order-message" class="muted" style="margin-top:8px;font-size:0.95rem;">Add at least one product to place the order.</div>
        </div>
      </div>
      <footer class="modal-footer" style="display:flex;justify-content:flex-end;align-items:center;gap:12px;padding-top:12px;">
        <button type="button" id="btn-modal-place-order" class="btn btn-primary">${buttonText}</button>
      </footer>
    `);

    renderOrderModal(modal);
    if (order && modal.querySelector('#order-customer-name')) {
      modal.querySelector('#order-customer-name').value = order.customerName || '';
    }

    const placeOrderButton = modal.querySelector('#btn-modal-place-order');
    placeOrderButton?.addEventListener('click', async () => {
      const customerName = modal.querySelector('#order-customer-name')?.value.trim();
      const tableName = selectedTableId;
      if (!tableName) {
        showToast('Please select a table.', 'error', 2600);
        return;
      }
      if (!currentOrderItems.length) {
        showToast('Please add at least one product to the order.', 'error', 2600);
        return;
      }
      if (placeOrderButton.disabled) return;
      placeOrderButton.disabled = true;
      placeOrderButton.classList.add('btn-disabled');
      try {
        const orderPayload = await saveOrderToBackend({ customerName, tableName }, currentOrderId);
        printReceipt(orderPayload);
        close();
        await refreshDashboard();
        showToast(`${order ? 'Order updated' : 'Order created'} successfully.`, 'success', 2600);
      } catch (err) {
        console.error('Failed to save order:', err);
        showToast('Failed to create order: ' + err.message, 'error', 3200);
      } finally {
        if (placeOrderButton) {
          placeOrderButton.disabled = false;
          placeOrderButton.classList.remove('btn-disabled');
        }
      }
    });
  }

  function openCreateOrderModal() {
    openOrderModal();
  }

  const createOrderButton = $('btn-create-order');
  if (createOrderButton) {
    createOrderButton.addEventListener('click', async () => {
      await loadWaiterTables();
      await loadInventoryData();
      openCreateOrderModal();
    });
  }

  const quickCreateOrder = $('btn-qa-create-order');
  if (quickCreateOrder) {
    quickCreateOrder.addEventListener('click', async () => {
      await loadWaiterTables();
      await loadInventoryData();
      openCreateOrderModal();
    });
  }

  await loadWaiterTables();
  await loadInventoryData();
})();
