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
  } else if (type === 'warning') {
    toast.style.backgroundColor = '#fef3c7';
    toast.style.color = '#92400e';
    toast.style.border = '1px solid #fcd34d';
    toast.textContent = '⚠️ ' + message;
  } else if (type === 'info') {
    toast.style.backgroundColor = '#dbeafe';
    toast.style.color = '#1e40af';
    toast.style.border = '1px solid #93c5fd';
    toast.textContent = 'ℹ ' + message;
  }

  let container = document.getElementById('cashier-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'cashier-toast-container';
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
  if (!document.getElementById('toast-animation-style-cashier')) {
    style.id = 'toast-animation-style-cashier';
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

// cashier page logic: show login form if not authenticated, otherwise show cashier dashboard
(async function(){
  console.log('cashier.js: IIFE started');
  let s = null; // Declare session variable outside try block so it's accessible later
  const API_BASE_URL = (() => {
    try {
      if (window.location.protocol.startsWith('http')) {
        return `${window.location.protocol}//${window.location.host}`;
      }
    } catch (e) {
      // fallback for file://
    }
    return 'http://localhost:3000';
  })();

  async function fetchBackend(path, options = {}) {
    const url = `${API_BASE_URL}${path}`;
    try {
      const response = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body && body.error ? body.error : response.statusText || 'backend_error';
        throw new Error(message);
      }
      return response.json();
    } catch (err) {
      if (err.name === 'TypeError') {
        throw new Error('backend_unreachable');
      }
      throw err;
    }
  }

  let businessDayCutoff = '00:00';
  let businessDayRefreshTimer = null;
  let cashierRealtimeRefreshTimer = null;
  const REALTIME_REFRESH_INTERVAL = 15000;
  let stockCountEnabled = false;
  let receiptSettings = {
    businessName: '',
    address: '',
    phone: '',
    email: '',
    footerMessage: ''
  };

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

  function getPreviousBusinessDayRange(cutoff = '00:00', reference = new Date()) {
    const currentRange = getBusinessDayRange(cutoff, reference);
    const start = new Date(currentRange.start);
    start.setDate(start.getDate() - 1);
    const end = new Date(currentRange.start);
    return { start, end };
  }

  function filterBusinessDayOrders(orders) {
    const range = getBusinessDayRange(businessDayCutoff, new Date());
    return (orders || []).filter(order => {
      const created = getOrderCreatedAt(order);
      return !Number.isNaN(created.getTime()) && created >= range.start && created < range.end;
    });
  }

  function filterPreviousBusinessDayOrders(orders) {
    const range = getPreviousBusinessDayRange(businessDayCutoff, new Date());
    return (orders || []).filter(order => {
      const created = getOrderCreatedAt(order);
      return !Number.isNaN(created.getTime()) && created >= range.start && created < range.end;
    });
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
        await loadAndRenderOrders();
        showToast('Business day boundary reached. Dashboard refreshed for current business day.', 'info', 2500);
      } catch (err) {
        console.error('Failed to refresh cashier dashboard on business day boundary:', err);
      } finally {
        scheduleBusinessDayRefresh();
      }
    }, delay);
  }

  function startCashierRealtimeRefresh() {
    if (cashierRealtimeRefreshTimer) {
      clearInterval(cashierRealtimeRefreshTimer);
    }
    cashierRealtimeRefreshTimer = setInterval(async () => {
      try {
        await loadAndRenderOrders();
      } catch (err) {
        console.warn('Failed to refresh cashier realtime dashboard:', err);
      }
    }, REALTIME_REFRESH_INTERVAL);
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
      }
    } catch (err) {
      console.warn('Failed to load receipt settings:', err);
    }
  }

  async function isBackendAvailable() {
    try {
      const response = await fetchBackend('/health');
      return response && response.status === 'ok';
    } catch (err) {
      console.warn('cashier.js: backend unavailable', err);
      return false;
    }
  }

  async function getTerminalConfig() {
    try {
      const response = await fetchBackend('/api/settings/terminal-config');
      return response?.config || null;
    } catch (err) {
      return null;
    }
  }

  function getCurrentCashierName() {
    return (fullName && String(fullName).trim())
      ? String(fullName).trim()
      : (s?.fullName && String(s.fullName).trim())
        ? String(s.fullName).trim()
        : (s?.username || 'Cashier');
  }

  function normalizeOrderForBackend(orderData) {
    if (!orderData || typeof orderData !== 'object') return orderData;
    const cashierName = orderData.cashierName || orderData.cashier || orderData.createdBy || getCurrentCashierName();
    const now = new Date().toISOString();
    return {
      ...orderData,
      cashierName,
      cashier: cashierName,
      createdBy: orderData.createdBy || cashierName,
      createdAt: orderData.createdAt || now,
      updatedAt: orderData.updatedAt || orderData.createdAt || now
    };
  }

  function parsePotentialOrderJson(value) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch (err) {
      return value;
    }
  }

  function getNestedOrderProperty(order, paths) {
    if (!order || !Array.isArray(paths)) return null;
    for (const path of paths) {
      const parts = String(path).split('.');
      let current = order;
      for (const part of parts) {
        if (current === undefined || current === null) {
          current = null;
          break;
        }
        if (typeof current === 'string') {
          current = parsePotentialOrderJson(current);
        }
        current = current[part];
      }
      if (current !== undefined && current !== null) {
        return current;
      }
    }
    return null;
  }

  function getOrderCreatedAt(order) {
    const rawCreated = getNestedOrderProperty(order, [
      'createdAt',
      'created_at',
      'order.createdAt',
      'order.created_at',
      'orderData.createdAt',
      'orderData.created_at',
      'order.orderData.createdAt',
      'order.orderData.created_at',
      'order.order_data.createdAt',
      'order.order_data.created_at'
    ]);
    return rawCreated ? new Date(rawCreated) : new Date(NaN);
  }

  function getOrderUpdatedAt(order) {
    const rawUpdated = getNestedOrderProperty(order, [
      'updatedAt',
      'updated_at',
      'order.updatedAt',
      'order.updated_at',
      'orderData.updatedAt',
      'orderData.updated_at',
      'order.orderData.updatedAt',
      'order.orderData.updated_at',
      'order.order_data.updatedAt',
      'order.order_data.updated_at'
    ]);
    return rawUpdated ? new Date(rawUpdated) : new Date(NaN);
  }

  function isOrderUnmodified(order) {
    const created = getOrderCreatedAt(order);
    const updated = getOrderUpdatedAt(order);
    const status = getOrderStatus(order);

    if (['completed', 'closed', 'cancelled', 'canceled'].includes(status)) {
      return false;
    }

    const hasExplicitUpdate = order && (
      order.updatedAt ||
      order.updated_at ||
      order.orderData?.updatedAt ||
      order.orderData?.updated_at ||
      order.order?.updatedAt ||
      order.order?.updated_at ||
      order.order_data?.updatedAt ||
      order.order_data?.updated_at
    );

    if (!hasExplicitUpdate && !order?.createdAt && !order?.created_at) {
      return true;
    }

    if (Number.isNaN(created.getTime()) && Number.isNaN(updated.getTime())) {
      return true;
    }

    if (Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) {
      return true;
    }

    return created.getTime() === updated.getTime();
  }

  function canDeleteOrder(order) {
    if (!order || typeof order !== 'object') return false;
    if (order.allowCashierDelete === false || String(order.allowCashierDelete).toLowerCase() === 'false') {
      return false;
    }
    return isOrderUnmodified(order);
  }

  function normalizeLoadedOrder(order) {
    if (!order || typeof order !== 'object') return order;
    const now = new Date().toISOString();
    const createdAtValue = getNestedOrderProperty(order, [
      'createdAt',
      'created_at',
      'order.createdAt',
      'order.created_at',
      'orderData.createdAt',
      'orderData.created_at',
      'order.orderData.createdAt',
      'order.orderData.created_at',
      'order.order_data.createdAt',
      'order.order_data.created_at'
    ]) || now;
    const updatedAtValue = getNestedOrderProperty(order, [
      'updatedAt',
      'updated_at',
      'order.updatedAt',
      'order.updated_at',
      'orderData.updatedAt',
      'orderData.updated_at',
      'order.orderData.updatedAt',
      'order.orderData.updated_at',
      'order.order_data.updatedAt',
      'order.order_data.updated_at'
    ]) || createdAtValue;

    return {
      ...order,
      createdAt: order.createdAt || createdAtValue,
      updatedAt: order.updatedAt || updatedAtValue
    };
  }

  async function mergeBackendOrderUpdates(updates = [], fallbackOrder = null) {
    try {
      if (!Array.isArray(updates) || updates.length === 0) return;
      updates.forEach(u => {
        if (!u) return;
        let idx = -1;
        if (u.id) {
          idx = (allOrdersCache || []).findIndex(o => String(o.id) === String(u.id));
        }
        if (idx === -1 && u.tableName) {
          idx = (allOrdersCache || []).findIndex(o => tablesMatch(o.tableName, u.tableName));
        }
        if (idx === -1 && fallbackOrder && fallbackOrder.tableName) {
          idx = (allOrdersCache || []).findIndex(o => tablesMatch(o.tableName, fallbackOrder.tableName));
        }
        if (idx >= 0) {
          allOrdersCache[idx] = { ...allOrdersCache[idx], ...u };
        } else {
          allOrdersCache.push(u);
        }

        if (editingOrderId && u.tableName && fallbackOrder && tablesMatch(u.tableName, fallbackOrder.tableName)) {
          editingOrderId = u.id || editingOrderId;
        }
      });
    } catch (mergeErr) {
      console.warn('Failed to merge backend order updates:', mergeErr);
    }
  }

  async function syncOrdersToBackend(orders = []) {
    if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
    const terminalConfig = await getTerminalConfig();
    const terminalId = terminalConfig?.terminalId || (s?.username || 'cashier-terminal');
    const normalizedOrders = (orders || []).map(normalizeOrderForBackend);
    const resp = await fetchBackend('/api/orders/sync', {
      method: 'POST',
      body: JSON.stringify({ terminalId, orders: normalizedOrders, lastSyncTime: new Date(0).toISOString() })
    });

    const updates = resp && Array.isArray(resp.updates) ? resp.updates : [];
    await mergeBackendOrderUpdates(updates, normalizedOrders[0]);
    return updates;
  }

  async function deleteOrderFromBackend(orderId) {
    if (!orderId) return;
    if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
    await fetchBackend('/api/orders/delete', {
      method: 'POST',
      body: JSON.stringify({ id: orderId })
    });
    if (Array.isArray(allOrdersCache)) {
      allOrdersCache = allOrdersCache.filter(o => String(o.id) !== String(orderId));
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('restaurant:orders:refresh', String(Date.now()));
      }
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('restaurant:orders-changed', { detail: { action: 'delete', orderId } }));
      }
    } catch (err) {
      console.warn('Failed to notify other POS views about deleted order', err);
    }
  }

  async function saveOrderToBackend(orderData) {
    const normalizedOrder = normalizeOrderForBackend(orderData);
    const updates = await syncOrdersToBackend([normalizedOrder]);
    return updates[0] || null;
  }

  let BACKEND_AVAILABLE = false;

  try {
    BACKEND_AVAILABLE = await isBackendAvailable();
    await loadBusinessDayCutoff();
    await loadReceiptSettings();
    console.log('cashier.js: BACKEND_AVAILABLE =', BACKEND_AVAILABLE);

    s = Auth.getSession();
    console.log('cashier.js: Auth session retrieved:', s);
    if(!s || (s.role !== 'cashier' && s.role !== 'waiter')){
      // redirect to login if not a cashier or waiter
      console.log('cashier.js: Not authenticated or not an allowed role, redirecting');
      location.replace('index.html');
      return;
    }
    console.log('cashier.js: User authenticated as cashier/waiter, proceeding');
  } catch (e) {
    console.error('cashier.js: Fatal error in initialization:', e);
    alert('Fatal error initializing cashier page: ' + e.message);
    throw e;
  }

  // authenticated cashier: wire nav, logout, change password
  const nameEl = document.getElementById('cashier-name');
  const avatarEl = document.getElementById('cashier-avatar');
  const roleEl = document.getElementById('cashier-role');

  function refreshCashierSidebar(sessionData) {
    const profile = sessionData || Auth.getSession();
    if (!profile) return;
    const fullNameValue = String(profile.fullName || profile.username || 'Cashier').trim();
    const roleValue = String(profile.role || 'cashier').trim();
    if (nameEl) nameEl.textContent = fullNameValue;
    if (roleEl) roleEl.textContent = roleValue.charAt(0).toUpperCase() + roleValue.slice(1).toLowerCase();
    if (avatarEl) avatarEl.textContent = fullNameValue.charAt(0).toUpperCase() || 'C';
  }

  refreshCashierSidebar(s);
  const logoutBtn = document.getElementById('btn-logout');
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
  const settingsBtn = document.getElementById('btn-settings');

  // Initialize panels on page load - restore last active panel or show dashboard
  function initializePanels(){
    const panels = Array.from(document.querySelectorAll('.panel'));
    document.querySelectorAll('.panel').forEach(p => {
      p.setAttribute('aria-hidden', 'true');
      p.style.display = 'none';
    });
    const savedPanel = localStorage.getItem('cashier-active-panel');
    const panelToShow = savedPanel && panels.some((panel) => panel.id === savedPanel)
      ? document.getElementById(savedPanel)
      : document.getElementById('dashboard');
    if(panelToShow){
      panelToShow.removeAttribute('aria-hidden');
      panelToShow.style.display = 'block';
      document.querySelectorAll('.nav-link').forEach(n=> n.classList.toggle('active', n.dataset.panel === panelToShow.id));
    }
  }
  initializePanels();
  console.log('cashier.js: Panels initialized');

  // nav panel switching (same as admin)
  document.querySelectorAll('.nav-link[data-panel]').forEach(a=> a.addEventListener('click', e=>{
    e.preventDefault();
    const panel = a.dataset.panel;
    document.querySelectorAll('.nav-link').forEach(n=>n.classList.remove('active'));
    a.classList.add('active');
    localStorage.setItem('cashier-active-panel', panel);
    document.querySelectorAll('.panel').forEach(p=>{ p.setAttribute('aria-hidden','true'); p.style.display='none'; });
    const target = document.getElementById(panel);
    if(target){ target.removeAttribute('aria-hidden'); target.style.display='block'; }
  }));
  if(settingsBtn){
    settingsBtn.addEventListener('click', ()=>{
      document.querySelectorAll('.nav-link').forEach(n=>n.classList.remove('active'));
      const settingsLink = document.querySelector('.nav-link[data-panel="settings"]');
      if(settingsLink) settingsLink.classList.add('active');
      document.querySelectorAll('.panel').forEach(p=>{ p.setAttribute('aria-hidden','true'); p.style.display='none'; });
      const settingsPanel = document.getElementById('settings');
      if(settingsPanel){ settingsPanel.removeAttribute('aria-hidden'); settingsPanel.style.display='block'; }
    });
  }
  console.log('cashier.js: Nav links wired');

  // Sidebar expand/retract behavior (hover to expand, leave to retract)
  (function wireSidebarExpand(){
    const splitEl = document.querySelector('.split');
    const sidebarEl = document.querySelector('.sidebar-card');
    if(!splitEl || !sidebarEl) return;
    let t = null;
    const expand = ()=>{
      if(t) clearTimeout(t);
      splitEl.classList.add('sidebar-expanded');
      sidebarEl.classList.add('expanded');
    };
    const collapse = ()=>{
      if(t) clearTimeout(t);
      t = setTimeout(()=>{
        splitEl.classList.remove('sidebar-expanded');
        sidebarEl.classList.remove('expanded');
      }, 180);
    };
    sidebarEl.addEventListener('mouseenter', expand);
    sidebarEl.addEventListener('mouseleave', collapse);
    splitEl.addEventListener('mouseleave', collapse);
    const avatar = document.getElementById('cashier-avatar');
    if(avatar) avatar.addEventListener('click', ()=>{
      const expanded = splitEl.classList.toggle('sidebar-expanded');
      if(expanded) sidebarEl.classList.add('expanded'); else sidebarEl.classList.remove('expanded');
    });
  })();

  // Dashboard quick actions
  const btnQuickCreateOrder = document.getElementById('btn-quick-create-order');
  const btnQuickGoPos = document.getElementById('btn-quick-go-pos');
  const btnQuickRefreshDashboard = document.getElementById('btn-quick-refresh-dashboard');
  const btnQaCreateOrder = document.getElementById('btn-qa-create-order');
  const btnQaViewSales = document.getElementById('btn-qa-view-sales');
  const btnQaViewReport = document.getElementById('btn-qa-view-report');
  const goToPosPanel = () => {
    const posLink = document.querySelector('.nav-link[data-panel="pos"]');
    if(posLink){
      posLink.click();
    }
  };
  const goToSalesPanel = () => {
    const salesLink = document.querySelector('.nav-link[data-panel="sales"]');
    if(salesLink){
      salesLink.click();
    }
  };
  if(btnQuickGoPos){
    btnQuickGoPos.addEventListener('click', goToPosPanel);
  }
  if(btnQuickCreateOrder){
    btnQuickCreateOrder.addEventListener('click', () => {
      goToPosPanel();
      setTimeout(() => openOrderModal(), 30);
    });
  }
  if(btnQaCreateOrder){
    btnQaCreateOrder.addEventListener('click', () => {
      goToPosPanel();
      setTimeout(() => openOrderModal(), 30);
    });
  }
  if(btnQaViewSales){
    btnQaViewSales.addEventListener('click', () => {
      goToSalesPanel();
    });
  }
  if(btnQaViewReport){
    btnQaViewReport.addEventListener('click', () => {
      goToPosPanel();
      setTimeout(() => {
        const reportCard = document.getElementById('stat-total-revenue');
        if(reportCard){
          reportCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          reportCard.style.transition = 'box-shadow 0.25s ease';
          reportCard.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.28)';
          setTimeout(() => { reportCard.style.boxShadow = ''; }, 900);
        }
      }, 80);
    });
  }
  if(btnQuickRefreshDashboard){
    btnQuickRefreshDashboard.addEventListener('click', async () => {
      await loadAndRenderOrders();
      showToast('Dashboard summary refreshed', 'success', 1800);
    });
  }

  // change password form
  const profileForm = document.getElementById('profile-settings-form');
  const profileFullName = document.getElementById('profile-full-name');
  const profileUsername = document.getElementById('profile-username');
  const profileCurrentPassword = document.getElementById('profile-current-password');
  const profileNewPassword = document.getElementById('profile-new-password');
  const profileNewPasswordConfirm = document.getElementById('profile-new-password-confirm');
  const profileMessage = document.getElementById('profile-settings-message');

  if(profileFullName) profileFullName.value = s.fullName || s.username || '';
  if(profileUsername) profileUsername.value = s.username || '';

  if(profileForm){
    profileForm.addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      try {
        const fullName = String(profileFullName?.value || '').trim();
        const username = String(profileUsername?.value || '').trim();
        const currentPassword = String(profileCurrentPassword?.value || '');
        const newPassword = String(profileNewPassword?.value || '');
        const confirmPassword = String(profileNewPasswordConfirm?.value || '');

        if (!fullName || !username) {
          throw new Error('Please enter both full name and username.');
        }

        if (currentPassword || newPassword || confirmPassword) {
          if (!currentPassword) throw new Error('Current password is required to change password.');
          if (!newPassword) throw new Error('New password is required.');
          if (newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
          if (newPassword !== confirmPassword) throw new Error('New password and confirmation do not match.');
          await Auth.changePassword(currentPassword, newPassword);
        }

        const payload = {
          id: String(s.id),
          username,
          role: s.role || 'cashier',
          fullName,
          status: s.status || 'active',
          tables: []
        };
        const response = await fetchBackend('/api/users/update', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!response || response.success !== true) {
          throw new Error(response?.error || 'Could not save profile.');
        }

        Auth.updateSession({ username, fullName, status: s.status || 'active' });
        s = Auth.getSession() || s;
        refreshCashierSidebar(s);
        if (profileCurrentPassword) profileCurrentPassword.value = '';
        if (profileNewPassword) profileNewPassword.value = '';
        if (profileNewPasswordConfirm) profileNewPasswordConfirm.value = '';
        if (profileMessage) {
          profileMessage.textContent = 'Profile saved successfully.';
          profileMessage.style.color = '#166534';
        }
      } catch (err) {
        if (profileMessage) {
          profileMessage.textContent = 'Error: ' + err.message;
          profileMessage.style.color = '#991b1b';
        } else {
          alert('Change failed: ' + err.message);
        }
      }
    });
  }
  console.log('cashier.js: Profile form wired');

  // ============================================
  // POS (Point of Sale) Functionality
  // ============================================

  // State management for current order being created
  let currentOrderItems = [];
  let originalOrderItems = []; // Track original items when editing
  let allProducts = [];
  let allWaiters = [];
  let allEvents = [];
  let allCategories = [];
  let allSubcategories = [];
  let allOrdersCache = [];
  let selectedEventId = null;
  let editingOrderId = null;
  let editingOrder = null;
  let originalModalHTML = null; // Store original order form HTML for restoration
  let billingSettings = { taxPercentage: 0, serviceChargePercentage: 0, discountPercentage: 0 }; // Billing settings from admin
  let currentVoidedItems = []; // Track voided items in current order
  let currentVoidRemark = ''; // Track void remark

  // Load products and waiters
  function normalizeTableList(tables){
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

  async function loadPOSData(){
    try {
      if (!BACKEND_AVAILABLE) {
        throw new Error('backend_unavailable');
      }
      const [productsRes, usersRes, eventsRes, categoriesRes, subcategoriesRes] = await Promise.all([
        fetchBackend('/api/products'),
        fetchBackend('/api/users/list'),
        fetchBackend('/api/events'),
        fetchBackend('/api/categories'),
        fetchBackend('/api/subcategories')
      ]);
      allProducts = productsRes.products || [];
      allWaiters = (usersRes.users || []).filter(u => u.role === 'waiter').map(w => ({
        ...w,
        tables: normalizeTableList(w.tables)
      }));
      allEvents = eventsRes.events || [];
      allCategories = categoriesRes.categories || [];
      allSubcategories = subcategoriesRes.subcategories || [];
      resetOrderModalSelectors();
      populateEventSelect();
      renderActiveEventCard();
      // update dashboard stats once products/waiters are loaded
      try{ updateDashboardStats(); }catch(e){}
    } catch (err) {
      console.error('Failed to load POS data:', err);
    }
  }
  
  // Capture original modal HTML for restoration
  function captureOriginalModalHTML(){
    const modal = document.getElementById('order-modal');
    if (modal) {
      const modalPanel = modal.querySelector('.modal-panel');
      if (modalPanel) {
        originalModalHTML = modalPanel.innerHTML;
      }
    }
  }

  // Load billing settings from database
  async function loadBillingSettings(){
    try {
      const [taxSetting, serviceSetting, discountSetting] = await Promise.all([
        fetchBackend('/api/settings/tax'),
        fetchBackend('/api/settings/service-charge'),
        fetchBackend('/api/settings/discount')
      ]);

      billingSettings.taxPercentage = taxSetting ? parseFloat(taxSetting.value) || 0 : 0;
      billingSettings.serviceChargePercentage = serviceSetting ? parseFloat(serviceSetting.value) || 0 : 0;
      billingSettings.discountPercentage = discountSetting ? parseFloat(discountSetting.value) || 0 : 0;

      console.log('Billing settings loaded:', billingSettings);
    } catch (err) {
      console.error('Failed to load billing settings:', err);
      billingSettings = { taxPercentage: 0, serviceChargePercentage: 0, discountPercentage: 0 };
    }
  }

  async function loadStockCountSetting(){
    try {
      if (typeof RestaurantDB !== 'undefined' && RestaurantDB && typeof RestaurantDB.getSetting === 'function') {
        const stockSetting = await RestaurantDB.getSetting('enableStockCount');
        stockCountEnabled = stockSetting ? (stockSetting.value === true || stockSetting.value === 'true') : false;
      } else if (BACKEND_AVAILABLE) {
        const response = await fetchBackend('/api/settings/stock-count');
        stockCountEnabled = response && response.success ? (response.value === true || response.value === 'true') : false;
      } else {
        stockCountEnabled = false;
      }
      console.log('Stock count enabled:', stockCountEnabled);
    } catch (err) {
      console.error('Failed to load stock count setting:', err);
      stockCountEnabled = false;
    }
  }

  // Populate event dropdown
  function populateEventSelect(){
    const select = document.getElementById('select-event');
    if (!select) return;
    
    // Clear existing options except the first one
    while (select.options.length > 1) {
      select.remove(1);
    }
    
    // Add events
    allEvents.forEach(evt => {
      const option = document.createElement('option');
      option.value = evt.id;
      option.textContent = evt.name + (evt.date ? ` (${evt.date})` : '');
      select.appendChild(option);
    });
    
    // If admin published an active event, pick it and lock the select
    try{
      const activeRaw = localStorage.getItem('activeEvent');
      if(activeRaw){
        const activeObj = JSON.parse(activeRaw);
        if(activeObj && activeObj.id){
          // if the event exists in our fetched events, use it
          const found = allEvents.find(e => String(e.id)===String(activeObj.id));
          if(found){ select.value = found.id; selectedEventId = Number(found.id); try{ select.disabled = true; }catch(e){} }
        }
      }
    }catch(e){ /* ignore */ }

    // The active event is determined by the admin; cashier cannot change it.
    try{ select.disabled = true; }catch(e){}
  }

  // Render active event card from localStorage
  function renderActiveEventCard(){
    const card = document.getElementById('active-event-card');
    if(!card) return;

    // Show active event from localStorage if present
    try{
      const raw = localStorage.getItem('activeEvent');
      if(raw){
        const obj = JSON.parse(raw);
        if(obj && obj.id){
          // display a compact card
          card.innerHTML = `<div style="font-weight:700">${obj.name}</div><div style="font-size:0.9rem;color:var(--muted)">${obj.date||'N/A'} ${obj.location? '• ' + obj.location : ''}</div><div style="font-size:0.85rem;margin-top:6px;">${obj.phone? '📞 ' + obj.phone : ''}</div>`;
          selectedEventId = Number(obj.id);
          return;
        }
      }
    }catch(e){ /* ignore */ }

    // No active event: show placeholder
    card.textContent = 'No active event';
  }

  // Populate category dropdown in order modal
  function populateCategorySelect(){
    const sel = document.getElementById('order-cat');
    if(!sel) return;

    // Clear existing options except placeholder
    while(sel.options.length > 1) sel.remove(1);
    sel.value = '';
    sel.disabled = false;

    // Add all categories from the database
    allCategories.forEach(c=> sel.appendChild(new Option(c.name, c.id)));

    // Rebind change handler without replacing the element
    sel.onchange = () => {
      populateSubcategorySelect();
      const productSel = document.getElementById('order-product');
      if(productSel){
        while(productSel.options.length > 1) productSel.remove(1);
        productSel.value = '';
        productSel.disabled = true;
      }
    };
  }

  // Populate subcategory dropdown (only if category is selected)
  function populateSubcategorySelect(){
    const sel = document.getElementById('order-subcat');
    if(!sel) return;
    
    const catSel = document.getElementById('order-cat');
    const catValue = catSel ? catSel.value : '';
    
    // Clear except placeholder
    while(sel.options.length > 1) sel.remove(1);
    
    if(!catValue){
      sel.value = '';
      sel.disabled = true;
      return;
    }
    
    sel.disabled = false;
    
    allSubcategories.forEach(sc=>{
      if(String(sc.parent) !== catValue) return;
      sel.appendChild(new Option(sc.name, sc.id));
    });

    sel.onchange = () => populateProductSelect();
  }

  // Reset the order modal's selector state so a fresh modal always shows usable category/subcategory/product controls.
  function resetOrderModalSelectors(){
    populateCategorySelect();

    const catSel = document.getElementById('order-cat');
    const subSel = document.getElementById('order-subcat');
    const prodSel = document.getElementById('order-product');

    if (catSel) {
      catSel.value = '';
    }
    if (subSel) {
      while(subSel.options.length > 1) subSel.remove(1);
      subSel.value = '';
      subSel.disabled = true;
    }
    if (prodSel) {
      while(prodSel.options.length > 1) prodSel.remove(1);
      prodSel.value = '';
      prodSel.disabled = true;
    }

    populateProductSelect();
  }

  // Populate product dropdown using the current category/subcategory filters.
  // If no filters are selected, show the full product list so the picker is usable immediately.
  function populateProductSelect(showAll = false){
    const select = document.getElementById('order-product');
    if (!select) return;
    
    const catSel = document.getElementById('order-cat');
    const subSel = document.getElementById('order-subcat');
    const catValue = catSel ? catSel.value : '';
    const subValue = subSel ? subSel.value : '';
    
    // Clear existing options except the first one (placeholder)
    while(select.options.length > 1) select.removeChild(select.options[1]);
    
    if (!subValue) {
      select.value = '';
      select.disabled = true;
      return;
    }
    
    select.disabled = false;
    
    const productsToShow = Array.isArray(allProducts) ? allProducts : [];
    if (productsToShow.length === 0) {
      select.appendChild(new Option('No products available', ''));
      select.value = '';
      select.disabled = true;
      return;
    }

    productsToShow.forEach(prod => {
      if (!showAll) {
        if(catValue && String(prod.cat) !== catValue) return;
        if(subValue && String(prod.sub) !== subValue) return;
      }
      const option = document.createElement('option');
      option.value = prod.id;
      const price = parseFloat(prod.price || 0).toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      option.textContent = `${prod.name} (₦${price})`;
      select.appendChild(option);
    });
  }

  // Format currency with commas and decimals
  function formatCurrency(amount){
    const num = parseFloat(amount || 0);
    return '₦' + num.toLocaleString('en-NG', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }

  // Robust print helper: first try window.open (pop-up), fall back to hidden iframe
  function safePrint(html, opts = ''){
    try {
      const popup = window.open('', '', opts || 'height=600,width=400');
      if (popup && popup.document) {
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
        // Some browsers require focus before printing
        try { popup.focus(); } catch(e){}
        popup.print();
        return true;
      }
    } catch (err) {
      console.warn('Popup print failed, falling back to iframe:', err);
    }

    // Fallback: create a hidden iframe and print from it
    try {
      let iframe = document.getElementById('print-iframe');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0px';
        iframe.style.height = '0px';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';
        document.body.appendChild(iframe);
      }
      const ifWin = iframe.contentWindow || iframe;
      const ifDoc = iframe.contentDocument || ifWin.document;
      ifDoc.open();
      ifDoc.write(html);
      ifDoc.close();
      try { ifWin.focus(); } catch(e){}
      // Delay printing slightly to allow resources to render
      setTimeout(()=>{
        try { ifWin.print(); } catch(e){ console.error('Iframe print failed', e); }
      }, 250);
      return true;
    } catch (err) {
      console.error('Both popup and iframe print failed:', err);
      alert('Printing is not available. Please allow pop-ups or try a different browser.');
      return false;
    }
  }

  // Open order creation modal
  async function openOrderModal(){
    console.log('openOrderModal called');
    const modal = document.getElementById('order-modal');
    console.log('modal element found:', !!modal);
    if (modal) {
      console.log('openOrderModal: setting aria-hidden to false and removing inert');
      
      if (allProducts.length === 0) {
        try {
          await loadPOSData();
        } catch (err) {
          console.warn('Failed to refresh POS data before opening modal', err);
        }
      }
      
      // Ensure modal is fully reset
      editingOrderId = null;
      editingOrder = null;
      currentOrderItems = [];
      originalOrderItems = [];
      currentVoidedItems = [];
      
      // Reset form
      resetOrderForm();
      updateOrderTableHint('');
      resetOrderModalSelectors();
      renderOrderItemsTable();
      updateModalButtons();
      
      // Remove inert and show modal
      modal.removeAttribute('inert');
      modal.setAttribute('aria-hidden', 'false');
      
      console.log('after setAttribute, aria-hidden=', modal.getAttribute('aria-hidden'));
      
      // Focus the first input with a small delay to ensure DOM is ready
      setTimeout(() => {
        const firstInput = modal.querySelector('#order-table');
        if (firstInput) {
          firstInput.focus();
        }
      }, 50);
      
      console.log('openOrderModal complete');
    } else {
      console.error('ERROR: modal element not found!');
    }
  }

  // Open order edit modal
  async function openEditOrderModal(orderId, order){
    console.log('openEditOrderModal called for orderId:', orderId);
    const modal = document.getElementById('order-modal');
    console.log('modal element found:', !!modal);
    if (modal) {
      console.log('openEditOrderModal: setting aria-hidden to false and removing inert');
      
      if (allProducts.length === 0) {
        try {
          await loadPOSData();
        } catch (err) {
          console.warn('Failed to refresh POS data before editing modal', err);
        }
      }
      
      // Clear any previous state
      currentOrderItems = [];
      originalOrderItems = [];
      editingOrderId = null;
      editingOrder = null;
      currentVoidedItems = []; // Reset voided items
      
      // Initialize voided items from existing order if they exist
      if (order.voidedItems && order.voidedItems.length > 0) {
        currentVoidedItems = JSON.parse(JSON.stringify(order.voidedItems));
      }
      
      // Now set new state
      editingOrderId = orderId;
      editingOrder = JSON.parse(JSON.stringify(order)); // Deep clone to prevent reference issues
      currentOrderItems = (order.items || []).map(item => ({
        productId: item.productId || item.id || item.productId || item.product?.id || null,
        productName: item.productName || item.name || item.product?.name || 'Unknown',
        unitPrice: Number(item.unitPrice ?? item.price ?? item.product?.price ?? 0),
        quantity: Number(item.quantity ?? item.qty ?? 0)
      }));
      // Store original items to differentiate new items added during edit
      originalOrderItems = (order.items || []).map(item => ({
        productId: item.productId || item.id || item.productId || item.product?.id || null,
        productName: item.productName || item.name || item.product?.name || 'Unknown',
        unitPrice: Number(item.unitPrice ?? item.price ?? item.product?.price ?? 0),
        quantity: Number(item.quantity ?? item.qty ?? 0)
      }));
      
      const tableInput = document.getElementById('order-table');
      const waiterInput = document.getElementById('order-waiter');
      const clientInput = document.getElementById('order-client');
      
      if (tableInput) {
        tableInput.value = order.tableName || '';
        tableInput.setAttribute('readonly', 'readonly');
        tableInput.style.backgroundColor = '#f9fafb';
        tableInput.style.cursor = 'not-allowed';
      }
      if (waiterInput) {
        waiterInput.value = order.waiterName || '';
        waiterInput.setAttribute('readonly', 'readonly');
        waiterInput.style.backgroundColor = '#f9fafb';
        waiterInput.style.cursor = 'not-allowed';
      }
      if (clientInput) clientInput.value = order.clientName || '';
      
      const productSelect = document.getElementById('order-product');
      if (productSelect) productSelect.value = '';
      
      // Repopulate category and product dropdowns for edit mode
      resetOrderModalSelectors();
      updateOrderTableHint(order.tableName || '');
      
      renderOrderItemsTable();
      updateModalButtons();
      
      // Show modal
      modal.setAttribute('aria-hidden', 'false');
      modal.removeAttribute('inert'); // Remove inert to make it focusable
      
      // Focus the table input field for editing
      if (tableInput) {
        setTimeout(() => tableInput.focus(), 100);
      }
      console.log('openEditOrderModal complete');
    } else {
      console.error('ERROR: modal element not found!');
    }
  }

  // Close order creation modal
  function closeOrderModal(){
    console.log('closeOrderModal called');
    const modal = document.getElementById('order-modal');
    if (modal) {
      console.log('Setting modal aria-hidden to true and adding inert');
      
      // Move focus away from the modal FIRST before hiding it
      const focusedElement = document.activeElement;
      if (focusedElement && modal.contains(focusedElement)) {
        // Blur the focused element first
        focusedElement.blur();
        // Then move focus to main page
        document.querySelector('main')?.focus();
      }
      
      // Small delay to ensure focus is moved before aria-hidden is set
      setTimeout(() => {
        // Restore original modal HTML for order form
        const modalPanel = modal.querySelector('.modal-panel');
        if (modalPanel && originalModalHTML) {
          modalPanel.innerHTML = originalModalHTML;
          // Re-wire modal buttons after restoration
          rewireModalButtons();
        }
        
        // Reset all state BEFORE hiding modal to prevent stale references
        editingOrderId = null;
        editingOrder = null;
        currentOrderItems = [];
        originalOrderItems = [];
        currentVoidedItems = [];
        currentVoidRemark = '';
        
        // Reset form UI
        resetOrderForm();
        
        // Hide modal - inert will prevent focus from entering
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
        
        console.log('closeOrderModal complete - all state cleared');
      }, 0);
    }
  }

  // Show order details modal for completed orders
  function showOrderDetailsModal(order){
    const modal = document.getElementById('order-modal');
    if (!modal) return;
    
    const modalPanel = modal.querySelector('.modal-panel');
    if (!modalPanel) return;
    
    // Build details HTML
    let itemsHTML = '';
    const items = order.items || [];
    items.forEach((item, idx) => {
      const subtotal = (item.unitPrice || 0) * (item.quantity || 0);
      itemsHTML += `
        <div style="display: grid; grid-template-columns: 2fr 80px 100px; gap: 8px; padding: 8px 0; border-bottom: 1px solid #ddd;">
          <div style="font-size: 0.9rem;">${item.productName}</div>
          <div style="text-align: center; font-size: 0.9rem;">${item.quantity}</div>
          <div style="text-align: right; font-size: 0.9rem;">${formatCurrency(subtotal)}</div>
        </div>
      `;
    });
    
    // Build payment breakdown HTML
    let paymentsHTML = '';
    const payments = order.payments || [];
    if (payments.length > 0) {
      const paymentLabels = {
        'cash': '💵 Cash',
        'pos': '💳 POS Card',
        'transfer': '📱 Bank Transfer',
        'credit': '📝 Credit'
      };
      payments.forEach(p => {
        paymentsHTML += `
          <div style="display: flex; justify-content: space-between; padding: 6px 0;">
            <span>${paymentLabels[p.method] || p.method}:</span>
            <span style="font-weight: 600;">${formatCurrency(p.amount)}</span>
          </div>
        `;
      });
    }
    
    const detailsHTML = `
      <div style="display: flex; flex-direction: column; gap: 0; padding: 0; height: 100%;">
        <div style="padding: 20px; border-bottom: 1px solid #e5e7eb;">
          <h3 style="margin: 0; font-size: 1.3rem; font-weight: 700;">Order Details</h3>
        </div>
        
        <div style="padding: 20px; overflow-y: auto; flex: 1;">
          <div style="background: #f0f9ff; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
            <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px;">
              <div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 4px;">Table</div>
                <div style="font-size: 1.1rem; font-weight: 700;">${order.tableName}</div>
              </div>
              <div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 4px;">Waiter</div>
                <div style="font-size: 1.1rem; font-weight: 700;">${order.waiterName}</div>
              </div>
              <div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 4px;">Cashier</div>
                <div style="font-size: 1.1rem; font-weight: 700;">${order.cashierName || 'Cashier'}</div>
              </div>
              ${order.clientName ? `
              <div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 4px;">Client</div>
                <div style="font-size: 1.1rem; font-weight: 700;">${order.clientName}</div>
              </div>
              ` : ''}
              <div>
                <div style="font-size: 0.85rem; color: #666; margin-bottom: 4px;">Status</div>
                <div style="font-size: 1.1rem; font-weight: 700; color: ${String(order.status || '').toLowerCase() === 'completed' ? '#10b981' : '#2563eb'};">${String(order.status || 'pending').toUpperCase()}</div>
              </div>
            </div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <div style="font-weight: 600; margin-bottom: 12px;">Items</div>
            <div style="background: #fafafa; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
              <div style="display: grid; grid-template-columns: 2fr 80px 100px; gap: 8px; margin-bottom: 12px; font-weight: 600; color: #666; font-size: 0.9rem; padding-bottom: 8px; border-bottom: 1px solid #ddd;">
                <div>Product</div>
                <div style="text-align: center; width: 80px;">Qty</div>
                <div style="text-align: right; width: 100px;">Total</div>
              </div>
              ${itemsHTML}
            </div>
          </div>
          
          <div style="background: #f0fdf4; padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #10b981;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 600;">Bill Total:</span>
              <span style="font-weight: 700; color: #0284c7; font-size: 1.1rem;">${formatCurrency(order.totalAmount || 0)}</span>
            </div>
          </div>
          
          ${paymentsHTML ? `
          <div style="background: #f3e8ff; padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #9333ea;">
            <div style="font-weight: 600; margin-bottom: 10px; color: #7e22ce;">Payment Breakdown</div>
            <div>
              ${paymentsHTML}
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #d6acf5;">
                <div style="display: flex; justify-content: space-between; font-weight: 700;">
                  <span>Total Paid:</span>
                  <span style="color: #10b981;">${formatCurrency(payments.reduce((sum, p) => sum + (p.amount || 0), 0))}</span>
                </div>
              </div>
            </div>
          </div>
          ` : ''}
        </div>
        
        <div style="padding: 20px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-ghost" id="btn-close-details" style="margin: 0;">Close</button>
          <button class="btn btn-primary" id="btn-print-details" style="margin: 0;">Print Receipt</button>
        </div>
      </div>
    `;
    
    modalPanel.innerHTML = detailsHTML;
    
    modal.setAttribute('aria-hidden', 'false');
    modal.removeAttribute('inert');
    
    // Wire up close button
    document.getElementById('btn-close-details')?.addEventListener('click', closeOrderModal);
    
    // Wire up print button - use thermal format
    // Enrich order with event phone before printing
    document.getElementById('btn-print-details')?.addEventListener('click', () => {
      const enrichedOrder = { ...order };
      if (selectedEventId) {
        const event = allEvents.find(e => e.id === selectedEventId);
        enrichedOrder.eventPhone = event?.phone || '';
      }
      printReceiptThermal(enrichedOrder);
    });
  }

  // Update modal buttons based on mode (create vs edit)
  function updateModalButtons(){
    const saveBtn = document.getElementById('btn-save-order');
    const removeBtn = document.getElementById('btn-remove-items');
    const removeItemBtn = document.getElementById('btn-remove-item');
    const removeOrderBtn = document.getElementById('btn-remove-order');
    const voidBtn = document.getElementById('btn-void-item');
    const sendBtn = document.getElementById('btn-send-order');
    const printBtn = document.getElementById('btn-print-bill');
    const splitBtn = document.getElementById('btn-split-bill');
    const closeBillBtn = document.getElementById('btn-close-bill');
    const sendOrderNewBtn = document.getElementById('btn-send-order-new');
    
    if (editingOrderId) {
      // Edit mode — keep Save button label consistent
      if (saveBtn) saveBtn.textContent = 'Save Order';
      if (removeBtn) removeBtn.style.display = 'block';
      if (removeItemBtn) removeItemBtn.style.display = 'none';
      if (removeOrderBtn) removeOrderBtn.style.display = canDeleteOrder(editingOrder) ? 'block' : 'none';
      if (voidBtn) voidBtn.style.display = 'block';
      if (sendBtn) sendBtn.style.display = 'block';
      if (printBtn) printBtn.style.display = 'block';
      if (splitBtn) splitBtn.style.display = 'block';
      if (closeBillBtn) closeBillBtn.style.display = 'block';
      if (sendOrderNewBtn) sendOrderNewBtn.style.display = 'none';
    } else {
      // Create mode
      if (saveBtn) saveBtn.textContent = 'Save Order';
      if (removeBtn) removeBtn.style.display = 'block';
      if (removeItemBtn) removeItemBtn.style.display = 'block';
      if (removeOrderBtn) removeOrderBtn.style.display = 'none';
      if (voidBtn) voidBtn.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'none';
      if (printBtn) printBtn.style.display = 'none';
      if (splitBtn) splitBtn.style.display = 'none';
      if (closeBillBtn) closeBillBtn.style.display = 'none';
      if (sendOrderNewBtn) sendOrderNewBtn.style.display = 'block';
    }
  }

  // Reset order form fields
  function resetOrderForm(){
    const tableInput = document.getElementById('order-table');
    const waiterInput = document.getElementById('order-waiter');
    const clientInput = document.getElementById('order-client');
    const productSelect = document.getElementById('order-product');
    const qtyInput = document.getElementById('order-qty');
    const catInput = document.getElementById('order-cat');
    const subInput = document.getElementById('order-subcat');
    
    if (tableInput) {
      tableInput.value = '';
      tableInput.removeAttribute('readonly');
      tableInput.style.backgroundColor = '';
      tableInput.style.cursor = '';
    }
    if (waiterInput) {
      waiterInput.value = '';
      waiterInput.removeAttribute('readonly');
      waiterInput.style.backgroundColor = '';
      waiterInput.style.cursor = '';
    }
    if (clientInput) clientInput.value = '';
    if (productSelect) {
      productSelect.value = '';
      productSelect.disabled = true;
    }
    if (catInput) catInput.value = '';
    if (subInput) {
      subInput.value = '';
      subInput.disabled = true;
    }
    if (qtyInput) qtyInput.value = '1';
  }

  function normalizeTableIdentifier(value){
    if (!value) return { original: '', normalized: '', number: '' };
    const raw = String(value).trim();
    const numericMatch = raw.match(/\d+/);
    const number = numericMatch ? String(parseInt(numericMatch[0], 10)) : '';
    const normalized = raw.toLowerCase().replace(/table/gi, '').replace(/[^0-9a-z]/g, '').trim();
    return { original: raw, normalized, number };
  }

  function updateOrderTableHint(tableName = ''){
    const hint = document.getElementById('order-table-hint');
    if (!hint) return;

    const trimmed = String(tableName || '').trim();
    if (!trimmed) {
      hint.textContent = 'Tip: If this table already has an active order, use Update Order from the orders list instead of creating a duplicate.';
      hint.style.color = '#6b7280';
      return;
    }

    const isConflict = !editingOrderId && tableAlreadyHasOrder(trimmed, editingOrderId);
    hint.textContent = isConflict
      ? `Table "${trimmed}" already has an active order. Use Update Order to add items.`
      : 'Tip: If this table already has an active order, use Update Order from the orders list instead of creating a duplicate.';
    hint.style.color = isConflict ? '#b91c1c' : '#6b7280';
  }

  function tablesMatch(tableA, tableB){
    const idA = normalizeTableIdentifier(tableA);
    const idB = normalizeTableIdentifier(tableB);
    if (idA.number && idB.number && idA.number === idB.number) return true;
    if (idA.normalized && idB.normalized && idA.normalized === idB.normalized) return true;
    return idA.original.toLowerCase() === idB.original.toLowerCase();
  }

  // Handle table name change - fetch waiter (only in create mode, not edit mode)
  async function handleTableChange(){
    const tableInput = document.getElementById('order-table');
    const waiterInput = document.getElementById('order-waiter');
    if (!tableInput || !waiterInput) return;
    // When editing an existing order, keep table and waiter fixed and do nothing
    if (editingOrderId) {
      updateOrderTableHint(tableInput.value);
      return;
    }
    
    const tableName = tableInput.value.trim();
    updateOrderTableHint(tableName);

    if (!tableName) {
      waiterInput.value = '';
      return;
    }
    
    // Check if table already has an active order (exclude current editing order if in edit mode)
    if (tableAlreadyHasOrder(tableName, editingOrderId)) {
      showToast(`An order already exists for table ${tableName}. Use Update Order to add items.`, 'error', 3200);
      tableInput.value = '';
      waiterInput.value = '';
      tableInput.focus();
      return;
    }
    
    // In edit mode, just allow the table name change without auto-populating waiter
    // In create mode, auto-populate waiter from assigned tables
    if (!editingOrderId) {
      const tableId = normalizeTableIdentifier(tableName);
      const waiter = allWaiters.find(w => {
        if (!w.tables || !Array.isArray(w.tables)) return false;
        return w.tables.some(t => {
          const assigned = normalizeTableIdentifier(t);
          if (tableId.number && assigned.number && tableId.number === assigned.number) return true;
          if (tableId.normalized && assigned.normalized && tableId.normalized === assigned.normalized) return true;
          return assigned.original.toLowerCase() === tableId.original.toLowerCase();
        });
      });
      if (waiter) {
        waiterInput.value = waiter.username;
        waiterInput.setAttribute('readonly', 'readonly');
        waiterInput.style.backgroundColor = '#f9fafb';
        waiterInput.style.cursor = 'not-allowed';
      } else {
        waiterInput.value = '(No assigned waiter)';
        waiterInput.setAttribute('readonly', 'readonly');
        waiterInput.style.backgroundColor = '#f9fafb';
        waiterInput.style.cursor = 'not-allowed';
      }
    } else {
      // Edit mode: allow manual editing, don't auto-populate
      // Just validate that the new table name doesn't conflict with other orders
      // Waiter field can be manually edited
    }
  }

  // Add item to current order
  function addItemToOrder(){
    const productSelect = document.getElementById('order-product');
    const qtyInput = document.getElementById('order-qty');
    
    if (!productSelect || !qtyInput) return;
    
    const productId = productSelect.value;
    const qty = parseInt(qtyInput.value) || 1;
    
    if (!productId) {
      showToast('Please select a product', 'error');
      return;
    }
    
    if (qty < 1) {
      showToast('Quantity must be at least 1', 'error');
      return;
    }
    
    const product = allProducts.find(p => p.id === Number(productId));
    if (!product) return;
    
    // Check if item already exists in order
    const existingItem = currentOrderItems.find(item => item.productId === Number(productId));
    
    if (existingItem) {
      existingItem.quantity += qty;
    } else {
      currentOrderItems.push({
        productId: Number(productId),
        productName: product.name,
        unitPrice: parseFloat(product.price || 0),
        quantity: qty
      });
    }
    
    // Clear product selection
    productSelect.value = '';
    qtyInput.value = '1';
    
    renderOrderItemsTable();
  }

  // Calculate billing breakdown with tax, service charge, and discount
  // Apply discount to order
  function applyDiscount() {
    if (!currentOrderItems || currentOrderItems.length === 0) {
      alert('Please add items to the order first');
      return;
    }

    // Show discount type selection dialog
    const discountType = prompt(
      'How would you like to apply the discount?\n\n' +
      '1 - Percentage (%)\n' +
      '2 - Fixed Amount (₦)\n' +
      '3 - By Item\n\n' +
      'Enter 1, 2, or 3:',
      '1'
    );

    if (!discountType || !['1', '2', '3'].includes(discountType.trim())) {
      return; // User cancelled or entered invalid option
    }

    const type = discountType.trim();

    if (type === '1') {
      // Percentage discount
      const percentage = prompt('Enter discount percentage (0-100):', '10');
      if (percentage === null) return;
      
      const percent = parseFloat(percentage);
      if (isNaN(percent) || percent < 0 || percent > 100) {
        alert('Please enter a valid percentage between 0 and 100');
        return;
      }

      billingSettings.discountPercentage = percent;
      renderOrderItemsTable();
      showToast(`✓ ${percent}% discount applied`, 'success');
    } 
    else if (type === '2') {
      // Fixed amount discount
      const amount = prompt('Enter discount amount (₦):', '1000');
      if (amount === null) return;
      
      const discountAmount = parseFloat(amount);
      if (isNaN(discountAmount) || discountAmount < 0) {
        alert('Please enter a valid amount');
        return;
      }

      // Calculate subtotal
      let subtotal = 0;
      currentOrderItems.forEach(item => {
        subtotal += item.unitPrice * item.quantity;
      });

      if (discountAmount > subtotal) {
        alert(`Discount amount (₦${discountAmount}) cannot exceed subtotal (₦${subtotal})`);
        return;
      }

      // Store fixed discount
      billingSettings.discountFixed = discountAmount;
      billingSettings.discountPercentage = 0;
      renderOrderItemsTable();
      showToast(`✓ ₦${discountAmount} discount applied`, 'success');
    }
    else if (type === '3') {
      // Item-level discount
      if (currentOrderItems.length === 0) {
        alert('No items in order');
        return;
      }

      let itemList = '';
      currentOrderItems.forEach((item, index) => {
        itemList += `${index + 1}. ${item.productName} (₦${item.unitPrice} x${item.quantity})\n`;
      });

      const itemIndex = prompt(
        'Which item would you like to discount?\n\n' + itemList + 
        '\nEnter item number:',
        '1'
      );

      if (itemIndex === null) return;

      const idx = parseInt(itemIndex) - 1;
      if (isNaN(idx) || idx < 0 || idx >= currentOrderItems.length) {
        alert('Invalid item number');
        return;
      }

      const discountTypeForItem = prompt(
        'Discount type for ' + currentOrderItems[idx].productName + ':\n\n' +
        '1 - Percentage\n' +
        '2 - Fixed Amount\n\n' +
        'Enter 1 or 2:',
        '1'
      );

      if (!discountTypeForItem || !['1', '2'].includes(discountTypeForItem.trim())) {
        return;
      }

      if (discountTypeForItem.trim() === '1') {
        const percentage = prompt('Enter discount percentage (0-100):', '10');
        if (percentage === null) return;
        
        const percent = parseFloat(percentage);
        if (isNaN(percent) || percent < 0 || percent > 100) {
          alert('Please enter a valid percentage between 0 and 100');
          return;
        }

        currentOrderItems[idx].discountPercentage = percent;
        showToast(`✓ ${percent}% discount applied to ${currentOrderItems[idx].productName}`, 'success');
      } else {
        const amount = prompt('Enter discount amount (₦):', '500');
        if (amount === null) return;
        
        const discountAmount = parseFloat(amount);
        if (isNaN(discountAmount) || discountAmount < 0) {
          alert('Please enter a valid amount');
          return;
        }

        const maxDiscount = currentOrderItems[idx].unitPrice * currentOrderItems[idx].quantity;
        if (discountAmount > maxDiscount) {
          alert(`Discount cannot exceed item total (₦${maxDiscount})`);
          return;
        }

        currentOrderItems[idx].discountFixed = discountAmount;
        showToast(`✓ ₦${discountAmount} discount applied to ${currentOrderItems[idx].productName}`, 'success');
      }

      renderOrderItemsTable();
    }
  }

  function calculateBillingBreakdown(subtotal){
    const breakdown = {
      subtotal: subtotal,
      taxPercentage: billingSettings.taxPercentage || 0,
      tax: 0,
      serviceChargePercentage: billingSettings.serviceChargePercentage || 0,
      serviceCharge: 0,
      discountPercentage: billingSettings.discountPercentage || 0,
      discountFixed: billingSettings.discountFixed || 0,
      discount: 0,
      total: subtotal
    };

    // Calculate discount - use fixed amount if set, otherwise use percentage
    if (breakdown.discountFixed > 0) {
      breakdown.discount = breakdown.discountFixed;
    } else {
      breakdown.discount = (subtotal * breakdown.discountPercentage) / 100;
    }

    // Calculate tax (on subtotal, before discount)
    breakdown.tax = (subtotal * breakdown.taxPercentage) / 100;

    // Calculate service charge (on subtotal, before discount)
    breakdown.serviceCharge = (subtotal * breakdown.serviceChargePercentage) / 100;

    // Final total: subtotal - discount + tax + service charge
    breakdown.total = subtotal - breakdown.discount + breakdown.tax + breakdown.serviceCharge;

    return breakdown;
  }

  // Remove item from current order
  function removeItemFromOrder(productId){
    currentOrderItems = currentOrderItems.filter(item => item.productId !== productId);
    renderOrderItemsTable();
  }

  function getOrderStatus(order){
    if (!order || typeof order !== 'object') return 'pending';
    const statusValue = order.status || order.orderData?.status || order.order_data?.status || order.order?.status || order.orderData?.order?.status || order.order_data?.order?.status;
    return String(statusValue || 'pending').toLowerCase();
  }

  function isOrderClosed(order){
    const status = getOrderStatus(order);
    return ['completed','closed','cancelled','canceled'].includes(status);
  }

  // Update POS stats cards
  function updatePOSStats(){
    let totalRevenue = 0;
    let completedRevenue = 0;
    let totalOrders = 0;
    let totalVoidedItems = 0;
    const currentOrders = filterBusinessDayOrders(allOrdersCache || []);
    
    // Calculate stats from current business day orders
    if (currentOrders.length > 0) {
      totalOrders = currentOrders.length;
      currentOrders.forEach(order => {
        if (order.totalAmount) {
          totalRevenue += order.totalAmount;
          if (getOrderStatus(order) === 'completed') {
            completedRevenue += order.totalAmount;
          }
        }
        if (order.voidedItems && order.voidedItems.length > 0) {
          totalVoidedItems += order.voidedItems.reduce((sum, item) => sum + item.quantity, 0);
        }
      });
    }
    
    // Update the stat cards
    const revenueEl = document.getElementById('stat-total-revenue');
    const ordersEl = document.getElementById('stat-total-orders');
    const voidedEl = document.getElementById('stat-voided-items');
    const completedRevenueEl = document.getElementById('stat-completed-revenue');
    
    if (revenueEl) revenueEl.textContent = formatCurrency(totalRevenue);
    if (ordersEl) ordersEl.textContent = totalOrders;
    if (voidedEl) voidedEl.textContent = totalVoidedItems;
    if (completedRevenueEl) completedRevenueEl.textContent = formatCurrency(completedRevenue);
  }

  // Check if table already has an order (excluding a specific order ID)
  function tableAlreadyHasOrder(tableName, excludeOrderId){
    if (!tableName || !allOrdersCache) return false;
    const excludeId = excludeOrderId == null ? null : String(excludeOrderId);
    return allOrdersCache.some(order => {
      const orderId = order?.id == null ? null : String(order.id);
      if (excludeId && orderId === excludeId) return false;
      return Boolean(order.tableName) &&
        tablesMatch(tableName, order.tableName) &&
        !isOrderClosed(order);
    });
  }

  // Render items table
  function renderOrderItemsTable(){
    const table = document.getElementById('order-items-table');
    const tableWrapper = table?.parentElement;
    const tbody = document.getElementById('order-items-body');
    const emptyMsg = document.getElementById('order-empty-msg');
    const billingCard = document.getElementById('billing-summary-card');
    const grandTotalEl = document.getElementById('order-grand-total');
    
    if (!tbody || !table) return;
    
    tbody.innerHTML = '';
    
    if (currentOrderItems.length === 0) {
      if (tableWrapper) tableWrapper.style.display = 'none';
      if (billingCard) billingCard.style.display = 'none';
      if (emptyMsg) emptyMsg.style.display = 'block';
      if (grandTotalEl) grandTotalEl.textContent = '₦0.00';
      return;
    }
    
    if (tableWrapper) tableWrapper.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';
    if (billingCard) billingCard.style.display = 'block';
    
    let grandTotal = 0;
    
    currentOrderItems.forEach((item, index) => {
      const itemName = item.productName || item.name || 'Unknown';
      const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const itemTotal = unitPrice * quantity;
      grandTotal += itemTotal;
      
      // Check if this is a newly added item (not in original items list)
      const isNewItem = index >= originalOrderItems.length;
      const editButtonHtml = isNewItem 
        ? `<button class="btn-edit-qty" data-index="${index}" style="padding:4px 8px;font-size:0.8rem;background:transparent;border:1px solid var(--accent);color:var(--accent);border-radius:4px;cursor:pointer;">Edit</button>`
        : '';
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="text-align: center;"><input type="checkbox" class="item-checkbox" data-index="${index}" style="width: 18px; height: 18px; cursor: pointer;"></td>
        <td style="text-align: left;">${itemName}</td>
        <td style="text-align: center; width: 40px;">${quantity}</td>
        <td style="text-align: right; width: 70px;">${formatCurrency(unitPrice)}</td>
        <td style="text-align: right; width: 70px;">${formatCurrency(itemTotal)}</td>
        <td style="text-align: center; width: 40px;">${editButtonHtml}</td>
      `;
      
      tbody.appendChild(row);
    });
    
    // Calculate billing breakdown
    const breakdown = calculateBillingBreakdown(grandTotal);
    
    // Update billing summary card
    const subtotalEl = document.getElementById('billing-subtotal');
    const discountEl = document.getElementById('billing-discount');
    const taxEl = document.getElementById('billing-tax');
    const taxLabelEl = document.getElementById('billing-tax-label');
    const serviceEl = document.getElementById('billing-service');
    const serviceLabelEl = document.getElementById('billing-service-label');
    const discountBox = document.getElementById('discount-box');
    const taxBox = document.getElementById('tax-box');
    const serviceBox = document.getElementById('service-box');
    
    if (subtotalEl) subtotalEl.textContent = formatCurrency(breakdown.subtotal);
    
    // Show/hide discount box
    if (breakdown.discount > 0) {
      if (discountEl) discountEl.textContent = '-' + formatCurrency(breakdown.discount);
      if (discountBox) discountBox.style.display = 'block';
    } else {
      if (discountBox) discountBox.style.display = 'none';
    }
    
    // Show/hide tax box and update label with percentage
    if (breakdown.tax > 0) {
      if (taxEl) taxEl.textContent = '+' + formatCurrency(breakdown.tax);
      if (taxLabelEl) {
        const taxPercent = billingSettings.taxPercentage || 0;
        taxLabelEl.textContent = `Tax Fee (${taxPercent}%)`;
      }
      if (taxBox) taxBox.style.display = 'block';
    } else {
      if (taxBox) taxBox.style.display = 'none';
    }
    
    // Show/hide service charge box and update label with percentage
    if (breakdown.serviceCharge > 0) {
      if (serviceEl) serviceEl.textContent = '+' + formatCurrency(breakdown.serviceCharge);
      if (serviceLabelEl) {
        const servicePercent = billingSettings.serviceChargePercentage || 0;
        serviceLabelEl.textContent = `Service Charge (${servicePercent}%)`;
      }
      if (serviceBox) serviceBox.style.display = 'block';
    } else {
      if (serviceBox) serviceBox.style.display = 'none';
    }
    
    // Update grand total
    if (grandTotalEl) {
      grandTotalEl.textContent = formatCurrency(breakdown.total);
    }

    // Wire up edit qty buttons
    document.querySelectorAll('.btn-edit-qty').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = Number(e.target.getAttribute('data-index'));
        if (index >= 0 && index < currentOrderItems.length) {
          const item = currentOrderItems[index];
          const newQty = prompt(`Edit quantity for ${item.productName}:\nCurrent: ${item.quantity}`, item.quantity.toString());
          if (newQty !== null && newQty !== '') {
            const qty = parseInt(newQty, 10);
            if (isNaN(qty) || qty < 1) {
              alert('Please enter a valid quantity (1 or more)');
              return;
            }
            currentOrderItems[index].quantity = qty;
            renderOrderItemsTable();
          }
        }
      });
    });
  }

  // Apply stock deltas between old and new items: ensure availability and update product quantities
  async function applyStockDeltas(oldItems, newItems){
    const oldMap = {};
    (oldItems || []).forEach(i=>{ oldMap[i.productId] = (oldMap[i.productId]||0) + (i.quantity||0); });
    const newMap = {};
    (newItems || []).forEach(i=>{ newMap[i.productId] = (newMap[i.productId]||0) + (i.quantity||0); });
    const ids = Array.from(new Set([ ...Object.keys(oldMap).map(x=>Number(x)), ...Object.keys(newMap).map(x=>Number(x)) ]));

    // Only consider items that actually changed quantity
    const changedIds = ids.filter(pid => {
      const oldQ = Number(oldMap[pid]||0);
      const newQ = Number(newMap[pid]||0);
      return newQ !== oldQ;
    });

    // Check availability for required increases
    for(const pid of changedIds){
      const oldQ = Number(oldMap[pid]||0);
      const newQ = Number(newMap[pid]||0);
      const delta = newQ - oldQ; // positive -> need to reduce stock
      if(delta > 0){
        const productFromList = (allProducts || []).find(p => String(p.id) === String(pid));
        const prod = productFromList || await RestaurantDB.getProductById(pid).catch(() => null);
        if(!prod){
          alert('Product not found for stock update');
          return false;
        }
        const avail = Number(prod.quantity || 0);
        if(avail < delta){
          alert(`Insufficient stock for "${prod.name}". Available: ${avail}, required: ${delta}`);
          return false;
        }
      }
    }

    // Apply changes
    for(const pid of changedIds){
      const oldQ = Number(oldMap[pid]||0);
      const newQ = Number(newMap[pid]||0);
      const delta = newQ - oldQ; // positive reduces stock, negative increases stock
      if(delta !== 0){
        const productFromList = (allProducts || []).find(p => String(p.id) === String(pid));
        const prod = productFromList || await fetchBackend(`/api/products/${pid}`).then(res => res.product).catch(() => null);
        if(!prod) continue;

        const updatedQty = Number(prod.quantity || 0) - delta;
        if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
        await fetchBackend('/api/products/save', {
          method: 'POST',
          body: JSON.stringify({
            id: pid,
            name: prod.name || '',
            price: prod.price ?? 0,
            quantity: updatedQty,
            barcode: prod.barcode || null,
            cat: prod.cat ?? null,
            sub: prod.sub ?? null
          })
        });
        const index = (allProducts || []).findIndex(p => String(p.id) === String(pid));
        if (index >= 0) {
          allProducts[index] = { ...allProducts[index], quantity: updatedQty };
        }
      }
    }

    // refresh in-memory products
    try {
      const response = await fetchBackend('/api/products');
      allProducts = response.products || [];
    } catch (e) {
      console.warn('Failed to refresh backend products cache', e);
    }
    populateProductSelect();
    return true;
  }

  // Save order
  async function saveOrder(statusOverride){
    const tableInput = document.getElementById('order-table');
    const waiterInput = document.getElementById('order-waiter');
    const clientInput = document.getElementById('order-client');
    
    if (!tableInput) return false;
    
    const tableName = tableInput.value.trim();
    if (!tableName) {
      showToast('Table name is required', 'error');
      return false;
    }
    
    // Check if table has an assigned waiter (not unassigned) - for new orders
    if (!editingOrderId) {
      const waiterName = waiterInput?.value?.trim() || '';
      if (waiterName === '(No assigned waiter)' || waiterName === 'Unassigned' || !waiterName) {
        showToast('❌ Invalid table number! Please enter a table that has an assigned waiter.', 'error');
        tableInput.focus();
        return false;
      }
    }

    if (tableAlreadyHasOrder(tableName, editingOrderId)) {
      showToast(`An order already exists for table ${tableName}. Use Update Order to add items.`, 'error', 3200);
      tableInput.focus();
      return false;
    }
    
    if (currentOrderItems.length === 0) {
      showToast('Please add at least one item to the order', 'error');
      return false;
    }
    
    try {
      // Calculate subtotal from items
      const subtotal = currentOrderItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
      
      // Calculate billing breakdown
      const breakdown = calculateBillingBreakdown(subtotal);
      const now = new Date().toISOString();
      
      const orderData = {
        tableName: tableName,
        waiterName: waiterInput?.value || 'Unassigned',
        cashierName: getCurrentCashierName(),
        cashier: getCurrentCashierName(),
        createdBy: getCurrentCashierName(),
        allowCashierDelete: editingOrderId ? (editingOrder?.allowCashierDelete === false ? false : true) : true,
        clientName: clientInput?.value || '',
        items: currentOrderItems.map(item => ({
          productId: item.productId,
          productName: item.productName,
          name: item.productName || item.name || item.product?.name || 'Unknown',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          price: item.unitPrice
        })),
        status: (typeof statusOverride !== 'undefined') ? statusOverride : (editingOrderId ? editingOrder.status : 'pending'),
        subtotal: subtotal,
        billingBreakdown: {
          taxPercentage: billingSettings.taxPercentage,
          tax: breakdown.tax,
          serviceChargePercentage: billingSettings.serviceChargePercentage,
          serviceCharge: breakdown.serviceCharge,
          discountPercentage: billingSettings.discountPercentage,
          discount: breakdown.discount
        },
        totalAmount: breakdown.total,
        voidedItems: currentVoidedItems.length > 0 ? currentVoidedItems : [],
        createdAt: now,
        updatedAt: now
      };

      // Apply stock changes (validate and update product quantities)
      const oldItems = editingOrderId ? (originalOrderItems || []) : [];
      if (stockCountEnabled) {
        const ok = await applyStockDeltas(oldItems, currentOrderItems);
        if(!ok) return false; // abort save if stock check failed
      }

      if (editingOrderId) {
        // Update existing order - preserve mergedTables if they exist
        orderData.id = editingOrderId;
        orderData.createdAt = editingOrder.createdAt;
        orderData.updatedAt = new Date().toISOString();
        
        // Preserve mergedTables info so the badge stays on the order card
        if (editingOrder.mergedTables && editingOrder.mergedTables.length > 0) {
          orderData.mergedTables = editingOrder.mergedTables;
        }
        
        // Preserve splitFromBillId and splitReference if they exist
        if (editingOrder.splitFromBillId) {
          orderData.splitFromBillId = editingOrder.splitFromBillId;
        }
        if (editingOrder.splitReference) {
          orderData.splitReference = editingOrder.splitReference;
        }

        if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
        await saveOrderToBackend(orderData);
        showToast('Order updated successfully!', 'success');
      } else {
        if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
        await saveOrderToBackend(orderData);
        showToast('Order saved successfully!', 'success');
      }
      
      currentOrderItems = [];
      originalOrderItems = [];
      editingOrderId = null;
      editingOrder = null;
      closeOrderModal();
      loadAndRenderOrders();
      return true;
    } catch (err) {
      console.error('Failed to save order:', err);
      showToast('Failed to save order: ' + err.message, 'error');
      return false;
    }
  }

  // Load and render all orders
  async function loadAndRenderOrders(){
    try {
      if (!BACKEND_AVAILABLE) throw new Error('backend_unreachable');
      await loadBusinessDayCutoff();
      const response = await fetchBackend('/api/orders/all');
      const orders = response.orders || [];
      // cache orders so we can filter/search locally
      allOrdersCache = (orders || []).map(normalizeLoadedOrder);
      const currentBusinessDayOrders = filterBusinessDayOrders(allOrdersCache);
      renderOrdersList(currentBusinessDayOrders);
      // update dashboard stats after loading orders
      updateDashboardStats();
      // update POS stats cards
      updatePOSStats();
      renderSalesPanel();
    } catch (err) {
      console.error('Failed to load orders:', err);
      alert('Cannot load orders: backend is required.');
    }
  }

  // Filter orders cache by query (table name or waiter)
  function filterOrdersByQuery(query){
    if (!query) return allOrdersCache;
    const q = query.trim().toLowerCase();
    return allOrdersCache.filter(o => {
      const table = (o.tableName || '').toLowerCase();
      const waiter = (o.waiterName || '').toLowerCase();
      return table.includes(q) || waiter.includes(q);
    });
  }

  // Filter orders by status
  function filterOrdersByStatus(orders, status){
    if (!status) return orders;
    return orders.filter(o => (o.status || 'pending') === status);
  }

  // Helper function to extract numeric table number for sorting
  function extractTableNumber(tableName) {
    if (!tableName) return Infinity;
    const match = tableName.match(/\d+/);
    return match ? parseInt(match[0], 10) : Infinity;
  }

  // Sort orders based on selected sort option
  function sortOrders(orders, sortBy) {
    const sorted = [...orders];
    
    switch(sortBy) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        break;
      case 'table-asc':
        sorted.sort((a, b) => extractTableNumber(a.tableName) - extractTableNumber(b.tableName));
        break;
      case 'table-desc':
        sorted.sort((a, b) => extractTableNumber(b.tableName) - extractTableNumber(a.tableName));
        break;
      case 'amount-asc':
        sorted.sort((a, b) => (a.totalAmount || 0) - (b.totalAmount || 0));
        break;
      case 'amount-desc':
        sorted.sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0));
        break;
      default:
        sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    
    return sorted;
  }

  // Update dashboard stats (revenue, waiters, items, orders)
  // Render reports: daily summary by item, category, voids, and payments
  function renderReports(){
    try{
      const tbodyItems = document.querySelector('#report-items-table tbody');
      const tbodyCats = document.querySelector('#report-categories-table tbody');
      const tbodyVoids = document.querySelector('#report-voided-table tbody');
      const paymentsEl = document.getElementById('report-payments');
      const reportDateEl = document.getElementById('report-date');

      // determine date range from controls
      const rangeInfo = getReportRange();
      const orders = (allOrdersCache || []).filter(o => {
        if(!o || !o.createdAt) return false;
        const d = new Date(o.createdAt);
        return d >= rangeInfo.start && d < rangeInfo.end;
      });

      // Aggregate by item
      const itemsMap = new Map();
      const categoryMap = new Map();
      const subcategoryMap = new Map();
      const paymentsMap = new Map();
      const voidedList = [];

      const categoryNames = Object.fromEntries((allCategories || []).map(c => [String(c.id), c.name || 'Uncategorized']));
      const subcategoryNames = Object.fromEntries((allSubcategories || []).map(sc => [String(sc.id), sc.name || 'Uncategorized']));
      const subcategoryParent = Object.fromEntries((allSubcategories || []).map(sc => [String(sc.id), String(sc.parent || '')]));

      orders.forEach(o => {
        // payments
        if(Array.isArray(o.payments) && o.payments.length){
          o.payments.forEach(p => {
            const key = (p.method || 'unknown').toLowerCase();
            paymentsMap.set(key, (paymentsMap.get(key) || 0) + (Number(p.amount) || 0));
          });
        } else if(o.paymentMethod){
          const key = String(o.paymentMethod).toLowerCase();
          paymentsMap.set(key, (paymentsMap.get(key) || 0) + (Number(o.totalAmount) || 0));
        }

        // items
        if(Array.isArray(o.items)){
          o.items.forEach(it => {
            const id = it.productId || it.productName || JSON.stringify(it);
            const name = it.productName || 'Unknown';
            const qty = Number(it.quantity || 0);
            const rev = Number(it.unitPrice || 0) * qty;
            if(!itemsMap.has(id)) itemsMap.set(id, { name, qty: 0, revenue: 0 });
            const cur = itemsMap.get(id);
            cur.qty += qty;
            cur.revenue += rev;

            // category aggregation via product lookup and root tracing
            const prod = (allProducts || []).find(p => String(p.id) === String(it.productId));
            let categoryName = prod ? categoryNames[String(prod.cat)] : '';
            let subcategoryName = prod ? subcategoryNames[String(prod.sub)] : '';
            const fallbackCategory = it.category || it.categoryName || '';
            const fallbackSubcategory = it.subcategory || it.subcategoryName || '';
            if(!categoryName && prod && prod.sub){
              const parentId = subcategoryParent[String(prod.sub)];
              if(parentId) categoryName = categoryNames[parentId] || categoryName;
            }
            if(!categoryName) categoryName = fallbackCategory || 'Uncategorized';
            if(!subcategoryName) subcategoryName = fallbackSubcategory || '';

            // Aggregate by category
            if(!categoryMap.has(categoryName)) categoryMap.set(categoryName, { items: 0, revenue: 0 });
            const ccur = categoryMap.get(categoryName);
            ccur.items += qty;
            ccur.revenue += rev;

            // Aggregate by subcategory alone once category is only used for grouping above
            const subKey = subcategoryName || 'Unspecified';
            if(!subcategoryMap.has(subKey)) subcategoryMap.set(subKey, { items: 0, revenue: 0 });
            const scur = subcategoryMap.get(subKey);
            scur.items += qty;
            scur.revenue += rev;
          });
        }

        // voided items
        if(Array.isArray(o.voidedItems) && o.voidedItems.length){
          o.voidedItems.forEach(v => {
            voidedList.push({ item: v.productName || v.name || 'Unknown', qty: v.quantity || 0, table: o.tableName || '—' });
          });
        }
      });

      // Render top items
      const itemsArr = Array.from(itemsMap.values()).sort((a,b)=> b.revenue - a.revenue).slice(0, 20);
      const itemTotal = Array.from(itemsMap.values()).reduce((sum, it) => sum + it.revenue, 0);
      if(tbodyItems){
        if(itemsArr.length === 0) tbodyItems.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>';
        else tbodyItems.innerHTML = itemsArr.map(it=>`<tr><td>${escapeHtml(it.name)}</td><td style="text-align:center">${it.qty}</td><td style="text-align:right">${formatCurrency(it.revenue)}</td></tr>`).join('');
      }
      const itemTotalEl = document.getElementById('report-item-total');
      if(itemTotalEl) itemTotalEl.textContent = `Total: ${formatCurrency(itemTotal)}`;

      // Render categories
      const catArr = Array.from(categoryMap.entries()).map(([k,v])=> ({k,items:v.items,revenue:v.revenue})).sort((a,b)=> b.revenue - a.revenue);
      const categoryTotal = catArr.reduce((sum, c) => sum + c.revenue, 0);
      if(tbodyCats){
        if(catArr.length === 0) tbodyCats.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>';
        else tbodyCats.innerHTML = catArr.map(c=>`<tr><td>${escapeHtml(c.k)}</td><td style="text-align:center">${c.items}</td><td style="text-align:right">${formatCurrency(c.revenue)}</td></tr>`).join('');
      }
      const categoryTotalEl = document.getElementById('report-category-total');
      if(categoryTotalEl) categoryTotalEl.textContent = `Total: ${formatCurrency(categoryTotal)}`;

      // Render subcategories
      const tbodySubs = document.querySelector('#report-subcategories-table tbody');
      if(tbodySubs){
        const subArr = Array.from(subcategoryMap.entries()).map(([k,v])=> ({ subcategory: k || 'Unspecified', items: v.items, revenue: v.revenue })).sort((a,b)=> b.revenue - a.revenue);
        if(subArr.length === 0) tbodySubs.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>';
        else tbodySubs.innerHTML = subArr.map(c=>`<tr><td>${escapeHtml(c.subcategory)}</td><td style="text-align:center">${c.items}</td><td style="text-align:right">${formatCurrency(c.revenue)}</td></tr>`).join('');
        const subcategoryTotal = subArr.reduce((sum, c) => sum + c.revenue, 0);
        const subcategoryTotalEl = document.getElementById('report-subcategory-total');
        if(subcategoryTotalEl) subcategoryTotalEl.textContent = `Total: ${formatCurrency(subcategoryTotal)}`;
      }

      // Voided items
      if(tbodyVoids){
        if(voidedList.length === 0) tbodyVoids.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No voided items</td></tr>';
        else tbodyVoids.innerHTML = voidedList.map(v=>`<tr><td>${escapeHtml(v.item)}</td><td style="text-align:center">${v.qty}</td><td>${escapeHtml(v.table)}</td></tr>`).join('');
      }

      // Payments breakdown
      if(paymentsEl){
        const paymentsList = Array.from(paymentsMap.entries()).map(([k,v])=> ({method:k,amount:v})).sort((a,b)=> b.amount - a.amount);
        if(paymentsList.length === 0) paymentsEl.querySelector('.report-payments-list').innerHTML = '<div class="muted" style="text-align:center;padding:12px;">No payments yet</div>';
        else paymentsEl.querySelector('.report-payments-list').innerHTML = paymentsList.map(p=>`<div class="report-payment-item"><div class="label">${escapeHtml(p.method.toUpperCase())}</div><div class="value">${formatCurrency(p.amount)}</div></div>`).join('');
      }
      // Render charts if Chart is available
      try{
        if(window.Chart){
          // Top items chart (revenue)
          const top = itemsArr.slice(0,8);
          const labels = top.map(i=>i.name);
          const data = top.map(i=>Math.round(i.revenue*100)/100);
          const ctxItems = document.getElementById('chart-top-items');
          if(ctxItems){
            ctxItems.parentElement.style.display = labels.length ? 'block' : 'none';
            if(window.chartTopItems){
              window.chartTopItems.data.labels = labels;
              window.chartTopItems.data.datasets[0].data = data;
              window.chartTopItems.update();
            } else {
              window.chartTopItems = new Chart(ctxItems, {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Revenue', data, backgroundColor: labels.map((_,i)=>['#60a5fa','#7c3aed','#34d399','#f59e0b','#fb7185','#60a5fa','#7dd3fc','#a78bfa'][i%8]) }] },
                options: { plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{callback: v => v }}} }
              });
            }
          }

          // Payments doughnut
          const payments = Array.from(paymentsMap.entries()).slice(0,8);
          const pLabels = payments.map(p=>p[0].toUpperCase());
          const pData = payments.map(p=>Math.round(p[1]*100)/100);
          const ctxPayments = document.getElementById('chart-payments');
          if(ctxPayments){
            ctxPayments.parentElement.style.display = pLabels.length ? 'block' : 'none';
            if(window.chartPayments){
              window.chartPayments.data.labels = pLabels;
              window.chartPayments.data.datasets[0].data = pData;
              window.chartPayments.update();
            } else {
              window.chartPayments = new Chart(ctxPayments, {
                type: 'doughnut',
                data: { labels: pLabels, datasets: [{ data: pData, backgroundColor: ['#60a5fa','#7c3aed','#34d399','#f59e0b','#fb7185','#60a5fa','#7dd3fc','#a78bfa'] }] },
                options: { plugins:{legend:{position:'bottom'}}, maintainAspectRatio: false }
              });
            }
          }
        }
      }catch(err){ console.warn('Chart render skipped', err); }
    }catch(err){ console.error('Failed to render reports', err); }
  }

  function renderSalesPanel(){
    const countEl = document.getElementById('sales-orders-count');
    const completedEl = document.getElementById('sales-completed-count');
    const pendingEl = document.getElementById('sales-pending-count');
    const revenueEl = document.getElementById('sales-revenue-amount');
    const rangeEl = document.getElementById('previous-sales-range');
    const tbody = document.getElementById('previous-sales-body');

    if(!tbody) return;
    const range = getPreviousBusinessDayRange(businessDayCutoff, new Date());
    const orders = filterPreviousBusinessDayOrders(allOrdersCache || []).sort((a,b)=> getOrderCreatedAt(b) - getOrderCreatedAt(a));
    const completedOrders = orders.filter(o => getOrderStatus(o) === 'completed');
    const pendingOrders = orders.filter(o => !isOrderClosed(o));
    const revenue = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    if(countEl) countEl.textContent = String(orders.length);
    if(completedEl) completedEl.textContent = String(completedOrders.length);
    if(pendingEl) pendingEl.textContent = String(pendingOrders.length);
    if(revenueEl) revenueEl.textContent = formatCurrency(revenue);
    if(rangeEl) rangeEl.textContent = `Range: ${range.start.toLocaleString()} — ${range.end.toLocaleString()}`;

    if(orders.length === 0){
      tbody.innerHTML = '<tr><td colspan="5" class="muted" style="padding:12px;text-align:center;">No previous business day orders found.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const createdAt = getOrderCreatedAt(o);
      const when = !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : '—';
      const status = getOrderStatus(o);
      const statusLabel = status === 'completed' ? 'Completed' : 'Pending';
      const badgeStyle = status === 'completed'
        ? 'background:rgba(16,185,129,0.14);color:#065f46;border:1px solid rgba(16,185,129,0.3);'
        : 'background:rgba(59,130,246,0.14);color:#1d4ed8;border:1px solid rgba(59,130,246,0.3);';
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid var(--border);">${when}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border);">${o.tableName || '—'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border);">${o.waiterName || '—'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border);"><span style="padding:4px 8px;border-radius:999px;font-size:0.82rem;${badgeStyle}">${statusLabel}</span></td>
          <td style="padding:8px;border-bottom:1px solid var(--border);text-align:right;">${formatCurrency(Number(o.totalAmount) || 0)}</td>
        </tr>
      `;
    }).join('');
  }

  // small helper to escape html
  function escapeHtml(str){ return String(str||'').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[s]); }

  function updateDashboardStats(){
    try{
      const revenueEl = document.getElementById('stat-revenue');
      const waitersEl = document.getElementById('stat-waiters');
      const itemsEl = document.getElementById('stat-items');
      const ordersEl = document.getElementById('stat-orders');
      const pendingEl = document.getElementById('stat-pending-orders');

      const orders = allOrdersCache || [];
      const range = getBusinessDayRange(businessDayCutoff, new Date());
      const currentDayOrders = (orders || []).filter(o => {
        const created = getOrderCreatedAt(o);
        return !Number.isNaN(created.getTime()) && created >= range.start && created < range.end;
      });

      const totalRevenue = currentDayOrders.reduce((sum, o) => {
        const status = String((o.status || '')).toLowerCase();
        if (status !== 'completed') return sum;
        const v = parseFloat(o.totalAmount || 0);
        return sum + (isNaN(v) ? 0 : v);
      }, 0);
      if(revenueEl) revenueEl.textContent = formatCurrency(totalRevenue);
      if(ordersEl) ordersEl.textContent = String(currentDayOrders.length || 0);
      if(pendingEl) pendingEl.textContent = String(currentDayOrders.filter(o => String((o.status || '')).toLowerCase() === 'pending').length || 0);
      if(waitersEl) waitersEl.textContent = String((allWaiters || []).length || 0);
      if(itemsEl) itemsEl.textContent = String((allProducts || []).length || 0);
      renderRecentSalesTable();
      // refresh reports panel when stats update
      if(typeof renderReports === 'function') renderReports();
    }catch(err){ console.error('Failed to update dashboard stats', err); }
  }

  // Compute start/end Date for reports based on controls
  function getReportRange(){
    const sel = document.getElementById('report-range');
    const startInput = document.getElementById('report-start');
    const endInput = document.getElementById('report-end');
    const now = new Date();
    let label = 'Today';
    let range = getBusinessDayRange(businessDayCutoff, now);
    if(sel){
      const v = sel.value || 'today';
      if(v === 'yesterday'){
        const yesterdayStart = new Date(range.start);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        range = { start: yesterdayStart, end: new Date(range.start) };
        label = 'Yesterday';
      } else if(v === 'this-week'){
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0,0,0,0);
        range = { start: startOfWeek, end: new Date(now.getTime()) };
        label = 'This Week';
      } else if(v === 'custom'){
        if(startInput && startInput.value) range.start = new Date(startInput.value + 'T00:00:00');
        if(endInput && endInput.value) range.end = new Date(endInput.value + 'T23:59:59');
        label = startInput && endInput && startInput.value && endInput.value ? `${new Date(range.start).toLocaleDateString()} - ${new Date(range.end).toLocaleDateString()}` : 'Custom Range';
      }
    }
    return { start: range.start, end: range.end, label };
  }

  // Wire report controls
  (function wireReportControls(){
    const sel = document.getElementById('report-range');
    const startInput = document.getElementById('report-start');
    const endInput = document.getElementById('report-end');
    const refresh = document.getElementById('btn-refresh-report');
    const exportBtn = document.getElementById('btn-export-report');

    if(sel){
      sel.addEventListener('change', ()=>{
        const custom = sel.value === 'custom';
        if(startInput) startInput.style.display = custom ? 'inline-block' : 'none';
        if(endInput) endInput.style.display = custom ? 'inline-block' : 'none';
        renderReports();
      });
    }
    if(startInput) startInput.addEventListener('change', ()=> renderReports());
    if(endInput) endInput.addEventListener('change', ()=> renderReports());
    if(refresh) refresh.addEventListener('click', ()=> renderReports());
    if(exportBtn) exportBtn.addEventListener('click', ()=> exportTopItemsCsv());
  })();

  function exportTopItemsCsv(){
    try{
      const range = getReportRange();
      const orders = (allOrdersCache || []).filter(o => o && o.createdAt && new Date(o.createdAt) >= range.start && new Date(o.createdAt) < range.end);
      const itemsMap = new Map();
      orders.forEach(o => {
        if(Array.isArray(o.items)){
          o.items.forEach(it=>{
            const id = it.productId || it.productName || JSON.stringify(it);
            const name = it.productName || 'Unknown';
            const qty = Number(it.quantity || 0);
            const rev = Number(it.unitPrice || 0) * qty;
            if(!itemsMap.has(id)) itemsMap.set(id, {name,qty:0,revenue:0});
            const cur = itemsMap.get(id); cur.qty += qty; cur.revenue += rev;
          });
        }
      });
      const rows = [['Name','Quantity','Revenue']].concat(Array.from(itemsMap.values()).map(r=>[r.name,r.qty,formatCurrency(r.revenue)]));
      const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `top-items-${Date.now()}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch(err){ console.error('Failed to export CSV', err); }
  }

  function renderRecentSalesTable(){
    const tbody = document.getElementById('recent-sales-body');
    const totalEl = document.getElementById('recent-sales-total');
    if(!tbody) return;

    const currentDayOrders = filterBusinessDayOrders(allOrdersCache || [])
      .sort((a,b)=> getOrderCreatedAt(b) - getOrderCreatedAt(a))
      .slice(0, 8);

    if(currentDayOrders.length === 0){
      tbody.innerHTML = '<tr><td colspan="7" class="muted" style="padding:12px;text-align:center;">No sales yet.</td></tr>';
      if(totalEl) totalEl.textContent = 'Total: ₦0.00';
      return;
    }

    const total = currentDayOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
    if(totalEl) totalEl.textContent = `Total: ${formatCurrency(total)}`;

    tbody.innerHTML = currentDayOrders.map((o)=>{
      const createdAt = getOrderCreatedAt(o);
      const when = Number.isNaN(createdAt.getTime()) ? '—' : createdAt.toLocaleString();
      const itemCount = Array.isArray(o.items) ? o.items.reduce((s, i)=> s + (Number(i.quantity) || 0), 0) : 0;
      const status = (o.status || 'pending').toLowerCase();
      const badgeStyle = status === 'completed'
        ? 'background:rgba(16,185,129,0.14);color:#065f46;border:1px solid rgba(16,185,129,0.3);'
        : 'background:rgba(59,130,246,0.14);color:#1d4ed8;border:1px solid rgba(59,130,246,0.3);';
      return `
        <tr data-order-id="${o.id || ''}" class="recent-sales-row">
          <td style="padding:8px;border-bottom:1px solid var(--border)">${when}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${o.tableName || '—'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${o.waiterName || '—'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${o.cashierName || '—'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${itemCount}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)"><span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;text-transform:capitalize;${badgeStyle}">${status}</span></td>
          <td style="padding:8px;border-bottom:1px solid var(--border);text-align:right;font-weight:600;">${formatCurrency(o.totalAmount || 0)}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr[data-order-id]').forEach(row => {
      row.addEventListener('click', () => {
        const orderId = row.dataset.orderId;
        if (!orderId) return;
        const order = (allOrdersCache || []).find(o => String(o.id) === orderId);
        if (order) {
          showOrderDetailsModal(order);
        }
      });
    });
  }

  // Wire report buttons (refresh and export)
  document.addEventListener('click', (ev)=>{
    const t = ev.target;
    if(!t) return;
    if(t.id === 'btn-refresh-report'){
      ev.preventDefault(); renderReports();
    }
    if(t.id === 'btn-export-report'){
      ev.preventDefault();
      // export top items as CSV
      try{
        const rows = [['Item','Qty','Revenue']];
        document.querySelectorAll('#report-items-table tbody tr').forEach(tr=>{
          const cols = Array.from(tr.querySelectorAll('td')).map(td=>td.textContent.trim());
          if(cols.length) rows.push(cols);
        });
        const csv = rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `report-items-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      }catch(err){ showToast('Failed to export report', 'error'); }
    }
  });

  // Render orders list with cards
  function renderOrdersList(orders){
    const container = document.getElementById('orders-container');
    if (!container) return;
    
    if (!orders || orders.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--muted); grid-column: 1/-1;">No orders yet. Create an order to get started.</div>';
      return;
    }
    
    container.innerHTML = '';
    
    orders.forEach(order => {
      const totalItems = (order.items || []).reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = order.totalAmount || 0;
      
      // Determine badge styling based on status and split info
      let statusBadgeStyle = '';
      let statusBadgeText = order.status || 'pending';
      let splitBadgeStyle = '';
      let splitBadgeText = '';
      
      // Status badge (always shown, unless completed)
      if (order.status === 'completed') {
        statusBadgeStyle = 'background: linear-gradient(90deg, #10b981, #059669);';
        statusBadgeText = 'Completed';
      } else {
        statusBadgeStyle = 'background: linear-gradient(90deg, #3b82f6, #2563eb);';
        statusBadgeText = 'Pending';
      }
      
      // Split badge (shown if bill is split or was split from another)
      if (order.splitFromBillId) {
        // This is a split bill - show different badge with place info
        splitBadgeStyle = 'background: linear-gradient(90deg, #f97316, #ea580c);';
        const placeInfo = order.splitPlace && order.splitTotal ? ` (${order.splitPlace}/${order.splitTotal})` : '';
        splitBadgeText = `🔀 Split${placeInfo}`;
      } else if (order.splitReference && order.splitPlace && order.splitTotal) {
        // This is an original bill that was split - show original badge with total places
        splitBadgeStyle = 'background: linear-gradient(90deg, #8b5cf6, #7c3aed);';
        splitBadgeText = `◆ Original (${order.splitTotal})`;
      } else if (order.splitReference) {
        // Old format without place info
        splitBadgeStyle = 'background: linear-gradient(90deg, #8b5cf6, #7c3aed);';
        splitBadgeText = '◆ Original';
      }
      
      const card = document.createElement('div');
      card.className = 'order-card';
      card.innerHTML = `
        <div class="order-card-header">
          <h4 class="order-card-title">${order.tableName}</h4>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="order-card-badge" style="${statusBadgeStyle}">
              ${statusBadgeText}
            </span>
            ${splitBadgeText ? `<span class="order-card-badge" style="${splitBadgeStyle}">${splitBadgeText}</span>` : ''}
          </div>
        </div>
        <div class="order-card-detail">
          <span class="order-card-label">Waiter:</span>
          <span class="order-card-value">${order.waiterName}</span>
        </div>
        ${order.clientName ? `
        <div class="order-card-detail">
          <span class="order-card-label">Client:</span>
          <span class="order-card-value">${order.clientName}</span>
        </div>
        ` : ''}
        <div class="order-card-detail">
          <span class="order-card-label">Items:</span>
          <span class="order-card-value">${totalItems}</span>
        </div>
        <div class="order-card-detail">
          <span class="order-card-label">Total:</span>
          <span class="order-card-value">${formatCurrency(totalAmount)}</span>
        </div>
        ${order.splitReference ? `
        <div style="background-color: ${order.splitFromBillId ? 'rgba(249, 115, 22, 0.08)' : 'rgba(139, 92, 246, 0.08)'}; padding: 8px; border-radius: 6px; margin-top: 8px; border-left: 3px solid ${order.splitFromBillId ? '#f97316' : '#8b5cf6'};">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span class="order-card-label">Ref:</span>
              <span class="order-card-value" style="font-family: monospace; font-size: 0.85rem;">${order.splitReference}</span>
            </div>
            ${order.splitPlace && order.splitTotal ? `
            <div style="background: ${order.splitFromBillId ? '#f97316' : '#8b5cf6'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">Place ${order.splitPlace}/${order.splitTotal}</div>
            ` : ''}
          </div>
        </div>
        ` : ''}
        ${order.mergedTables && order.mergedTables.length > 0 ? `
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 0.85rem; font-weight: 600; color: #666; margin-bottom: 8px;">Merged Tables:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${order.mergedTables.map((merged, idx) => {
              const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#f97316'];
              const color = colors[idx % colors.length];
              return `
                <div style="display: flex; align-items: center; gap: 6px; background: ${color}22; padding: 6px 10px; border-radius: 6px; border: 1px solid ${color}">
                  <div style="width: 24px; height: 24px; border-radius: 50%; background: ${color}; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.75rem;">${merged.tableName.replace(/[^0-9]/g, '').slice(-2) || '1'}</div>
                  <div style="font-size: 0.8rem; color: #333;">${merged.waiterName}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        ` : ''}
        <div class="order-card-actions" style="display: flex; justify-content: center; gap: 8px;">
          ${getOrderStatus(order) === 'completed' ? `
            <button class="btn btn-primary btn-view-order" data-order-id="${order.id}">View Details</button>
          ` : `
            <button class="btn btn-accent btn-edit-order" data-order-id="${order.id}" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); border: none;">Update Order</button>
            ${canDeleteOrder(order) ? `<button class="btn btn-danger btn-delete-order" data-order-id="${order.id}" style="border:none;">Delete</button>` : ''}
          `}
        </div>
      `;
      
      container.appendChild(card);
    });
  }

  // Edit order (load into modal)
  function editOrder(orderId){
    const order = editingOrder && editingOrder.id === orderId ? editingOrder : null;
    if (!order) {
      alert('Order not found');
      return;
    }
    openEditOrderModal(orderId, order);
  }

  // Void item (remove all items from current order edit)
  // Remove selected items via checkbox
  function removeSelectedItems(){
    const checkboxes = document.querySelectorAll('.item-checkbox:checked');
    if (checkboxes.length === 0) {
      alert('Please select items to remove');
      return;
    }
    
    if (!confirm(`Remove ${checkboxes.length} selected item(s)?`)) {
      return;
    }
    
    const indicesToRemove = [];
    checkboxes.forEach(checkbox => {
      const index = Number(checkbox.getAttribute('data-index'));
      if (index >= 0 && index < currentOrderItems.length) {
        indicesToRemove.push(index);
      }
    });
    
    // Remove items from highest index to lowest to avoid index shifting
    indicesToRemove.sort((a, b) => b - a);
    indicesToRemove.forEach(index => {
      currentOrderItems.splice(index, 1);
    });
    
    renderOrderItemsTable();
  }

  function voidItems(){
    const checkboxes = document.querySelectorAll('.item-checkbox:checked');
    if (checkboxes.length === 0) {
      showToast('Please select items to void', 'error');
      return;
    }
    
    // Collect items to void with their indices
    const itemsToVoid = [];
    checkboxes.forEach(checkbox => {
      const index = Number(checkbox.getAttribute('data-index'));
      if (index >= 0 && index < currentOrderItems.length) {
        const item = currentOrderItems[index];
        itemsToVoid.push({ index, item });
      }
    });
    
    if (itemsToVoid.length === 0) return;
    
    // Show void modal with quantity and remark inputs
    showVoidModal(itemsToVoid);
  }

  // Show modal for void quantity and remark
  function showVoidModal(itemsToVoid){
    const modal = document.createElement('div');
    modal.id = 'void-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;
    
    let formHTML = `
      <div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
        <h2 style="margin: 0 0 20px 0; font-size: 1.3rem; font-weight: 700;">Void Items - Confirm Details</h2>
        
        <div style="margin-bottom: 20px; padding: 12px; background: #f0f9ff; border-left: 4px solid #0284c7; border-radius: 4px;">
          <p style="margin: 0; font-size: 0.95rem; color: #333;">For each item selected, confirm the quantity to void and provide a remark for why it's being voided.</p>
        </div>
    `;
    
    // Add form for each item
    itemsToVoid.forEach((data, idx) => {
      const { index, item } = data;
      const uniqueId = `void-item-${idx}`;
      const qtyId = `void-qty-${idx}`;
      const remarkId = `void-remark-${idx}`;
      
      formHTML += `
        <div style="margin-bottom: 20px; padding: 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
          <div style="font-weight: 600; margin-bottom: 12px; font-size: 1rem; color: #1f2937;">${item.productName}</div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-weight: 500; margin-bottom: 6px; font-size: 0.95rem; color: #374151;">
              Quantity to Void
              ${item.quantity > 1 ? `<span style="color: #666;"> (Available: ${item.quantity})</span>` : ''}
            </label>
            <input type="number" id="${qtyId}" min="1" max="${item.quantity}" value="${item.quantity}" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.95rem;" />
          </div>
          
          <div>
            <label style="display: block; font-weight: 500; margin-bottom: 6px; font-size: 0.95rem; color: #374151;">
              Reason for Voiding
            </label>
            <input type="text" id="${remarkId}" placeholder="e.g., Customer request, Wrong order, Damaged item" style="width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.95rem;" />
          </div>
        </div>
      `;
    });
    
    formHTML += `
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px;">
        <button id="btn-cancel-void" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #f9fafb; border-radius: 4px; cursor: pointer; font-weight: 500;">Cancel</button>
        <button id="btn-confirm-void" style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">Confirm Void</button>
      </div>
      </div>
    `;
    
    modal.innerHTML = formHTML;
    document.body.appendChild(modal);
    
    // Handle cancel
    document.getElementById('btn-cancel-void').addEventListener('click', () => {
      modal.remove();
    });
    
    // Handle confirm
    document.getElementById('btn-confirm-void').addEventListener('click', () => {
      // Collect all void data
      const voidedItems = [];
      let voidRemark = '';
      let isValid = true;
      
      itemsToVoid.forEach((data, idx) => {
        const qtyInput = document.getElementById(`void-qty-${idx}`);
        const remarkInput = document.getElementById(`void-remark-${idx}`);
        
        if (!qtyInput || !remarkInput) return;
        
        const quantityToVoid = parseInt(qtyInput.value, 10);
        const remark = remarkInput.value.trim();
        
        // Validate quantity
        if (isNaN(quantityToVoid) || quantityToVoid <= 0 || quantityToVoid > data.item.quantity) {
          showToast(`Invalid quantity for ${data.item.productName}`, 'error');
          isValid = false;
          return;
        }
        
        // Create voided item
        const voidedItem = {
          productId: data.item.productId,
          productName: data.item.productName,
          unitPrice: data.item.unitPrice,
          quantity: quantityToVoid,
          remark: remark
        };
        voidedItems.push(voidedItem);
        
        // Collect remark (use first non-empty remark)
        if (!voidRemark && remark) {
          voidRemark = remark;
        }
      });
      
      if (!isValid) return;
      
      // Remove modal and confirm void action
      modal.remove();
      
      // Process void items
      if (voidedItems.length === 0) return;
      
      showConfirmDialog({
        title: 'Confirm Void',
        message: `Void ${voidedItems.reduce((sum, item) => sum + item.quantity, 0)} total item(s)?`,
        confirmText: 'Void Items',
        cancelText: 'Cancel',
        onConfirm: () => {
          // Update items in currentOrderItems
          const indicesToRemove = [];
          voidedItems.forEach(voidedItem => {
            // Find the item in currentOrderItems
            for (let i = 0; i < currentOrderItems.length; i++) {
              if (currentOrderItems[i].productId === voidedItem.productId && 
                  currentOrderItems[i].unitPrice === voidedItem.unitPrice) {
                // Check if voiding all or partial
                if (voidedItem.quantity < currentOrderItems[i].quantity) {
                  currentOrderItems[i].quantity -= voidedItem.quantity;
                } else {
                  indicesToRemove.push(i);
                }
                break;
              }
            }
          });
          
          // Remove items from highest index to lowest
          indicesToRemove.sort((a, b) => b - a);
          indicesToRemove.forEach(index => {
            currentOrderItems.splice(index, 1);
          });
          
          // Add voided items and remark to tracking
          currentVoidedItems.push(...voidedItems);
          currentVoidRemark = voidRemark;
          
          // Print voided items
          printVoidedItems(voidedItems, voidRemark);
          renderOrderItemsTable();
          
          // Update stats
          updatePOSStats();
          
          // Auto-save order
          console.log('voidItems: Auto-saving order after voiding items');
          saveOrder().then(() => {
            console.log('voidItems: Order saved, closing modal');
            closeOrderModal();
          }).catch(err => {
            console.error('voidItems: Failed to save order:', err);
            alert('Failed to save voided items. Please try again.');
          });
        }
      });
    });
  }

  // Remove selected items from create order (not void, just remove)
  function removeItem(){
    console.log('removeItem function called');
    const checkboxes = document.querySelectorAll('.item-checkbox:checked');
    console.log('Found checkboxes:', checkboxes.length);
    
    if (checkboxes.length === 0) {
      showToast('Please select items to remove', 'error');
      return;
    }
    
    const indicesToRemove = [];
    let needsQuantityDialog = false;
    
    // Check if any selected item has quantity > 1
    checkboxes.forEach(checkbox => {
      const index = Number(checkbox.getAttribute('data-index'));
      if (index >= 0 && index < currentOrderItems.length) {
        if (currentOrderItems[index].quantity > 1) {
          needsQuantityDialog = true;
        }
        indicesToRemove.push(index);
      }
    });
    
    if (indicesToRemove.length === 0) return;
    
    // If there's an item with quantity > 1, ask for specific quantities
    if (needsQuantityDialog && checkboxes.length === 1) {
      const index = indicesToRemove[0];
      const item = currentOrderItems[index];
      const maxQty = item.quantity;
      
      const quantityPrompt = prompt(`How many "${item.productName}" items do you want to remove?\n(Current quantity: ${maxQty})`, '1');
      
      if (quantityPrompt === null) {
        // User cancelled
        return;
      }
      
      const qtyToRemove = parseInt(quantityPrompt);
      
      if (isNaN(qtyToRemove) || qtyToRemove <= 0) {
        showToast('Invalid quantity', 'error');
        return;
      }
      
      if (qtyToRemove > maxQty) {
        showToast(`Cannot remove more than ${maxQty} items`, 'error');
        return;
      }
      
      if (qtyToRemove === maxQty) {
        // Remove the entire item
        currentOrderItems.splice(index, 1);
        showToast(`Removed ${qtyToRemove} "${item.productName}" from order`, 'success');
      } else {
        // Reduce the quantity
        currentOrderItems[index].quantity -= qtyToRemove;
        showToast(`Removed ${qtyToRemove} "${item.productName}" from order`, 'success');
      }
    } else if (needsQuantityDialog && checkboxes.length > 1) {
      showToast('Please select one item at a time to specify quantity', 'warning');
      return;
    } else {
      // Remove items without quantity dialog (all have qty = 1)
      // Remove items from highest index to lowest to avoid index shifting
      indicesToRemove.sort((a, b) => b - a);
      indicesToRemove.forEach(index => {
        currentOrderItems.splice(index, 1);
      });
      showToast(`Removed ${checkboxes.length} item(s) from order`, 'success');
    }
    
    renderOrderItemsTable();
  }

  // Remove entire order
  async function removeOrder(){
    if (!editingOrderId) {
      showToast('No order selected for removal', 'error');
      return;
    }

    const confirmed = await new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.setAttribute('aria-hidden', 'false');
      modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-order-title" style="max-width:420px;">
          <header class="modal-header">
            <h3 id="delete-order-title">Delete order?</h3>
            <button type="button" class="modal-close" aria-label="Close">✕</button>
          </header>
          <div class="modal-body">
            <p style="margin:0;">This action cannot be undone. Delete the selected order?</p>
          </div>
          <footer class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
            <button type="button" class="btn btn-ghost cancel-btn">Cancel</button>
            <button type="button" class="btn btn-danger confirm-btn">Delete</button>
          </footer>
        </div>
      `;
      document.body.appendChild(modal);
      const close = () => modal.remove();
      modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
      modal.querySelector('.modal-close')?.addEventListener('click', close);
      modal.querySelector('.cancel-btn')?.addEventListener('click', () => { close(); resolve(false); });
      modal.querySelector('.confirm-btn')?.addEventListener('click', () => { close(); resolve(true); });
    });

    if (!confirmed) {
      showToast('Delete cancelled', 'info', 2200);
      return;
    }
    
    try {
      if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
      await deleteOrderFromBackend(editingOrderId);
      
      showToast('Order deleted successfully', 'success');
      
      // Close the modal and refresh the orders list
      closeOrderModal();
      
      // Refresh orders display
      renderOrders();
    } catch (err) {
      console.error('removeOrder: Failed to delete order:', err);
      showToast(`Failed to delete order: ${err.message}`, 'error');
    }
  }

  // Print voided items
  function printVoidedItems(voidedItems, voidRemark){
    if (!voidedItems || voidedItems.length === 0) return;
    
    const tableName = document.getElementById('order-table')?.value || 'N/A';
    const waiterName = document.getElementById('order-waiter')?.value || 'N/A';
    
    // Format time with AM/PM
    const now = new Date();
    const timeFormatted = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Get selected event with details (same as thermal slip)
    let eventName = '';
    let eventLocation = '';
    if (selectedEventId) {
      const evt = allEvents.find(e => e.id === selectedEventId);
      eventName = evt?.name || '';
      eventLocation = evt?.location || '';
    }
    
    // Thermal printer format matching ORDER SLIP format
    let thermalHTML = `
      <html>
      <head>
        <title>Void Items Slip</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: Arial, Helvetica, sans-serif; 
            padding: 6px;
            max-width: 80mm;
            width: 100%;
            background: white;
            color: black;
            font-size: 13px;
            line-height: 1.3;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .event-header {
            text-align: center;
            margin-bottom: 8px;
            border-bottom: 1px solid #000;
            padding-bottom: 6px;
          }
          .event-name {
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .event-location {
            font-size: 11px;
            color: #333;
          }
          .title {
            text-align: center;
            font-weight: bold;
            font-size: 16px;
            text-transform: uppercase;
            margin: 8px 0;
            letter-spacing: 1px;
          }
          .warning-title {
            color: red;
            text-decoration: underline;
          }
          .order-info {
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
            font-size: 13px;
          }
          .info-label {
            font-weight: bold;
            min-width: 50px;
          }
          .info-value {
            flex: 1;
            text-align: right;
            padding-left: 10px;
          }
          .items-section {
            margin: 8px 0;
          }
          .items-header {
            font-weight: bold;
            font-size: 13px;
            border-bottom: 1px solid #000;
            padding-bottom: 4px;
            margin-bottom: 6px;
            text-transform: uppercase;
          }
          .item-row {
            display: grid;
            grid-template-columns: 1fr 48px;
            gap: 8px;
            margin: 4px 0;
            font-size: 12px;
            padding: 3px 0;
            border-bottom: 1px dotted #999;
            align-items: center;
          }
          .item-name {
            overflow-wrap: anywhere;
            word-break: break-word;
            font-weight: bold;
          }
          .item-qty {
            text-align: right;
            width: 48px;
            font-weight: bold;
          }
          .footer {
            text-align: center;
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
          }
          .footer-title {
            font-weight: bold;
            font-size: 13px;
            text-transform: uppercase;
            margin-bottom: 6px;
          }
          .footer-waiter {
            font-size: 12px;
            margin-top: 4px;
          }
          .remark-section {
            margin: 8px 0;
            padding: 8px 0;
            font-size: 12px;
            line-height: 1.4;
          }
          .remark-label {
            font-weight: bold;
            font-size: 12px;
            margin-bottom: 4px;
            text-transform: uppercase;
          }
          .remark-text {
            font-style: italic;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          @media print {
            body { margin: 0; padding: 5px; }
          }
        </style>
      </head>
      <body>
    `;
    
    // Add event header if event is selected
    if (eventName) {
      thermalHTML += `
        <div class="event-header">
          <div class="event-name">${eventName}</div>
          ${eventLocation ? `<div class="event-location">${eventLocation}</div>` : ''}
        </div>
      `;
    }
    
    // Add void slip title
    thermalHTML += `<div class="title"><span class="warning-title">⚠ VOID ITEMS ⚠</span></div>`;
    
    // Add order information
    thermalHTML += `
      <div class="order-info">
        <div class="info-row">
          <span class="info-label">Table:</span>
          <span class="info-value">${tableName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Waiter:</span>
          <span class="info-value">${waiterName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Time:</span>
          <span class="info-value">${timeFormatted}</span>
        </div>
      </div>
    `;
    
    // Add items section (only items and quantity, no total)
    thermalHTML += `<div class="items-section"><div class="items-header">Items Voided From Order</div>`;
    
    voidedItems.forEach(item => {
      const itemName = item.productName.substring(0, 40);
      thermalHTML += `
        <div class="item-row">
          <span class="item-name">${itemName}</span>
          <span class="item-qty">-${item.quantity}</span>
        </div>
      `;
    });
    
    thermalHTML += `</div>`;
    
    // Add void remark at the end
    if (voidRemark && voidRemark.trim()) {
      thermalHTML += `
        <div class="remark-section">
          <div class="remark-label">Reason:</div>
          <div class="remark-text">${voidRemark}</div>
        </div>
      `;
    }
    
    // Add footer
    thermalHTML += `
      <div class="footer">
        <div class="footer-title">VOIDED BY: ${waiterName}</div>
      </div>
      </body>
      </html>
    `;
    
    // Use safePrint to handle pop-up blocking and fallback to iframe
    safePrint(thermalHTML, 'height=600,width=350');
  }

  // Send order to kitchen (edit mode): print only new items then save updated order
  async function sendOrder(){
    if (!editingOrderId) return;
    
    // Validate that all required fields are filled
    const tableInput = document.getElementById('order-table');
    const waiterInput = document.getElementById('order-waiter');
    
    if (!tableInput || !tableInput.value.trim()) {
      showToast('Please fill in table name', 'error');
      tableInput?.focus();
      return;
    }
    
    if (!waiterInput || !waiterInput.value.trim()) {
      showToast('Please fill in waiter name', 'error');
      waiterInput?.focus();
      return;
    }
    
    // Check if table has an assigned waiter (not unassigned)
    const waiterName = waiterInput.value.trim();
    if (waiterName === '(No assigned waiter)' || waiterName === 'Unassigned' || !waiterName) {
      showToast('❌ Invalid table number! Please enter a table that has an assigned waiter.', 'error');
      tableInput.focus();
      return;
    }
    
    if (currentOrderItems.length === 0) {
      showToast('Please add at least one item to the order', 'error');
      return;
    }
    
    // When editing, no confirmation needed - just save and print new items
    console.log('sendOrder (edit mode): saving order and printing new items');
    
    // Determine which items to print BEFORE saveOrder clears the state
    // Use the same improved logic as printThermalSlip
    let itemsToPrint = currentOrderItems;
    if (originalOrderItems.length > 0) {
      // Create items to print with only the new quantity added
      itemsToPrint = [];
      
      currentOrderItems.forEach(currentItem => {
        // Find if this item existed in the original order
        const origItem = originalOrderItems.find(item => 
          item.productId === currentItem.productId && 
          item.unitPrice === currentItem.unitPrice
        );
        
        if (!origItem) {
          // This is a completely new item - print the full quantity
          itemsToPrint.push(currentItem);
        } else if (origItem.quantity < currentItem.quantity) {
          // This item's quantity increased - print only the added quantity
          itemsToPrint.push({
            productId: currentItem.productId,
            productName: currentItem.productName,
            unitPrice: currentItem.unitPrice,
            quantity: currentItem.quantity - origItem.quantity, // Only the added quantity
            isQuantityAddition: true, // Flag to indicate this is an addition to existing item
            originalQuantity: origItem.quantity,
            newTotal: currentItem.quantity
          });
        }
        // If quantity decreased or stayed the same, don't print anything for this item
      });
    }
    
    // Save first to update stock and DB
    const saved = await saveOrder();
    if (!saved) return;
    
    try{
      // After saveOrder, currentOrderItems is cleared, so temporarily restore the items to print
      if (itemsToPrint.length > 0) {
        currentOrderItems = itemsToPrint;
        printThermalSlip();
        currentOrderItems = []; // Clear again after printing
      } else {
        console.log('No new items to print');
        showToast('No new items to print', 'info');
      }
    }catch(e){ console.warn('Print failed', e); }
  }

  // Join tables - merge items from one table to another
  function joinTables(){
    if (allOrdersCache.length < 2) {
      alert('You need at least 2 orders to join tables');
      return;
    }

    // Get only pending orders
    const pendingOrders = allOrdersCache.filter(o => o.status === 'pending');
    if (pendingOrders.length < 2) {
      alert('You need at least 2 pending orders to join tables');
      return;
    }

    const modal = document.getElementById('order-modal');
    if (!modal) return;

    // Build select options for source and target tables
    let sourceOptions = '';
    let targetOptions = '';
    pendingOrders.forEach(order => {
      sourceOptions += `<option value="${order.id}">${order.tableName} (${(order.items || []).reduce((sum, item) => sum + item.quantity, 0)} items)</option>`;
      targetOptions += `<option value="${order.id}">${order.tableName} (${(order.items || []).reduce((sum, item) => sum + item.quantity, 0)} items)</option>`;
    });

    const joinModalHTML = `
      <div style="padding: 20px;">
        <h3 style="margin: 0 0 16px 0; font-size: 1.2rem; font-weight: 700;">Join Tables</h3>
        
        <div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.9rem; color: #333;">Select the source table (items to move) and target table (destination). All items from source will be added to target.</p>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 8px;">Source Table (Move From)</label>
            <select id="join-source-table" class="input" style="width: 100%;">
              <option value="">-- Select table --</option>
              ${sourceOptions}
            </select>
          </div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 8px;">Target Table (Move To)</label>
            <select id="join-target-table" class="input" style="width: 100%;">
              <option value="">-- Select table --</option>
              ${targetOptions}
            </select>
          </div>
        </div>
        
        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.9rem; color: #856404;"><strong>Note:</strong> After joining, the source table's order will be deleted and all items will be merged into the target table.</p>
        </div>

        <div id="join-confirm-section" style="display:none; background: #f8fafc; border: 1px solid #93c5fd; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
          <p id="join-confirm-text" style="margin: 0; font-size: 0.95rem; color: #1e3a8a;"></p>
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-ghost" id="btn-cancel-join" style="margin: 0;">Cancel</button>
          <button class="btn btn-accent" id="btn-confirm-join" style="margin: 0;">Join Tables</button>
        </div>
      </div>
    `;

    const modalPanel = modal.querySelector('.modal-panel');
    modalPanel.innerHTML = joinModalHTML;
    
    modal.setAttribute('aria-hidden', 'false');
    modal.removeAttribute('inert');
    
    // Wire up join buttons
    const btnCancel = document.getElementById('btn-cancel-join');
    const btnConfirm = document.getElementById('btn-confirm-join');
    const sourceSelect = document.getElementById('join-source-table');
    const targetSelect = document.getElementById('join-target-table');
    
    // Helper function to update target options when source changes
    function updateTargetOptions(){
      const sourceId = sourceSelect?.value;
      const currentTargetValue = targetSelect?.value;
      
      // Rebuild target options, excluding the selected source
      let newTargetOptions = '<option value="">-- Select table --</option>';
      pendingOrders.forEach(order => {
        // Skip the source table in target options
        if (order.id != sourceId) {
          newTargetOptions += `<option value="${order.id}">${order.tableName} (${(order.items || []).reduce((sum, item) => sum + item.quantity, 0)} items)</option>`;
        }
      });
      
      if (targetSelect) {
        targetSelect.innerHTML = newTargetOptions;
        // Reset target selection if the previously selected one is now excluded
        if (currentTargetValue === sourceId) {
          targetSelect.value = '';
        }
      }
    }
    
    function resetJoinConfirmation() {
      if (btnConfirm) {
        btnConfirm.textContent = 'Join Tables';
        delete btnConfirm.dataset.confirmed;
      }
      const confirmSection = document.getElementById('join-confirm-section');
      if (confirmSection) {
        confirmSection.style.display = 'none';
      }
      const confirmText = document.getElementById('join-confirm-text');
      if (confirmText) {
        confirmText.textContent = '';
      }
    }

    function renderJoinConfirmation() {
      const sourceId = sourceSelect?.value;
      const targetId = targetSelect?.value;
      const confirmSection = document.getElementById('join-confirm-section');
      const confirmText = document.getElementById('join-confirm-text');

      if (!sourceId || !targetId || sourceId === targetId) {
        resetJoinConfirmation();
        return;
      }

      const sourceOrder = allOrdersCache.find(o => String(o.id) === String(sourceId));
      const targetOrder = allOrdersCache.find(o => String(o.id) === String(targetId));

      if (!sourceOrder || !targetOrder) {
        resetJoinConfirmation();
        return;
      }

      if (confirmSection) {
        confirmSection.style.display = 'block';
      }
      if (confirmText) {
        confirmText.textContent = `Ready to move ${(sourceOrder.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0)} items from ${sourceOrder.tableName} into ${targetOrder.tableName}. Click Join Tables again to confirm.`;
      }
    }

    // Update target options when source is selected
    if (sourceSelect) {
      sourceSelect.addEventListener('change', () => {
        updateTargetOptions();
        renderJoinConfirmation();
      });
    }
    if (targetSelect) {
      targetSelect.addEventListener('change', renderJoinConfirmation);
    }
    
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        resetJoinConfirmation();
        closeOrderModal();
      });
    }
    
    if (btnConfirm) {
      btnConfirm.addEventListener('click', async () => {
        const sourceId = sourceSelect?.value;
        const targetId = targetSelect?.value;
        
        if (!sourceId || !targetId) {
          alert('Please select both source and target tables');
          return;
        }
        
        if (sourceId === targetId) {
          alert('Source and target tables must be different');
          return;
        }
        
        // Get orders from cache
        const sourceOrder = allOrdersCache.find(o => String(o.id) === String(sourceId));
        const targetOrder = allOrdersCache.find(o => String(o.id) === String(targetId));
        
        if (!sourceOrder || !targetOrder) {
          alert('Orders not found');
          return;
        }
        
        if (!btnConfirm.dataset.confirmed) {
          renderJoinConfirmation();
          if (btnConfirm) {
            btnConfirm.textContent = 'Confirm Join';
            btnConfirm.dataset.confirmed = 'true';
          }
          return;
        }
        
        try {
          // Deep clone items from both orders
          const targetItems = (targetOrder.items || []).map(item => ({
            productId: item.productId,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity
          }));
          
          const sourceItems = (sourceOrder.items || []).map(item => ({
            productId: item.productId,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity
          }));
          
          // Merge all items from both tables
          const mergedItems = [...targetItems, ...sourceItems];
          
          // Calculate combined total
          let newSubtotal = 0;
          mergedItems.forEach(item => {
            newSubtotal += item.unitPrice * item.quantity;
          });
          
          const newBreakdown = calculateBillingBreakdown(newSubtotal);
          
          // Combine waiter names if different
          const combinedWaiter = sourceOrder.waiterName === targetOrder.waiterName 
            ? targetOrder.waiterName 
            : `${targetOrder.waiterName} & ${sourceOrder.waiterName}`;
          
          // Create a brand new merged order
          const mergedOrder = {
            tableName: targetOrder.tableName,
            waiterName: combinedWaiter,
            clientName: targetOrder.clientName || '',
            cashierName: getCurrentCashierName(),
            createdBy: getCurrentCashierName(),
            items: mergedItems,
            status: 'pending',
            subtotal: newSubtotal,
            billingBreakdown: newBreakdown,
            totalAmount: newBreakdown.total,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            mergedTables: [
              {
                tableName: sourceOrder.tableName,
                waiterName: sourceOrder.waiterName,
                joinedAt: new Date().toISOString()
              }
            ]
          };
          
          // Persist the merged target order and remove the source order from the backend
          await syncOrdersToBackend([mergedOrder]);
          await deleteOrderFromBackend(sourceId);
          
          // Refresh orders list and clear editing state
          await loadAndRenderOrders();
          editingOrderId = null;
          editingOrder = null;
          currentOrderItems = [];
          originalOrderItems = [];
          
          closeOrderModal();
          alert(`Successfully merged ${sourceOrder.tableName} with ${targetOrder.tableName}!\nMerged items: ${mergedItems.length}\nWaiters: ${combinedWaiter}`);
        } catch (err) {
          console.error('Join tables error:', err);
          alert('Error joining tables: ' + err.message);
        }
      });
    }
  }

  // Print bill
  function printBill(splitReference = null){
    console.log('printBill called with splitReference:', splitReference);
    console.log('editingOrderId:', editingOrderId);
    console.log('currentOrderItems length:', currentOrderItems.length);
    console.log('editingOrder items length:', editingOrder?.items?.length);
    
    if (!editingOrderId && currentOrderItems.length === 0) {
      console.warn('printBill: No items to print');
      alert('No items to print');
      return;
    }
    
    // Check if there are unsaved items by comparing currentOrderItems with editingOrder.items
    if (editingOrder && editingOrder.items) {
      const savedItems = editingOrder.items || [];
      const currentItems = currentOrderItems || [];
      
      // If counts don't match, there are unsaved items
      if (currentItems.length !== savedItems.length) {
        console.warn('printBill: Unsaved items detected - item count mismatch');
        showToast('⚠️ You have unsaved items! Please click "Send Order" to save before printing.', 'warning');
        return;
      }
      
      // Also check if the actual items are different (by comparing product IDs and quantities)
      for (let i = 0; i < currentItems.length; i++) {
        const currentItem = currentItems[i];
        const savedItem = savedItems[i];
        
        if (!savedItem || 
            currentItem.productId !== savedItem.productId || 
            currentItem.quantity !== savedItem.quantity ||
            currentItem.unitPrice !== savedItem.unitPrice) {
          console.warn('printBill: Unsaved items detected - item details mismatch');
          showToast('⚠️ You have unsaved items! Please click "Send Order" to save before printing.', 'warning');
          return;
        }
      }
    }
    
    try {
      // Get event name and phone from events data
      const event = selectedEventId ? allEvents.find(e => e.id == selectedEventId) : null;
      const eventName = event?.name || 'Standard';
      const eventPhone = event?.phone || '';
      const tableName = editingOrder?.tableName || document.getElementById('order-table')?.value || 'N/A';
      const waiterName = editingOrder?.waiterName || document.getElementById('order-waiter')?.value || 'N/A';
      const clientName = editingOrder?.clientName || document.getElementById('order-client')?.value || '';
      const receiptBusinessName = receiptSettings.businessName || eventName;
      const receiptAddress = receiptSettings.address;
      const receiptPhone = receiptSettings.phone || eventPhone;
      const receiptEmail = receiptSettings.email;
      const receiptFooterMessage = receiptSettings.footerMessage || 'Please come again soon';
      
      console.log('printBill: eventName:', eventName, 'eventPhone:', eventPhone);
      console.log('printBill: tableName:', tableName, 'waiterName:', waiterName);
    
      // Calculate billing breakdown
      let subtotal = 0;
      currentOrderItems.forEach(item => {
        subtotal += item.unitPrice * item.quantity;
      });
      const breakdown = calculateBillingBreakdown(subtotal);
      
      // Generate receipt timestamp
      const now = new Date();
      const receiptDate = now.toLocaleDateString('en-NG');
      const receiptTime = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    
    let billHTML = `
      <html>
      <head>
        <title>Receipt - ${tableName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: Arial, Helvetica, sans-serif; 
            padding: 6px;
            max-width: 80mm;
            width: 100%;
            background-color: white;
            color: #000;
            line-height: 1.3;
            font-size: 13px;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          
          /* Header Section */
          .receipt-header {
            text-align: center;
            margin-bottom: 8px;
            border-bottom: 1px solid #000;
            padding-bottom: 6px;
          }
          
          .event-name {
            font-weight: bold;
            font-size: 16px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          
          .receipt-label {
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          
          .datetime {
            font-size: 11px;
            color: #333;
          }
          
          /* Order Info Section */
          .order-info {
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
          }
          
          .info-row {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
            font-size: 13px;
          }
          
          .info-label {
            font-weight: bold;
            min-width: 50px;
          }
          
          .info-value {
            flex: 1;
            text-align: right;
            padding-left: 10px;
          }
          
          /* Split Info (only shown if split) */
          .split-warning {
            background-color: #fff3cd;
            border: 1px solid #ffc107;
            padding: 6px;
            margin: 8px 0;
            text-align: center;
            font-weight: bold;
            color: #856404;
            font-size: 12px;
          }
          
          /* Items Section */
          .items-header {
            font-weight: bold;
            font-size: 13px;
            border-bottom: 1px solid #000;
            padding-bottom: 4px;
            margin: 8px 0 6px 0;
            text-transform: uppercase;
          }
          
          .items-title {
            font-weight: bold;
            text-transform: uppercase;
            font-size: 13px;
          }
          
          .item-header-row {
            display: grid;
            grid-template-columns: 1fr 30px 75px;
            gap: 3px;
            padding: 4px 0;
            border-bottom: 1px dotted #999;
            font-weight: bold;
            font-size: 11px;
          }
          
          .item-header-row span:nth-child(2),
          .item-header-row span:nth-child(3) {
            text-align: right;
          }
          
          .items-body {
            margin-bottom: 8px;
          }
          
          .item-row {
            display: grid;
            grid-template-columns: 1fr 30px 75px;
            gap: 3px;
            padding: 3px 0;
            border-bottom: 1px dotted #999;
            font-size: 11px;
            align-items: center;
            word-break: break-word;
          }
          
          .item-name {
            font-weight: bold;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          
          .item-qty {
            text-align: center;
            width: 30px;
            font-weight: bold;
          }
          
          .item-total {
            text-align: right;
            width: 75px;
            font-weight: bold;
          }
          
          /* Billing Summary Section */
          .billing-summary {
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
          }
          
          .summary-title {
            font-weight: bold;
            text-transform: uppercase;
            font-size: 13px;
            border-bottom: 1px solid #000;
            padding-bottom: 4px;
            margin-bottom: 6px;
          }
          
          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 3px 0;
            font-size: 12px;
            margin: 3px 0;
          }
          
          .summary-label {
            font-weight: 600;
          }
          
          .summary-value {
            text-align: right;
            font-weight: bold;
          }
          
          .subtotal-row {
            border-bottom: 1px dotted #999;
            padding-bottom: 3px;
            margin-bottom: 3px;
          }
          
          .grand-total-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 16px;
            font-weight: bold;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
            margin-top: 6px;
          }
          
          /* Footer Section */
          .receipt-footer {
            text-align: center;
            padding: 8px 0;
            border-top: 1px solid #000;
            font-size: 12px;
            margin-top: 8px;
          }
          
          .thank-you {
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          
          .footer-text {
            font-size: 11px;
            color: #333;
            margin-top: 2px;
          }
          
          @media print {
            body {
              background-color: white;
              padding: 5px;
              margin: 0;
              max-width: 80mm;
              width: 80mm;
            }
          }
        </style>
      </head>
      <body>
        <!-- Header with Receipt Settings -->
        <div class="receipt-header">
          <div class="business-name">${receiptBusinessName}</div>
          ${receiptAddress ? `<div class="business-contact">${receiptAddress}</div>` : ''}
          ${receiptPhone ? `<div class="business-contact">📞 ${receiptPhone}</div>` : ''}
          ${receiptEmail ? `<div class="business-contact">${receiptEmail}</div>` : ''}
          <div class="receipt-label">Receipt</div>
          <div class="datetime">${receiptDate} | ${receiptTime}</div>
        </div>
        
        <!-- Order Information -->
        <div class="order-info">
          <div class="info-row">
            <span class="info-label">Table:</span>
            <span class="info-value">${tableName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Waiter:</span>
            <span class="info-value">${waiterName}</span>
          </div>
          ${clientName ? `
          <div class="info-row">
            <span class="info-label">Client:</span>
            <span class="info-value">${clientName}</span>
          </div>
          ` : ''}
        </div>
        
        <!-- Split Bill Warning (only if split) -->
        ${splitReference && typeof splitReference === 'string' ? `<div class="split-warning">⚠ SPLIT BILL #${splitReference}</div>` : ''}
        
        <!-- Items Section -->
        <div class="items-header">
          <div class="items-title">Items Ordered</div>
        </div>
        
        <div class="item-header-row">
          <span>Product</span>
          <span>Qty</span>
          <span>Total</span>
        </div>
        
        <div class="items-body">
    `;
    
    currentOrderItems.forEach(item => {
      const itemTotal = item.unitPrice * item.quantity;
      billHTML += `
        <div class="item-row">
          <span class="item-name">${item.productName}</span>
          <span class="item-qty">x${item.quantity}</span>
          <span class="item-total">${formatCurrency(itemTotal)}</span>
        </div>
      `;
    });
    
    billHTML += `
        </div>
        
        <!-- Billing Summary -->
        <div class="billing-summary">
          <div class="summary-title">Billing Summary</div>
          
          <div class="summary-row subtotal-row">
            <span class="summary-label">Subtotal</span>
            <span class="summary-value">${formatCurrency(breakdown.subtotal)}</span>
          </div>
          
          ${breakdown.discount > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Discount</span>
            <span class="summary-value">-${formatCurrency(breakdown.discount)}</span>
          </div>
          ` : ''}
          
          ${breakdown.tax > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Tax (${breakdown.taxPercentage}%)</span>
            <span class="summary-value">+${formatCurrency(breakdown.tax)}</span>
          </div>
          ` : ''}
          
          ${breakdown.serviceCharge > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Service (${breakdown.serviceChargePercentage}%)</span>
            <span class="summary-value">+${formatCurrency(breakdown.serviceCharge)}</span>
          </div>
          ` : ''}
          
          <div class="grand-total-row">
            <span>TOTAL DUE</span>
            <span>${formatCurrency(breakdown.total)}</span>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="receipt-footer">
          <div class="thank-you">Thank You!</div>
          <div class="footer-text">${receiptFooterMessage}</div>
        </div>
      </body>
      </html>
    `;
    
    // Use safePrint to handle pop-up blocking and fallback to iframe
    safePrint(billHTML, 'height=600,width=450');
    console.log('printBill: Print sent successfully');
    } catch (err) {
      console.error('printBill error:', err);
      showToast('Error printing bill: ' + err.message, 'error');
    }
  }

  // Print receipt in thermal format for close bill modal
  function printReceiptThermal(order){
    if (!order) {
      console.warn('printReceiptThermal: No order provided');
      alert('No order data available to print');
      return;
    }
    
    // Ensure items array exists and has items
    const items = order.items || [];
    if (!items || items.length === 0) {
      console.warn('printReceiptThermal: Order has no items', order);
      alert('No items to print');
      return;
    }

    // Get event name and phone from events data or enriched order
    const eventName = selectedEventId ? (allEvents.find(e => e.id == selectedEventId)?.name || 'Standard') : 'Standard';
    const eventPhone = order.eventPhone || (selectedEventId ? (allEvents.find(e => e.id == selectedEventId)?.phone || '') : '');
    const tableName = order.tableName || 'N/A';
    const waiterName = order.waiterName || 'N/A';
    const clientName = order.clientName || '';
    const receiptBusinessName = receiptSettings.businessName || eventName;
    const receiptAddress = receiptSettings.address;
    const receiptPhone = receiptSettings.phone || eventPhone;
    const receiptEmail = receiptSettings.email;
    const receiptFooterMessage = receiptSettings.footerMessage || 'Please come again soon';

    // Calculate billing breakdown
    let subtotal = 0;
    items.forEach(item => {
      subtotal += (item.price || item.unitPrice) * item.quantity;
    });
    const breakdown = calculateBillingBreakdown(subtotal);

    // Generate receipt timestamp
    const now = new Date();
    const receiptDate = now.toLocaleDateString('en-NG');
    const receiptTime = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });

    let billHTML = `
      <html>
      <head>
        <title>Receipt - ${tableName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: Arial, Helvetica, sans-serif; 
            padding: 6px;
            max-width: 80mm;
            width: 100%;
            background-color: white;
            color: #000;
            line-height: 1.3;
            font-size: 13px;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          
          /* Header Section */
          .receipt-header {
            text-align: center;
            margin-bottom: 8px;
            border-bottom: 1px solid #000;
            padding-bottom: 6px;
          }
          
          .event-name {
            font-weight: bold;
            font-size: 16px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          
          .receipt-label {
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          
          .datetime {
            font-size: 11px;
            color: #333;
          }
          
          /* Order Info Section */
          .order-info {
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
          }
          
          .info-row {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
            font-size: 13px;
          }
          
          .info-label {
            font-weight: bold;
            min-width: 50px;
          }
          
          .info-value {
            flex: 1;
            text-align: right;
            padding-left: 10px;
          }
          
          /* Items Section */
          .item-header-row {
            display: grid;
            grid-template-columns: 1fr 30px 75px;
            gap: 3px;
            padding: 4px 0;
            border-bottom: 1px dotted #999;
            font-weight: bold;
            font-size: 11px;
          }
          
          .item-header-row span:nth-child(2),
          .item-header-row span:nth-child(3) {
            text-align: right;
          }
          
          .items-body {
            margin-bottom: 8px;
          }
          
          .item-row {
            display: grid;
            grid-template-columns: 1fr 30px 75px;
            gap: 3px;
            padding: 3px 0;
            border-bottom: 1px dotted #999;
            font-size: 11px;
            align-items: center;
            word-break: break-word;
          }
          
          .item-name {
            font-weight: bold;
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          
          .item-qty {
            text-align: center;
            width: 30px;
            font-weight: bold;
          }
          
          .item-total {
            text-align: right;
            width: 75px;
            font-weight: bold;
          }
          
          /* Billing Summary */
          .billing-summary {
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
          }
          
          .summary-title {
            font-weight: bold;
            margin-bottom: 4px;
            font-size: 12px;
          }
          
          .summary-row {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            margin: 2px 0;
          }
          
          .summary-label {
            flex: 1;
          }
          
          .summary-value {
            text-align: right;
            min-width: 50px;
          }
          
          .subtotal-row {
            font-weight: bold;
          }
          
          .grand-total-row {
            font-weight: bold;
            font-size: 13px;
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px dashed #000;
          }
          
          .grand-total-row span:first-child {
            flex: 1;
          }
          
          .grand-total-row span:last-child {
            text-align: right;
            min-width: 60px;
          }
          
          /* Footer */
          .receipt-footer {
            text-align: center;
            margin-top: 8px;
            font-size: 11px;
          }
          
          .thank-you {
            font-weight: bold;
            margin-bottom: 3px;
          }
          
          .footer-text {
            color: #333;
            font-size: 10px;
          }
        </style>
      </head>
      <body>
        <div class="receipt-header">
          <div class="business-name">${receiptBusinessName}</div>
          ${receiptAddress ? `<div class="business-contact">${receiptAddress}</div>` : ''}
          ${receiptPhone ? `<div class="business-contact">📞 ${receiptPhone}</div>` : ''}
          ${receiptEmail ? `<div class="business-contact">${receiptEmail}</div>` : ''}
          <div class="receipt-label">Receipt</div>
          <div class="datetime">${receiptDate} ${receiptTime}</div>
        </div>
        
        <div class="order-info">
          <div class="info-row">
            <span class="info-label">Table:</span>
            <span class="info-value">${tableName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Waiter:</span>
            <span class="info-value">${waiterName}</span>
          </div>
          ${clientName ? `
          <div class="info-row">
            <span class="info-label">Client:</span>
            <span class="info-value">${clientName}</span>
          </div>
          ` : ''}
        </div>
        
        <div class="item-header-row">
          <span>Product</span>
          <span>Qty</span>
          <span>Total</span>
        </div>
        
        <div class="items-body">
    `;

    items.forEach(item => {
      const itemTotal = (item.price || item.unitPrice) * item.quantity;
      billHTML += `
        <div class="item-row">
          <span class="item-name">${item.productName}</span>
          <span class="item-qty">x${item.quantity}</span>
          <span class="item-total">${formatCurrency(itemTotal)}</span>
        </div>
      `;
    });

    billHTML += `
        </div>
        
        <!-- Billing Summary -->
        <div class="billing-summary">
          <div class="summary-title">Billing Summary</div>
          
          <div class="summary-row subtotal-row">
            <span class="summary-label">Subtotal</span>
            <span class="summary-value">${formatCurrency(breakdown.subtotal)}</span>
          </div>
          
          ${breakdown.discount > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Discount</span>
            <span class="summary-value">-${formatCurrency(breakdown.discount)}</span>
          </div>
          ` : ''}
          
          ${breakdown.tax > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Tax (${breakdown.taxPercentage}%)</span>
            <span class="summary-value">+${formatCurrency(breakdown.tax)}</span>
          </div>
          ` : ''}
          
          ${breakdown.serviceCharge > 0 ? `
          <div class="summary-row">
            <span class="summary-label">Service (${breakdown.serviceChargePercentage}%)</span>
            <span class="summary-value">+${formatCurrency(breakdown.serviceCharge)}</span>
          </div>
          ` : ''}
          
          <div class="grand-total-row">
            <span>TOTAL DUE</span>
            <span>${formatCurrency(breakdown.total)}</span>
          </div>
        </div>
        
        <!-- Footer -->
        <div class="receipt-footer">
          <div class="thank-you">Thank You!</div>
          <div class="footer-text">${receiptFooterMessage}</div>
        </div>
      </body>
      </html>
    `;

    // Use safePrint to handle pop-up blocking and fallback to iframe
    safePrint(billHTML, 'height=600,width=450');
  }

  // Split bill (enhanced version with read-only fields and proper UI)
  // Multi-step split bill process
  async function splitBill(){
    // If no order is being edited, show a list to select from
    if (!editingOrderId) {
      const modal = document.getElementById('order-modal');
      if (!modal) return;

      // Store original modal content
      const originalHTML = modal.innerHTML;
      const oldPanel = modal.querySelector('.modal-panel');
      if (oldPanel) {
        const clonedPanel = oldPanel.cloneNode(true);
        modal.replaceChild(clonedPanel, oldPanel);
      }

      modal.setAttribute('aria-hidden', 'false');
      modal.removeAttribute('inert');

      const modalPanel = modal.querySelector('.modal-panel');

      // Get pending orders (not completed)
      const pendingOrders = allOrdersCache.filter(order => order.status !== 'completed');

      if (pendingOrders.length === 0) {
        alert('No pending orders to split');
        return;
      }

      // Build orders list
      let ordersHTML = '<div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border); padding: 10px; border-radius: 8px;">';
      
      pendingOrders.forEach(order => {
        const totalAmount = order.items ? order.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0) : 0;
        ordersHTML += `
          <div class="order-list-item" style="padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer; display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; border-radius: 6px; transition: background 0.2s;" data-order-id="${order.id}">
            <div>
              <div style="font-weight: 600; margin-bottom: 4px;">${order.tableName}</div>
              <div style="font-size: 0.9em; color: var(--text-muted);">
                Waiter: ${order.waiterName} | Items: ${order.items ? order.items.length : 0}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; font-size: 1.1em;">${formatCurrency(totalAmount)}</div>
            </div>
          </div>
        `;
      });

      ordersHTML += '</div>';

      modalPanel.innerHTML = `
        <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between;">
          <h3 style="margin:0;">Split Bill - Select Order</h3>
          <button id="btn-close-select-order" class="btn btn-ghost" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div style="padding: 12px; background: #e8f4f8; border-left: 4px solid #0891b2; border-radius: 4px; margin-bottom: 16px;">
            <p style="margin: 0; font-size: 0.9em;"><strong>Select an order to split:</strong></p>
          </div>
          
          ${ordersHTML}
        </div>
        <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap;">
          <button id="btn-cancel-select-order" class="btn btn-ghost">Cancel</button>
        </div>
      `;

      const closeHandler = () => {
        // Reset split bill state
        editingOrderId = null;
        editingOrder = null;
        currentOrderItems = [];
        originalOrderItems = [];
        
        modal.innerHTML = originalHTML;
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
        rewireModalButtons();
      };

      document.getElementById('btn-close-select-order').addEventListener('click', closeHandler, { once: true });
      document.getElementById('btn-cancel-select-order').addEventListener('click', closeHandler, { once: true });

      // Wire up order selection
      document.querySelectorAll('.order-list-item').forEach(item => {
        item.addEventListener('click', async () => {
          const orderId = item.getAttribute('data-order-id');
          const order = allOrdersCache.find(o => String(o.id) === String(orderId));

          if (!order) {
            alert('Order not found');
            return;
          }

          // Load this order into editing state
          editingOrderId = orderId;
          editingOrder = order;
          currentOrderItems = order.items || [];
          originalOrderItems = JSON.parse(JSON.stringify(currentOrderItems));

          // Close the selection modal
          modal.innerHTML = originalHTML;
          modal.setAttribute('aria-hidden', 'true');
          modal.setAttribute('inert', '');
          rewireModalButtons();

          // Now proceed with the split bill flow
          splitBillForOrder();
        });
      });

      return;
    }

    // If an order is being edited, proceed with split bill flow
    splitBillForOrder();
  }

  // Split bill flow for a selected order
  async function splitBillForOrder(){
    if (!editingOrderId) {
      alert('You must be editing an order to split a bill');
      return;
    }
    
    if (currentOrderItems.length === 0) {
      alert('No items to split');
      return;
    }

    const modal = document.getElementById('order-modal');
    if (!modal) return;

    // Store original modal content and clean up any leftover event listeners
    const originalHTML = modal.innerHTML;
    const oldPanel = modal.querySelector('.modal-panel');
    if (oldPanel) {
      const clonedPanel = oldPanel.cloneNode(true);
      modal.replaceChild(clonedPanel, oldPanel);
    }
    
    modal.setAttribute('aria-hidden', 'false');
    modal.removeAttribute('inert');
    
    const modalPanel = modal.querySelector('.modal-panel');
    
    // Step 1: Ask which table bill to split and how many places
    const showStep1 = () => {
      let splitPlaces = 2;
      
      modalPanel.innerHTML = `
        <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between;">
          <h3 style="margin:0;">Split Bill - Step 1 of 2</h3>
          <button id="btn-close-split" class="btn btn-ghost" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div style="padding: 12px; background: #e8f4f8; border-left: 4px solid #0891b2; border-radius: 4px; margin-bottom: 16px;">
            <p style="margin: 0; font-size: 0.9em;"><strong>Step 1 of 2:</strong> Configure split details</p>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #333;">Original Bill Information:</label>
            <div style="padding: 12px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #3b82f6;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div>
                  <div style="font-size: 0.85em; color: #666; margin-bottom: 4px;">Table Number:</div>
                  <div style="font-size: 1.1em; font-weight: 700; color: #000;">${editingOrder.tableName}</div>
                </div>
                <div>
                  <div style="font-size: 0.85em; color: #666; margin-bottom: 4px;">Waiter:</div>
                  <div style="font-size: 1.1em; font-weight: 700; color: #000;">${editingOrder.waiterName}</div>
                </div>
              </div>
            </div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label for="split-places" style="display: block; font-weight: 600; margin-bottom: 8px; color: #333;">
              How many places do you want to split this bill into?
            </label>
            <div style="display: flex; align-items: center; gap: 12px;">
              <input type="number" id="split-places" min="2" max="20" value="2" style="width: 80px; padding: 10px; border: 2px solid #3b82f6; border-radius: 6px; font-size: 1em; font-weight: 600; text-align: center;" />
              <span style="font-size: 0.9em; color: #666;">places (minimum 2)</span>
            </div>
            <p style="margin: 12px 0 0 0; font-size: 0.85em; color: #666;">You can then distribute items among the different places</p>
          </div>
          
          <div style="padding: 12px; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px;">
            <p style="margin: 0; font-size: 0.9em;"><strong>Note:</strong> Each split bill will have its own reference number and can be paid separately.</p>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap;">
          <button id="btn-cancel-split" class="btn btn-ghost">Cancel</button>
          <button id="btn-next-split" class="btn btn-accent">Next: Select Items</button>
        </div>
      `;
      
      const placesInput = document.getElementById('split-places');
      const closeHandler = () => {
        modal.innerHTML = originalHTML;
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
        rewireModalButtons();
      };
      
      document.getElementById('btn-close-split').addEventListener('click', closeHandler, { once: true });
      document.getElementById('btn-cancel-split').addEventListener('click', closeHandler, { once: true });
      
      document.getElementById('btn-next-split').addEventListener('click', () => {
        splitPlaces = parseInt(placesInput.value) || 2;
        if (splitPlaces < 2 || splitPlaces > 20) {
          alert('Please enter a valid number between 2 and 20');
          return;
        }
        showStep2(splitPlaces);
      }, { once: true });
    };
    
    // Step 2: Distribute items among split places
    const showStep2 = (numPlaces) => {
      // Initialize distribution - stores {itemIndex: {place: quantity}}
      const itemDistribution = {};
      currentOrderItems.forEach((item, index) => {
        itemDistribution[index] = {};
        itemDistribution[index][1] = item.quantity; // Default all to place 1
      });
      
      let itemsHTML = `<div style="max-height: 450px; overflow-y: auto; border: 1px solid var(--border); padding: 10px; border-radius: 8px;">`;
      
      currentOrderItems.forEach((item, index) => {
        const itemTotal = item.unitPrice * item.quantity;
        let placeInputsHTML = '';
        for (let i = 1; i <= numPlaces; i++) {
          if (i === 1) {
            // P1 (original bill) - show as read-only label with auto-calculated remaining quantity
            placeInputsHTML += `
              <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <label style="font-weight: 600; font-size: 0.9em;">P1:</label>
                <input type="number" id="qty-${index}-place-${i}" class="place-qty-input place-1-qty" data-item-index="${index}" data-place="${i}" min="0" max="${item.quantity}" value="${item.quantity}" style="width: 50px; padding: 4px; border: 1px solid var(--border); border-radius: 4px; text-align: center; font-size: 0.9em; background: #f0f0f0; color: #666; cursor: not-allowed;" readonly />
              </div>
            `;
          } else {
            // P2, P3, etc - editable
            placeInputsHTML += `
              <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <label for="qty-${index}-place-${i}" style="font-weight: 600; font-size: 0.9em;">P${i}:</label>
                <input type="number" id="qty-${index}-place-${i}" class="place-qty-input other-place-qty" data-item-index="${index}" data-place="${i}" min="0" max="${item.quantity}" value="0" style="width: 50px; padding: 4px; border: 1px solid var(--border); border-radius: 4px; text-align: center; font-size: 0.9em;" />
              </div>
            `;
          }
        }
        
        itemsHTML += `
          <div style="padding: 12px; border-bottom: 1px solid var(--border); background: #f9fafb; border-radius: 4px; margin-bottom: 8px;">
            <div style="font-weight: 600; margin-bottom: 8px;">${item.productName}</div>
            <div style="font-size: 0.85em; color: var(--text-muted); margin-bottom: 10px;">
              Available: ${item.quantity} units @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(itemTotal)}
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px;">
              ${placeInputsHTML}
            </div>
          </div>
        `;
      });
      
      itemsHTML += '</div>';
      
      let placeAmountsHTML = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 16px;">';
      for (let i = 1; i <= numPlaces; i++) {
        placeAmountsHTML += `
          <div style="padding: 12px; background: #f3f4f6; border-radius: 6px; border: 2px solid #e5e7eb;">
            <div style="font-size: 0.85em; color: #666; margin-bottom: 4px; font-weight: 600;">Place ${i}</div>
            <div style="font-size: 1.2em; font-weight: 700; color: #2563eb;" id="place-${i}-total">₦0.00</div>
          </div>
        `;
      }
      placeAmountsHTML += '</div>';
      
      modalPanel.innerHTML = `
        <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between;">
          <h3 style="margin:0;">Split Bill - Step 2 of 2</h3>
          <button id="btn-close-split" class="btn btn-ghost" aria-label="Close">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; height: 100%;">
          <div style="padding: 12px; background: #e8f4f8; border-left: 4px solid #0891b2; border-radius: 4px; margin-bottom: 16px;">
            <p style="margin: 0; font-size: 0.9em;"><strong>Step 2 of 2:</strong> Distribute items across ${numPlaces} place(s)</p>
          </div>
          
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #333;">Amount per Place:</label>
            ${placeAmountsHTML}
          </div>
          
          <!-- Distribution Summary Table -->
          <div style="margin-bottom: 16px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
            <div style="background: #f3f4f6; padding: 10px; font-weight: 600; font-size: 0.95rem; color: #333;">Distribution Summary</div>
            <div style="overflow-x: auto; max-height: 250px; overflow-y: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                <thead style="background: #e5e7eb; position: sticky; top: 0;">
                  <tr style="border-bottom: 1px solid var(--border);">
                    <th style="padding: 8px; text-align: left; font-weight: 600;">Item</th>
                    <th style="padding: 8px; text-align: center; font-weight: 600;">Original</th>
                    ${Array.from({length: numPlaces}, (_, i) => `<th style="padding: 8px; text-align: center; font-weight: 600; background: ${i === 0 ? '#f0f0f0' : '#fff'};">P${i + 1}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${currentOrderItems.map((item, idx) => `
                    <tr style="border-bottom: 1px solid var(--border); background: ${idx % 2 === 0 ? '#fff' : '#f9fafb'};">
                      <td style="padding: 8px; text-align: left;">${item.productName}</td>
                      <td style="padding: 8px; text-align: center; font-weight: 600;">${item.quantity}</td>
                      ${Array.from({length: numPlaces}, (_, i) => `<td style="padding: 8px; text-align: center; background: ${i === 0 ? '#f0f0f0' : '#fff'};" id="summary-qty-${idx}-${i + 1}">-</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          
          <div style="margin-bottom: 12px;">
            <p style="margin: 0; font-weight: 600; color: #333;">Edit quantities below:</p>
            <p style="margin: 4px 0 0 0; font-size: 0.85em; color: #666;">P1 (grey) updates automatically as you adjust other places</p>
          </div>
          
          <div style="flex: 1; overflow-y: auto;">
            ${itemsHTML}
          </div>
        </div>
        <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap;">
          <button id="btn-back-split" class="btn btn-secondary">Back</button>
          <button id="btn-cancel-split" class="btn btn-ghost">Cancel</button>
          <button id="btn-confirm-split" class="btn btn-accent">Create Split Bills</button>
        </div>
      `;
      
      // Apply wider width to modal-panel for Step 2
      modalPanel.style.maxWidth = '1400px';
      modalPanel.style.width = '90vw';
      
      const otherPlaceInputs = document.querySelectorAll('.other-place-qty');
      const updateSummaries = () => {
        // Calculate totals from P2 onwards and auto-adjust P1
        const itemQtysPerPlace = {};
        for (let i = 1; i <= numPlaces; i++) {
          itemQtysPerPlace[i] = {};
        }
        
        // Collect quantities for P2 onwards (editable inputs)
        document.querySelectorAll('.other-place-qty').forEach(input => {
          const place = parseInt(input.getAttribute('data-place'));
          const itemIndex = parseInt(input.getAttribute('data-item-index'));
          const quantity = parseInt(input.value) || 0;
          itemQtysPerPlace[place][itemIndex] = quantity;
        });
        
        // Auto-calculate P1 quantities by subtracting P2+ from original
        currentOrderItems.forEach((item, index) => {
          let totalMovedQty = 0;
          for (let place = 2; place <= numPlaces; place++) {
            totalMovedQty += itemQtysPerPlace[place][index] || 0;
          }
          
          // Validate that total doesn't exceed original quantity
          if (totalMovedQty > item.quantity) {
            // Too much moved, reset the input
            const changedInput = document.querySelector('.other-place-qty:focus');
            if (changedInput) changedInput.value = Math.max(0, item.quantity - (totalMovedQty - (parseInt(changedInput.value) || 0)));
            totalMovedQty = item.quantity;
          }
          
          // Set P1 quantity to remaining
          const p1Input = document.getElementById(`qty-${index}-place-1`);
          if (p1Input) p1Input.value = item.quantity - totalMovedQty;
          
          // Update distribution summary table
          for (let place = 1; place <= numPlaces; place++) {
            const summaryCell = document.getElementById(`summary-qty-${index}-${place}`);
            if (summaryCell) {
              summaryCell.textContent = document.getElementById(`qty-${index}-place-${place}`)?.value || 0;
            }
          }
        });
        
        // Calculate place totals
        const placeAmounts = {};
        for (let i = 1; i <= numPlaces; i++) {
          placeAmounts[i] = 0;
        }
        
        document.querySelectorAll('.place-qty-input').forEach(input => {
          const place = parseInt(input.getAttribute('data-place'));
          const itemIndex = parseInt(input.getAttribute('data-item-index'));
          const quantity = parseInt(input.value) || 0;
          const item = currentOrderItems[itemIndex];
          placeAmounts[place] += item.unitPrice * quantity;
        });
        
        for (let i = 1; i <= numPlaces; i++) {
          const el = document.getElementById(`place-${i}-total`);
          if (el) el.textContent = formatCurrency(placeAmounts[i]);
        }
      };
      
      otherPlaceInputs.forEach(input => {
        input.addEventListener('change', updateSummaries);
        input.addEventListener('input', updateSummaries);
      });
      
      // Initial update
      updateSummaries();
      
      const closeHandler = () => {
        modal.innerHTML = originalHTML;
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('inert', '');
        rewireModalButtons();
      };
      
      document.getElementById('btn-close-split').addEventListener('click', closeHandler, { once: true });
      document.getElementById('btn-cancel-split').addEventListener('click', closeHandler, { once: true });
      document.getElementById('btn-back-split').addEventListener('click', showStep1, { once: true });
      
      document.getElementById('btn-confirm-split').addEventListener('click', async () => {
        try {
          // Validate distribution - collect items by place with quantities
          const placeDistribution = {};
          for (let i = 1; i <= numPlaces; i++) {
            placeDistribution[i] = [];
          }
          
          document.querySelectorAll('.place-qty-input').forEach(input => {
            const place = parseInt(input.getAttribute('data-place'));
            const itemIndex = parseInt(input.getAttribute('data-item-index'));
            const quantity = parseInt(input.value) || 0;
            
            if (quantity > 0) {
              const item = currentOrderItems[itemIndex];
              placeDistribution[place].push({
                ...item,
                quantity: quantity,
                originalIndex: itemIndex
              });
            }
          });
          
          // Check if all places have at least one item
          let emptyPlaces = [];
          for (let i = 1; i <= numPlaces; i++) {
            if (placeDistribution[i].length === 0) {
              emptyPlaces.push(i);
            }
          }
          
          if (emptyPlaces.length > 0) {
            alert(`Place(s) ${emptyPlaces.join(', ')} have no items assigned. Please assign items to all places or reduce the number of places.`);
            return;
          }
          
          // Create split reference
          const splitReference = String(editingOrderId).substring(0, 8).toUpperCase();
          const ordersToSync = [];
          
          // Create a split bill for each place (except the first one stays as original)
          for (let place = 1; place <= numPlaces; place++) {
            const items = placeDistribution[place];
            const itemsTotal = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
            
            // Calculate billing breakdown for split bill (includes tax and service charge)
            const splitBreakdown = calculateBillingBreakdown(itemsTotal);
            
            if (place === 1) {
              // Update original order with items from place 1 and update totalAmount to reflect moved items
              const updatedOrder = {
                ...editingOrder,
                id: editingOrder.id,
                items: items,
                subtotal: itemsTotal,
                billingBreakdown: {
                  taxPercentage: billingSettings.taxPercentage,
                  tax: splitBreakdown.tax,
                  serviceChargePercentage: billingSettings.serviceChargePercentage,
                  serviceCharge: splitBreakdown.serviceCharge,
                  discountPercentage: billingSettings.discountPercentage,
                  discount: splitBreakdown.discount
                },
                totalAmount: splitBreakdown.total,
                splitReference: `SPLIT-${splitReference}`,
                splitPlace: 1,
                splitTotal: numPlaces,
                updatedAt: new Date().toISOString()
              };
              
              ordersToSync.push(updatedOrder);
              editingOrder = updatedOrder; // Update in-memory copy
              currentOrderItems = items; // Update current items to reflect split
            } else {
              // Create new order for each additional place
              const { id: _removedId, ...restOrder } = editingOrder;
              const newOrderData = {
                ...restOrder,
                tableName: editingOrder.tableName,
                waiterName: editingOrder.waiterName,
                clientName: editingOrder.clientName || '',
                cashierName: getCurrentCashierName(),
                createdBy: getCurrentCashierName(),
                items: items,
                status: 'pending',
                subtotal: itemsTotal,
                billingBreakdown: {
                  taxPercentage: billingSettings.taxPercentage,
                  tax: splitBreakdown.tax,
                  serviceChargePercentage: billingSettings.serviceChargePercentage,
                  serviceCharge: splitBreakdown.serviceCharge,
                  discountPercentage: billingSettings.discountPercentage,
                  discount: splitBreakdown.discount
                },
                totalAmount: splitBreakdown.total,
                splitFromBillId: editingOrder.id,
                splitReference: `SPLIT-${splitReference}`,
                splitPlace: place,
                splitTotal: numPlaces,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              
              ordersToSync.push(newOrderData);
            }
          }

          await syncOrdersToBackend(ordersToSync);
          
          // Close the split dialog
          modal.innerHTML = originalHTML;
          modal.setAttribute('aria-hidden', 'true');
          modal.setAttribute('inert', '');
          rewireModalButtons();
          
          // Reload and display updated orders
          await loadAndRenderOrders();
          
          const splitDetails = [];
          for (let place = 1; place <= numPlaces; place++) {
            const items = placeDistribution[place];
            const amount = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
            splitDetails.push(`Place ${place}: ₦${amount.toFixed(2)}`);
          }
          
          alert(`Bill split successfully into ${numPlaces} places!\n\n${splitDetails.join('\n')}\n\nReference: SPLIT-${splitReference}`);
          
          // Reset modal state and close
          currentOrderItems = [];
          editingOrderId = null;
          editingOrder = null;
          originalOrderItems = [];
          closeOrderModal();
        } catch (err) {
          console.error('Split bill error:', err);
          alert('Error splitting bill: ' + err.message);
          
          // Restore modal on error
          modal.innerHTML = originalHTML;
          modal.setAttribute('aria-hidden', 'true');
          modal.setAttribute('inert', '');
          rewireModalButtons();
        }
      }, { once: true });
    };
    
    // Start with step 1
    showStep1();
  }

  // Close bill - mark order as completed
  async function closeBill(){
    if (!editingOrderId) return;
    
    // Show payment modal instead of confirm dialog
    showPaymentModal();
  }

  // Payment modal
  function showPaymentModal(){
    if (!editingOrder) return;
    
    const billTotal = editingOrder.totalAmount || 0;
    const totalFormatted = formatCurrency(billTotal);
    
    // Get billing breakdown if available
    const breakdown = editingOrder.billingBreakdown || {
      taxPercentage: 0,
      tax: 0,
      serviceChargePercentage: 0,
      serviceCharge: 0,
      discountPercentage: 0,
      discount: 0
    };
    const subtotal = editingOrder.subtotal || billTotal;
    
    // Build breakdown HTML
    let breakdownHTML = '';
    if (breakdown.discount > 0 || breakdown.tax > 0 || breakdown.serviceCharge > 0) {
      let breakdownContent = '';
      breakdownContent += '<div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Subtotal:</span><span>' + formatCurrency(subtotal) + '</span></div>';
      
      if (breakdown.discount > 0) {
        breakdownContent += '<div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: #10b981;"><span>Discount (' + breakdown.discountPercentage + '%):</span><span>-' + formatCurrency(breakdown.discount) + '</span></div>';
      }
      if (breakdown.tax > 0) {
        breakdownContent += '<div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Tax (' + breakdown.taxPercentage + '%):</span><span>+' + formatCurrency(breakdown.tax) + '</span></div>';
      }
      if (breakdown.serviceCharge > 0) {
        breakdownContent += '<div style="display: flex; justify-content: space-between; margin-bottom: 6px;"><span>Service Charge (' + breakdown.serviceChargePercentage + '%):</span><span>+' + formatCurrency(breakdown.serviceCharge) + '</span></div>';
      }
      
      breakdownHTML = '<div style="background: #f3e8ff; padding: 12px; border-radius: 6px; margin-bottom: 16px; border-left: 4px solid #9333ea;"><div style="font-weight: 600; margin-bottom: 8px; color: #7e22ce;">Bill Breakdown</div><div style="font-size: 0.9rem;">' + breakdownContent + '</div></div>';
    }
    
    // Store original modal content to restore on cancel
    const modal = document.getElementById('order-modal');
    if (!modal) return;
    const originalHTML = modal.innerHTML;
    
    // Create payment modal HTML
    const paymentModalHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px; padding: 0;">
        <div style="padding: 20px; border-bottom: 1px solid #e5e7eb;">
          <h3 style="margin: 0; font-size: 1.3rem; font-weight: 700;">Close Bill - Payment</h3>
        </div>
        
        <div style="padding: 0 20px; overflow-y: auto; flex: 1;">
          ${breakdownHTML}
          
          <div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
            <div style="font-size: 0.9rem; color: #666; margin-bottom: 4px;">Final Bill Total</div>
            <div style="font-size: 1.8rem; font-weight: 700; color: #0284c7;">${totalFormatted}</div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <div style="font-weight: 600; margin-bottom: 12px;">Select Payment Methods</div>
            
            <div id="payment-methods" style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px;">
              <div style="padding: 12px; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="payment-method-card" data-method="cash">
                <input type="checkbox" class="payment-method-checkbox" value="cash" style="margin-right: 8px;">
                <label style="cursor: pointer; font-weight: 600;">💵 Cash</label>
              </div>
              <div style="padding: 12px; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="payment-method-card" data-method="pos">
                <input type="checkbox" class="payment-method-checkbox" value="pos" style="margin-right: 8px;">
                <label style="cursor: pointer; font-weight: 600;">💳 POS Card</label>
              </div>
              <div style="padding: 12px; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="payment-method-card" data-method="transfer">
                <input type="checkbox" class="payment-method-checkbox" value="transfer" style="margin-right: 8px;">
                <label style="cursor: pointer; font-weight: 600;">📱 Bank Transfer</label>
              </div>
              <div style="padding: 12px; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="payment-method-card" data-method="credit">
                <input type="checkbox" class="payment-method-checkbox" value="credit" style="margin-right: 8px;">
                <label style="cursor: pointer; font-weight: 600;">📝 Credit</label>
              </div>
            </div>
            
            <div id="payment-amounts-section" style="display: none; margin-bottom: 16px; padding: 12px; background: #f9fafb; border-radius: 6px;">
              <div style="font-weight: 600; margin-bottom: 12px;">Enter Amount for Each Method</div>
              <div id="payment-amounts-container" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
              </div>
            </div>
          </div>
          
          <div style="background: #f0fdf4; padding: 12px; border-radius: 6px; margin-bottom: 16px; border-left: 4px solid #10b981;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 600;">Bill Total:</span>
              <span style="font-weight: 700; color: #0284c7;">${totalFormatted}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 600;">Total Paid:</span>
              <span style="font-weight: 700; color: #10b981; font-size: 1.1rem;" id="total-paid">₦0.00</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid #ccc;">
              <span style="font-weight: 600;">Remaining Balance:</span>
              <span style="font-weight: 700; color: #dc2626; font-size: 1.1rem;" id="remaining-balance">${totalFormatted}</span>
            </div>
          </div>
          
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 16px;">
            <button class="btn btn-secondary" id="btn-validate-payment" style="margin: 0;">Validate Payment</button>
          </div>
          
          <div id="payment-validation-breakdown" style="display: none; margin-bottom: 16px; padding: 12px; background: #f3e8ff; border-radius: 6px; border-left: 4px solid #9333ea;">
            <div style="font-weight: 600; margin-bottom: 10px; color: #7e22ce;">Payment Breakdown</div>
            <div id="validation-breakdown-content" style="font-size: 0.9rem;">
            </div>
          </div>
        </div>
        
        <div style="padding: 20px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; justify-content: flex-end;">
          <button class="btn btn-ghost" id="btn-cancel-payment" style="margin: 0;">Cancel</button>
          <button class="btn btn-success" id="btn-confirm-payment" style="margin: 0;">Confirm Payment & Close Bill</button>
        </div>
      </div>
    `;
    
    const modalPanel = modal.querySelector('.modal-panel');
    modalPanel.innerHTML = paymentModalHTML;
    
    modal.setAttribute('aria-hidden', 'false');
    modal.removeAttribute('inert');
    
    // Wire up payment method checkboxes
    const methodCards = document.querySelectorAll('.payment-method-card');
    const amountsSection = document.getElementById('payment-amounts-section');
    const amountsContainer = document.getElementById('payment-amounts-container');
    
    methodCards.forEach(card => {
      const checkbox = card.querySelector('.payment-method-checkbox');
      
      card.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        updatePaymentMethods();
      });
      
      checkbox.addEventListener('change', updatePaymentMethods);
    });
    
    // Store payment amounts across method changes
    const paymentAmounts = {};
    
    function updatePaymentMethods(){
      const selected = Array.from(document.querySelectorAll('.payment-method-checkbox:checked')).map(cb => {
        const label = cb.parentElement.querySelector('label').textContent.trim();
        return { method: cb.value, label: label };
      });
      
      // Clear previous inputs
      amountsContainer.innerHTML = '';
      
      if(selected.length > 0){
        amountsSection.style.display = 'block';
        
        selected.forEach((sel, index) => {
          const inputDiv = document.createElement('div');
          inputDiv.style.cssText = 'display: flex; gap: 8px; align-items: center;';
          
          // Determine auto-populated amount
          let autoAmount = 0;
          if (Object.keys(paymentAmounts).length === 0 && index === 0) {
            // First method selected - auto-populate with total
            autoAmount = billTotal;
          } else if (paymentAmounts[sel.method] !== undefined) {
            // This method was previously selected - keep its amount
            autoAmount = paymentAmounts[sel.method];
          } else if (index > 0) {
            // Additional method - calculate remaining balance
            let totalPaid = Object.values(paymentAmounts).reduce((sum, val) => sum + val, 0);
            autoAmount = Math.max(0, billTotal - totalPaid);
          }
          
          inputDiv.innerHTML = `
            <label style="min-width: 100px; font-weight: 600;">${sel.label}:</label>
            <input type="number" class="input payment-amount-input" data-method="${sel.method}" placeholder="Enter amount" value="${autoAmount}" min="0" step="0.01" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 6px;" />
          `;
          amountsContainer.appendChild(inputDiv);
        });
        
        // Wire amount inputs and store amounts on change
        document.querySelectorAll('.payment-amount-input').forEach(input => {
          input.addEventListener('input', function() {
            // Store the current amount for this method
            paymentAmounts[this.dataset.method] = parseFloat(this.value || 0);
            updateTotalPaid();
          });
          
          // Store initial value
          paymentAmounts[input.dataset.method] = parseFloat(input.value || 0);
        });
        
        updateTotalPaid();
      } else {
        amountsSection.style.display = 'none';
        // Clear stored amounts when all methods are deselected
        Object.keys(paymentAmounts).forEach(key => delete paymentAmounts[key]);
        updateTotalPaid();
      }
    }
    
    function updateTotalPaid(){
      let total = 0;
      document.querySelectorAll('.payment-amount-input').forEach(input => {
        total += parseFloat(input.value || 0);
      });
      const totalPaidEl = document.getElementById('total-paid');
      if(totalPaidEl) totalPaidEl.textContent = formatCurrency(total);
      
      // Update remaining balance
      const remaining = billTotal - total;
      const remainingEl = document.getElementById('remaining-balance');
      if(remainingEl) {
        remainingEl.textContent = formatCurrency(remaining);
        remainingEl.style.color = remaining <= 0 ? '#10b981' : '#dc2626';
      }
    }
    
    // Validate Payment button - show breakdown and deduct from total
    document.getElementById('btn-validate-payment').addEventListener('click', () => {
      const selected = document.querySelectorAll('.payment-method-checkbox:checked');
      if(selected.length === 0){
        alert('Please select at least one payment method');
        return;
      }
      
      const payments = [];
      document.querySelectorAll('.payment-amount-input').forEach(input => {
        const amount = parseFloat(input.value || 0);
        if(amount > 0){
          payments.push({
            method: input.dataset.method,
            amount: amount
          });
        }
      });
      
      if(payments.length === 0){
        alert('Please enter at least one payment amount');
        return;
      }
      
      // Calculate totals
      let totalPaid = 0;
      payments.forEach(p => totalPaid += p.amount);
      
      // Show breakdown
      const breakdownEl = document.getElementById('payment-validation-breakdown');
      const contentEl = document.getElementById('validation-breakdown-content');
      
      let breakdownHTML = '';
      const methodLabels = {
        'cash': '💵 Cash',
        'pos': '💳 POS Card',
        'transfer': '📱 Bank Transfer',
        'credit': '📝 Credit'
      };
      
      payments.forEach(p => {
        breakdownHTML += `<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span>${methodLabels[p.method]}:</span>
          <span style="font-weight: 600;">${formatCurrency(p.amount)}</span>
        </div>`;
      });
      
      const remaining = billTotal - totalPaid;
      breakdownHTML += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #d6acf5;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-weight: 600;">Total Paid:</span>
          <span style="font-weight: 700; color: #10b981;">${formatCurrency(totalPaid)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="font-weight: 600;">Remaining:</span>
          <span style="font-weight: 700; color: ${remaining <= 0 ? '#10b981' : '#dc2626'};">${formatCurrency(remaining)}</span>
        </div>
      </div>`;
      
      contentEl.innerHTML = breakdownHTML;
      breakdownEl.style.display = 'block';
    });
    
    // Cancel button - restore original modal
    document.getElementById('btn-cancel-payment').addEventListener('click', () => {
      // Blur any focused element before changing content
      const focusedElement = document.activeElement;
      if (focusedElement && focusedElement !== document.body) {
        focusedElement.blur();
      }
      
      modalPanel.innerHTML = originalHTML;
      // Re-wire the buttons and repopulate form fields after restoration
      setTimeout(() => {
        rewireModalButtons();
        // Repopulate form fields with editing order data
        if (editingOrder) {
          const tableInput = document.getElementById('order-table');
          const waiterInput = document.getElementById('order-waiter');
          const clientInput = document.getElementById('order-client');
          
          if (tableInput) {
            tableInput.value = editingOrder.tableName || '';
            tableInput.setAttribute('readonly', 'readonly');
            tableInput.style.backgroundColor = '#f9fafb';
            tableInput.style.cursor = 'not-allowed';
          }
          if (waiterInput) {
            waiterInput.value = editingOrder.waiterName || '';
            waiterInput.setAttribute('readonly', 'readonly');
            waiterInput.style.backgroundColor = '#f9fafb';
            waiterInput.style.cursor = 'not-allowed';
          }
          if (clientInput) clientInput.value = editingOrder.clientName || '';
        }
      }, 0);
    });
    
    // Confirm button
    document.getElementById('btn-confirm-payment').addEventListener('click', async () => {
      const selected = document.querySelectorAll('.payment-method-checkbox:checked');
      if(selected.length === 0){
        alert('Please select at least one payment method');
        return;
      }
      
      const payments = [];
      document.querySelectorAll('.payment-amount-input').forEach(input => {
        const amount = parseFloat(input.value || 0);
        if(amount > 0){
          payments.push({
            method: input.dataset.method,
            amount: amount
          });
        }
      });
      
      if(payments.length === 0){
        alert('Please enter at least one payment amount');
        return;
      }
      
      try {
        // Ensure editingOrder has current items
        if (editingOrder && currentOrderItems.length > 0) {
          editingOrder.items = currentOrderItems.map(item => ({
            productId: item.productId,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity
          }));
        }
        
        // Save payment details to order
        editingOrder.status = 'completed';
        editingOrder.payments = payments;
        editingOrder.cashierName = getCurrentCashierName();
        editingOrder.cashier = editingOrder.cashierName;
        editingOrder.createdBy = editingOrder.createdBy || editingOrder.cashierName;
        editingOrder.updatedAt = new Date().toISOString();
        await saveOrderToBackend(editingOrder);
        
        alert('Order completed! Payment recorded.');
        
        // Auto-print receipt after closing bill
        setTimeout(() => {
          console.log('About to print receipt. editingOrder:', editingOrder);
          printReceiptThermal(editingOrder);
        }, 300);
        
        closeOrderModal();
        await loadAndRenderOrders();
      } catch (err) {
        console.error('Failed to close bill:', err);
        alert('Failed to close bill: ' + err.message);
      }
    });
  }

  // Print thermal slip for new order (kitchen slip)
  function printThermalSlip(){
    // When editing, only print new/changed items. When creating, print all items
    let itemsToPrint = currentOrderItems;
    
    if (editingOrderId && originalOrderItems.length > 0) {
      // Create items to print with only the new quantity added
      itemsToPrint = [];
      
      currentOrderItems.forEach(currentItem => {
        // Find if this item existed in the original order
        const origItem = originalOrderItems.find(item => 
          item.productId === currentItem.productId && 
          item.unitPrice === currentItem.unitPrice
        );
        
        if (!origItem) {
          // This is a completely new item - print the full quantity
          itemsToPrint.push(currentItem);
        } else if (origItem.quantity < currentItem.quantity) {
          // This item's quantity increased - print only the added quantity
          itemsToPrint.push({
            productId: currentItem.productId,
            productName: currentItem.productName,
            unitPrice: currentItem.unitPrice,
            quantity: currentItem.quantity - origItem.quantity, // Only the added quantity
            isQuantityAddition: true, // Flag to indicate this is an addition to existing item
            originalQuantity: origItem.quantity,
            newTotal: currentItem.quantity
          });
        }
        // If quantity decreased or stayed the same, don't print anything for this item
      });
    }
    
    if (itemsToPrint.length === 0) {
      alert('No new items to print');
      return;
    }
    
    const tableName = document.getElementById('order-table')?.value || 'N/A';
    const waiterName = document.getElementById('order-waiter')?.value || 'N/A';
    
    // Format time with AM/PM
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Get selected event with details
    let eventName = '';
    let eventLocation = '';
    if (selectedEventId) {
      const evt = allEvents.find(e => e.id === selectedEventId);
      eventName = evt?.name || '';
      eventLocation = evt?.location || '';
    }
    
    // Thermal printer format - optimized for 80mm thermal receipt printer
    let thermalHTML = `
      <html>
      <head>
        <title>Order Slip</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: Arial, Helvetica, sans-serif; 
            padding: 6px;
            max-width: 80mm;
            width: 100%;
            background: white;
            color: black;
            font-size: 13px;
            line-height: 1.3;
            word-break: break-word;
            overflow-wrap: anywhere;
          }
          .event-header {
            text-align: center;
            margin-bottom: 8px;
            border-bottom: 1px solid #000;
            padding-bottom: 6px;
          }
          .event-name {
            font-weight: bold;
            font-size: 14px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .event-location {
            font-size: 11px;
            color: #333;
          }
          .title {
            text-align: center;
            font-weight: bold;
            font-size: 16px;
            text-transform: uppercase;
            margin: 8px 0;
            letter-spacing: 1px;
          }
          .order-info {
            margin: 8px 0;
            padding: 8px 0;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
            font-size: 13px;
          }
          .info-label {
            font-weight: bold;
            min-width: 50px;
          }
          .info-value {
            flex: 1;
            text-align: right;
            padding-left: 10px;
          }
          .items-section {
            margin: 8px 0;
          }
          .items-header {
            font-weight: bold;
            font-size: 13px;
            border-bottom: 1px solid #000;
            padding-bottom: 4px;
            margin-bottom: 6px;
            text-transform: uppercase;
          }
          .item-row {
            display: grid;
            grid-template-columns: 1fr 48px;
            gap: 8px;
            margin: 4px 0;
            font-size: 12px;
            padding: 3px 0;
            border-bottom: 1px dotted #999;
            align-items: center;
          }
          .item-name {
            overflow-wrap: anywhere;
            word-break: break-word;
            font-weight: bold;
          }
          .item-qty {
            text-align: right;
            width: 48px;
            font-weight: bold;
          }
          @media print {
            body { margin: 0; padding: 5px; }
          }
        </style>
      </head>
      <body>
    `;
    
    // Add event header if event is selected
    if (eventName) {
      thermalHTML += `
        <div class="event-header">
          <div class="event-name">${eventName}</div>
          ${eventLocation ? `<div class="event-location">${eventLocation}</div>` : ''}
        </div>
      `;
    }
    
    // Add order slip title
    thermalHTML += `<div class="title">ORDER SLIP</div>`;
    
    // Add order information
    thermalHTML += `
      <div class="order-info">
        <div class="info-row">
          <span class="info-label">Table:</span>
          <span class="info-value">${tableName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Waiter:</span>
          <span class="info-value">${waiterName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Time:</span>
          <span class="info-value">${timeStr}</span>
        </div>
      </div>
    `;
    
    // Add items section
    thermalHTML += `<div class="items-section"><div class="items-header">Items</div>`;
    
    itemsToPrint.forEach(item => {
      const itemName = item.productName.substring(0, 40);
      
      // Check if this is a quantity addition to an existing item
      if (item.isQuantityAddition) {
        // Show it as "+ X more" format to indicate it's additional quantity
        thermalHTML += `
          <div class="item-row">
            <span class="item-name">${itemName}</span>
            <span class="item-qty">+${item.quantity}</span>
          </div>
        `;
      } else {
        // Regular new item
        thermalHTML += `
          <div class="item-row">
            <span class="item-name">${itemName}</span>
            <span class="item-qty">x${item.quantity}</span>
          </div>
        `;
      }
    });
    
    thermalHTML += `
      </div>
      </body>
      </html>
    `;
    
    // Use safePrint to handle pop-up blocking and fallback to iframe
    safePrint(thermalHTML, 'height=600,width=350');
  }

  // Delete order
  async function deleteOrder(orderId){
    try {
      if (!BACKEND_AVAILABLE) throw new Error('backend_unavailable');
      await deleteOrderFromBackend(orderId);
      await loadAndRenderOrders();
      showToast('Order deleted successfully', 'success', 2600);
    } catch (err) {
      console.error('Failed to delete order:', err);
      alert('Failed to delete order: ' + err.message);
    }
  }

  // Helper function to re-wire modal buttons after modal content is restored
  // This prevents event listener duplication and fixes the freeze issue
  function rewireModalButtons(){
    try {
      console.log('rewireModalButtons: Starting...');
      const btnCloseModal = document.getElementById('btn-close-modal');
      const btnSaveOrder = document.getElementById('btn-save-order');
      const btnAddItem = document.getElementById('btn-add-item');
      const btnVoidItem = document.getElementById('btn-void-item');
      const btnRemoveItem = document.getElementById('btn-remove-item');
      const btnRemoveOrder = document.getElementById('btn-remove-order');
      const btnSendOrder = document.getElementById('btn-send-order');
      const btnPrintBill = document.getElementById('btn-print-bill');
      const btnCloseBill = document.getElementById('btn-close-bill');
      const btnSendOrderNew = document.getElementById('btn-send-order-new');
      const orderTableInput = document.getElementById('order-table');
      const orderQtyInput = document.getElementById('order-qty');
      
      console.log('rewireModalButtons: Found btnRemoveItem?', !!btnRemoveItem);
      
      // Remove old listeners by cloning and replacing
      const oldCloseModal = btnCloseModal?.cloneNode(true);
      if (oldCloseModal && btnCloseModal?.parentNode) {
        btnCloseModal.parentNode.replaceChild(oldCloseModal, btnCloseModal);
      }
      
      // Re-wire all buttons
      const newBtnCloseModal = document.getElementById('btn-close-modal');
      const newBtnSaveOrder = document.getElementById('btn-save-order');
      const newBtnAddItem = document.getElementById('btn-add-item');
      const newBtnVoidItem = document.getElementById('btn-void-item');
      const newBtnRemoveItem = document.getElementById('btn-remove-item');
      const newBtnRemoveOrder = document.getElementById('btn-remove-order');
      const newBtnSendOrder = document.getElementById('btn-send-order');
      const newBtnPrintBill = document.getElementById('btn-print-bill');
      const newBtnCloseBill = document.getElementById('btn-close-bill');
      const newBtnSendOrderNew = document.getElementById('btn-send-order-new');
      const newOrderTableInput = document.getElementById('order-table');
      const newOrderQtyInput = document.getElementById('order-qty');
      
      console.log('rewireModalButtons: After re-query, found newBtnRemoveItem?', !!newBtnRemoveItem);
      
      if (newBtnCloseModal) newBtnCloseModal.addEventListener('click', closeOrderModal);
      if (newBtnSaveOrder) newBtnSaveOrder.addEventListener('click', ()=>saveOrder());
      if (newBtnAddItem) newBtnAddItem.addEventListener('click', addItemToOrder);
      if (newBtnVoidItem) newBtnVoidItem.addEventListener('click', voidItems);
      if (newBtnRemoveItem) {
        console.log('rewireModalButtons: Attaching removeItem listener');
        newBtnRemoveItem.addEventListener('click', removeItem);
      }
      if (newBtnRemoveOrder) newBtnRemoveOrder.addEventListener('click', removeOrder);
      if (newBtnSendOrder) newBtnSendOrder.addEventListener('click', sendOrder);
      if (newBtnPrintBill) newBtnPrintBill.addEventListener('click', () => printBill());
      if (newBtnCloseBill) newBtnCloseBill.addEventListener('click', closeBill);
      if (newBtnSendOrderNew) newBtnSendOrderNew.addEventListener('click', async ()=>{
        console.log('btnSendOrderNew: Saving new order');
        const itemsToPrint = [...currentOrderItems];
        const saved = await saveOrder();
        if (!saved) return;
        try{
          currentOrderItems = itemsToPrint;
          printThermalSlip();
          currentOrderItems = [];
        }catch(e){ console.error('Print failed', e); }
      });
      
      // Re-establish input event listeners
      if (newOrderTableInput) {
        newOrderTableInput.addEventListener('change', handleTableChange);
        newOrderTableInput.addEventListener('blur', handleTableChange);
        newOrderTableInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleTableChange();
          }
        });
      }
      
      if (newOrderQtyInput) {
        newOrderQtyInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            addItemToOrder();
          }
        });
      }
      
      // Wire up discount section
      const discountSection = document.getElementById('discount-section');
      if (discountSection) {
        // Remove old listener by cloning
        const newDiscountSection = discountSection.cloneNode(true);
        discountSection.parentNode.replaceChild(newDiscountSection, discountSection);
        
        // Add hover effect
        newDiscountSection.addEventListener('mouseenter', () => {
          newDiscountSection.style.background = 'rgba(168, 85, 247, 0.1)';
          newDiscountSection.style.borderColor = '#a855f7';
          newDiscountSection.style.transform = 'scale(1.02)';
        });
        newDiscountSection.addEventListener('mouseleave', () => {
          newDiscountSection.style.background = 'rgba(249, 240, 255, 0.5)';
          newDiscountSection.style.borderColor = '#d4a5ff';
          newDiscountSection.style.transform = 'scale(1)';
        });
        
        // Add click handler
        newDiscountSection.addEventListener('click', applyDiscount);
      }
      
      // Re-populate category and product selects
      resetOrderModalSelectors();
      
      console.log('rewireModalButtons: Button re-wiring complete');
    } catch (rewireErr) {
      console.error('rewireModalButtons: Error during re-wiring:', rewireErr);
    }
  }

  // Wire up modal controls
  try {
    console.log('cashier.js: Starting button wiring');
    const btnCreateOrder = document.getElementById('btn-create-order');
    const btnJoinTable = document.getElementById('btn-join-table');
    const btnSplitBillCard = document.getElementById('btn-split-bill-card');
    console.log('cashier.js: btnCreateOrder element:', btnCreateOrder);
    const btnSaveOrder = document.getElementById('btn-save-order');
    const btnAddItem = document.getElementById('btn-add-item');
    const btnVoidItem = document.getElementById('btn-void-item');
    const btnRemoveItem = document.getElementById('btn-remove-item');
    const btnRemoveOrder = document.getElementById('btn-remove-order');
    const btnSendOrder = document.getElementById('btn-send-order');
    const btnPrintBill = document.getElementById('btn-print-bill');
    const btnSplitBill = document.getElementById('btn-split-bill');
    const btnCloseBill = document.getElementById('btn-close-bill');
    const btnSendOrderNew = document.getElementById('btn-send-order-new');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const orderSearchInput = document.getElementById('order-search');
    const orderTableInput = document.getElementById('order-table');
    const orderQtyInput = document.getElementById('order-qty');
    const orderModalBackdrop = document.querySelector('#order-modal .modal-backdrop');
    
    if (btnCreateOrder) {
      console.log('Wiring: btn-create-order found, attaching click');
      btnCreateOrder.addEventListener('click', (ev)=>{ console.log('btn-create-order clicked'); openOrderModal(); });
    } else {
      console.warn('Wiring: btn-create-order not found');
    }

    if (btnJoinTable) {
      console.log('Wiring: btn-join-table found, attaching click');
      btnJoinTable.addEventListener('click', (ev)=>{ console.log('btn-join-table clicked'); joinTables(); });
    } else {
      console.warn('Wiring: btn-join-table not found');
    }

    if (btnSplitBillCard) {
      console.log('Wiring: btn-split-bill-card found, attaching click');
      btnSplitBillCard.addEventListener('click', (ev)=>{ console.log('btn-split-bill-card clicked'); splitBill(); });
    } else {
      console.warn('Wiring: btn-split-bill-card not found');
    }

    const btnRefreshPage = document.getElementById('btn-refresh-page');
    if (btnRefreshPage) {
      console.log('Wiring: btn-refresh-page found, attaching click');
      btnRefreshPage.addEventListener('click', ()=>{ 
        console.log('btn-refresh-page clicked'); 
        showToast('Refreshing page...', 'info');
        setTimeout(() => location.reload(), 500);
      });
    } else {
      console.warn('Wiring: btn-refresh-page not found');
    }

    // Fallback: event delegation for dynamically rendered button
    document.body.addEventListener('click', function(ev) {
      const target = ev.target.closest('#btn-create-order');
      if (target) {
        console.log('Delegated: btn-create-order clicked');
        openOrderModal();
      }
    });

    // On page load, log modal presence and visibility
    const modalTest = document.getElementById('order-modal');
    if (modalTest) {
      console.log('Modal found on page load. aria-hidden:', modalTest.getAttribute('aria-hidden'), 'display:', modalTest.style.display);
    } else {
      console.warn('Modal NOT found on page load');
    }
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeOrderModal);
    if (btnSaveOrder) btnSaveOrder.addEventListener('click', ()=>saveOrder());
    if (btnAddItem) btnAddItem.addEventListener('click', addItemToOrder);
    if (btnVoidItem) btnVoidItem.addEventListener('click', voidItems);
    if (btnRemoveItem) btnRemoveItem.addEventListener('click', removeItem);
    if (btnRemoveOrder) btnRemoveOrder.addEventListener('click', removeOrder);
    if (btnSendOrder) btnSendOrder.addEventListener('click', async () => {
      await sendOrder();
    });
    if (btnPrintBill) btnPrintBill.addEventListener('click', () => printBill());
    if (btnSplitBill) btnSplitBill.addEventListener('click', splitBill);
    if (btnCloseBill) btnCloseBill.addEventListener('click', closeBill);
    
    // Wire up discount section from initial page load
    const discountSectionInit = document.getElementById('discount-section');
    if (discountSectionInit) {
      discountSectionInit.addEventListener('click', applyDiscount);
      console.log('Wiring: discount-section click listener attached');
    } else {
      console.warn('Wiring: discount-section not found on page load');
    }
    
    if (btnSendOrderNew) btnSendOrderNew.addEventListener('click', async ()=>{
      // For new orders: save first, then print all items
      console.log('btnSendOrderNew: Saving new order');
      // Store items before save clears them
      const itemsToPrint = [...currentOrderItems];
      const saved = await saveOrder();
      if (!saved) return;
      try{
        // After saveOrder, currentOrderItems is cleared, so we need to temporarily restore them for printing
        currentOrderItems = itemsToPrint;
        printThermalSlip();
        currentOrderItems = []; // Clear again after printing
      }catch(e){ console.error('Print failed', e); }
    });
    // Sort dropdown element
    const orderSortSelect = document.getElementById('order-sort');
    const orderStatusFilter = document.getElementById('order-status-filter');
    
    // Sort orders when dropdown changes
    if (orderSortSelect) {
      orderSortSelect.addEventListener('change', (e) => {
        const sortBy = e.target.value;
        const searchQuery = orderSearchInput ? (orderSearchInput.value || '').trim() : '';
        const statusFilter = orderStatusFilter ? (orderStatusFilter.value || '').trim() : '';
        let filtered = searchQuery ? filterOrdersByQuery(searchQuery) : allOrdersCache;
        filtered = statusFilter ? filterOrdersByStatus(filtered, statusFilter) : filtered;
        const sorted = sortOrders(filtered, sortBy);
        renderOrdersList(sorted);
      });
    }
    
    // Status filter when dropdown changes
    if (orderStatusFilter) {
      orderStatusFilter.addEventListener('change', (e) => {
        const statusFilter = e.target.value;
        const searchQuery = orderSearchInput ? (orderSearchInput.value || '').trim() : '';
        const sortValue = orderSortSelect ? orderSortSelect.value : 'newest';
        let filtered = searchQuery ? filterOrdersByQuery(searchQuery) : allOrdersCache;
        filtered = statusFilter ? filterOrdersByStatus(filtered, statusFilter) : filtered;
        const sorted = sortOrders(filtered, sortValue);
        renderOrdersList(sorted);
      });
    }
    
    if (orderSearchInput) {
      orderSearchInput.addEventListener('input', (e) => {
        const q = (e.target.value || '').trim();
        const statusFilter = orderStatusFilter ? (orderStatusFilter.value || '').trim() : '';
        let filtered = q ? filterOrdersByQuery(q) : allOrdersCache;
        filtered = statusFilter ? filterOrdersByStatus(filtered, statusFilter) : filtered;
        // Apply current sort filter
        const sortValue = orderSortSelect ? orderSortSelect.value : 'newest';
        const sorted = sortOrders(filtered, sortValue);
        renderOrdersList(sorted);
      });
    }
    
    // Navigation buttons
    const btnGoToTop = document.getElementById('btn-go-to-top');
    const btnGoToBottom = document.getElementById('btn-go-to-bottom');
    
    if (btnGoToTop) {
      btnGoToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    
    if (btnGoToBottom) {
      btnGoToBottom.addEventListener('click', () => {
        const ordersContainer = document.getElementById('orders-container');
        if (ordersContainer) {
          ordersContainer.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
    
    if (orderTableInput) orderTableInput.addEventListener('change', handleTableChange);
    if (orderTableInput) orderTableInput.addEventListener('blur', handleTableChange);
    if (orderTableInput) {
      orderTableInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleTableChange();
        }
      });
    }
    if (orderQtyInput) {
      orderQtyInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          addItemToOrder();
        }
      });
    }
    if (orderModalBackdrop) {
      orderModalBackdrop.addEventListener('click', closeOrderModal);
    }

    // Event delegation for order card actions (edit/view buttons)
    // This ensures buttons work even after cards are re-rendered
    const ordersContainer = document.getElementById('orders-container');
    if (ordersContainer) {
      ordersContainer.addEventListener('click', async (ev) => {
        const editBtn = ev.target.closest('.btn-edit-order');
        const deleteBtn = ev.target.closest('.btn-delete-order');
        const viewBtn = ev.target.closest('.btn-view-order');
        
        if (deleteBtn) {
          const orderId = deleteBtn.getAttribute('data-order-id');
          const order = allOrdersCache.find(o => String(o.id) === String(orderId));
          if (!order) {
            console.warn('Order not found in cache for deletion:', orderId);
            return;
          }
          if (!canDeleteOrder(order)) {
            showToast('This order cannot be deleted because it has already been updated.', 'warning', 2600);
            return;
          }

          const confirmed = await new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.setAttribute('aria-hidden', 'false');
            modal.innerHTML = `
              <div class="modal-backdrop"></div>
              <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-order-card-title" style="max-width:420px;">
                <header class="modal-header">
                  <h3 id="delete-order-card-title">Delete order?</h3>
                  <button type="button" class="modal-close" aria-label="Close">✕</button>
                </header>
                <div class="modal-body">
                  <p style="margin:0;">Delete this order from the cashier view?</p>
                </div>
                <footer class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
                  <button type="button" class="btn btn-ghost cancel-btn">Cancel</button>
                  <button type="button" class="btn btn-danger confirm-btn">Delete</button>
                </footer>
              </div>
            `;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
            modal.querySelector('.modal-close')?.addEventListener('click', close);
            modal.querySelector('.cancel-btn')?.addEventListener('click', () => { close(); resolve(false); });
            modal.querySelector('.confirm-btn')?.addEventListener('click', () => { close(); resolve(true); });
          });

          if (!confirmed) {
            showToast('Delete cancelled', 'info', 2200);
            return;
          }

          await deleteOrder(orderId);
          return;
        }
        if (editBtn) {
          const orderId = editBtn.getAttribute('data-order-id');
          console.log('Delegated edit button click for orderId:', orderId);
          const order = allOrdersCache.find(o => String(o.id) === String(orderId));
          if (order) {
            openEditOrderModal(orderId, order);
          } else {
            console.warn('Order not found in cache:', orderId);
          }
        } else if (viewBtn) {
          const orderId = viewBtn.getAttribute('data-order-id');
          const order = allOrdersCache.find(o => String(o.id) === String(orderId));
          if (order) {
            showOrderDetailsModal(order);
          } else {
            console.warn('Order not found in cache:', orderId);
          }
        }
      });
    }

    console.log('cashier.js: Button wiring complete');
  } catch (wiringErr) {
    console.error('cashier.js: Error during button wiring:', wiringErr);
  }

  // Listen for admin-published active event changes via localStorage so cashiers auto-pick it
  window.addEventListener('storage', async (ev) => {
    if (ev.key !== 'activeEvent') return;
    try{
      const val = ev.newValue ? JSON.parse(ev.newValue) : null;
      const select = document.getElementById('select-event');
      if(!select) return;
      if(val && val.id){
        // if event exists in current list, set and lock; otherwise refresh events then set
        let found = allEvents.find(e=> String(e.id)===String(val.id));
        if(!found){
          try{ allEvents = await RestaurantDB.getAllEvents(); }catch(e){}
          found = allEvents.find(e=> String(e.id)===String(val.id));
          // repopulate options so the active event appears
          try{ populateEventSelect(); }catch(e){}
        }
        if(found){ select.value = found.id; selectedEventId = Number(found.id); try{ select.disabled = true; }catch(e){} }
      } else {
        // cleared by admin -> clear selection but keep control admin-only
        try{ select.disabled = true; }catch(e){};
        select.value = '';
        selectedEventId = null;
      }
    }catch(e){ console.warn('Failed to apply activeEvent from storage', e); }
  });

  // Initialize POS on page load
  try {
    console.log('cashier.js: About to call captureOriginalModalHTML');
    captureOriginalModalHTML();
    console.log('cashier.js: captureOriginalModalHTML completed');
    console.log('cashier.js: About to call loadBillingSettings');
    await loadBillingSettings();
    console.log('cashier.js: loadBillingSettings completed');
    console.log('cashier.js: About to call loadStockCountSetting');
    await loadStockCountSetting();
    console.log('cashier.js: loadStockCountSetting completed');
    console.log('cashier.js: About to call loadPOSData');
    await loadPOSData();
    console.log('cashier.js: loadPOSData completed');
    console.log('cashier.js: About to call loadAndRenderOrders');
    await loadAndRenderOrders();
    console.log('cashier.js: loadAndRenderOrders completed');
    scheduleBusinessDayRefresh();
    startCashierRealtimeRefresh();
    console.log('cashier.js: Real-time refresh timer scheduled');
    console.log('cashier.js: Business day refresh timer scheduled');
    console.log('cashier.js: POS initialization complete - script ready for user interaction');
  } catch (initErr) {
    console.error('cashier.js: Error during POS initialization:', initErr);
    alert('Error initializing POS: ' + initErr.message);
  }

})();
