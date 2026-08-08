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
  // Billing settings (from admin UI)
  let billingSettings = { taxPercentage: 0, serviceChargePercentage: 0, discountPercentage: 0 };
  let billingSettingsLoaded = false;

  function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      padding: 12px 16px;
      border-radius: 10px;
      font-weight: 600;
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
    } else {
      toast.style.backgroundColor = '#dbeafe';
      toast.style.color = '#1e40af';
      toast.style.border = '1px solid #93c5fd';
      toast.textContent = 'ℹ ' + message;
    }

    let container = document.getElementById('waiter-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'waiter-toast-container';
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
      document.body.appendChild(container);
    }
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, duration);
  }

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

  // Load billing settings from admin (try local DB first, fall back to backend)
  async function loadBillingSettings() {
    try {
      if (typeof RestaurantDB !== 'undefined' && RestaurantDB && typeof RestaurantDB.getSetting === 'function') {
        const taxSetting = await RestaurantDB.getSetting('taxPercentage').catch(() => null);
        const serviceSetting = await RestaurantDB.getSetting('serviceChargePercentage').catch(() => null);
        const discountSetting = await RestaurantDB.getSetting('discountPercentage').catch(() => null);
        billingSettings.taxPercentage = taxSetting ? parseFloat(taxSetting.value) || 0 : billingSettings.taxPercentage || 0;
        billingSettings.serviceChargePercentage = serviceSetting ? parseFloat(serviceSetting.value) || 0 : billingSettings.serviceChargePercentage || 0;
        billingSettings.discountPercentage = discountSetting ? parseFloat(discountSetting.value) || 0 : billingSettings.discountPercentage || 0;
      } else if (typeof fetchBackend === 'function') {
        const [taxRes, serviceRes, discountRes] = await Promise.all([
          fetchBackend('/api/settings/tax').catch(() => null),
          fetchBackend('/api/settings/service-charge').catch(() => null),
          fetchBackend('/api/settings/discount').catch(() => null)
        ]);
        billingSettings.taxPercentage = taxRes ? parseFloat(taxRes.value) || 0 : billingSettings.taxPercentage || 0;
        billingSettings.serviceChargePercentage = serviceRes ? parseFloat(serviceRes.value) || 0 : billingSettings.serviceChargePercentage || 0;
        billingSettings.discountPercentage = discountRes ? parseFloat(discountRes.value) || 0 : billingSettings.discountPercentage || 0;
      }
      billingSettingsLoaded = true;
      console.log('Waiter billing settings loaded:', billingSettings);
    } catch (err) {
      console.warn('Failed to load waiter billing settings, using defaults', err);
      billingSettings = { taxPercentage: billingSettings.taxPercentage || 0, serviceChargePercentage: billingSettings.serviceChargePercentage || 0, discountPercentage: billingSettings.discountPercentage || 0 };
      billingSettingsLoaded = true;
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

  function refreshWaiterSidebar(sessionData) {
    const profile = sessionData || Auth.getSession();
    if (!profile) return;
    const fullNameValue = String(profile.fullName || profile.username || 'Waiter').trim();
    const roleValue = String(profile.role || 'waiter').trim();
    if (waiterNameElement) waiterNameElement.textContent = fullNameValue;
    if (roleNameElement) roleNameElement.textContent = roleValue.charAt(0).toUpperCase() + roleValue.slice(1).toLowerCase();
    const avatarEl = document.getElementById('cashier-avatar');
    if (avatarEl) avatarEl.textContent = fullNameValue.charAt(0).toUpperCase() || 'W';
  }
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

    if (panelId === 'reports') {
      renderWaiterReports();
    }

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

  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const settingsLink = document.querySelector('.nav-link[data-panel="settings"]');
      if (settingsLink) {
        settingsLink.click();
      } else {
        showPanel('settings');
      }
    });
  }

  initializePanels();

  const session = Auth.getSession();
  refreshWaiterSidebar(session);

  const profileForm = document.getElementById('profile-settings-form');
  const profileFullName = document.getElementById('profile-full-name');
  const profileUsername = document.getElementById('profile-username');
  const profileCurrentPassword = document.getElementById('profile-current-password');
  const profileNewPassword = document.getElementById('profile-new-password');
  const profileNewPasswordConfirm = document.getElementById('profile-new-password-confirm');
  const profileMessage = document.getElementById('profile-settings-message');

  if (profileFullName) profileFullName.value = session?.fullName || session?.username || '';
  if (profileUsername) profileUsername.value = session?.username || '';

  if (profileForm) {
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const fullName = String(profileFullName?.value || '').trim();
        const username = String(profileUsername?.value || '').trim();
        const currentPassword = String(profileCurrentPassword?.value || '');
        const newPassword = String(profileNewPassword?.value || '');
        const confirmPassword = String(profileNewPasswordConfirm?.value || '');

        if (!fullName || !username) {
          throw new Error('Please provide your full name and username.');
        }

        if (currentPassword || newPassword || confirmPassword) {
          if (!currentPassword) throw new Error('Please enter your current password to change your password.');
          if (!newPassword) throw new Error('Please enter a new password.');
          if (newPassword.length < 6) throw new Error('New password must be at least 6 characters.');
          if (newPassword !== confirmPassword) throw new Error('New password and confirmation do not match.');
          await Auth.changePassword(currentPassword, newPassword);
        }

        const updateResponse = await fetchBackend('/api/users/update', {
          method: 'POST',
          body: JSON.stringify({
            id: String(session?.id),
            username,
            role: session?.role || 'waiter',
            fullName,
            status: session?.status || 'active',
            tables: []
          })
        });
        if (!updateResponse || updateResponse.success !== true) {
          throw new Error(updateResponse?.error || 'Unable to save profile.');
        }

        Auth.updateSession({ username, fullName, status: session?.status || 'active' });
        const updatedSession = Auth.getSession();
        refreshWaiterSidebar(updatedSession);
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
        }
      }
    });
  }

  function normalizeWaiterName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function orderMatchesWaiter(order, waiterName) {
    const normalizedWaiter = normalizeWaiterName(waiterName);
    if (!normalizedWaiter) return true;

    const candidateValues = [];
    const addCandidate = (value) => {
      if (typeof value === 'string' && value.trim()) {
        candidateValues.push(value.trim().toLowerCase());
      }
    };

    addCandidate(order?.waiterName);
    addCandidate(order?.waiter);
    addCandidate(order?.orderData?.waiterName);
    addCandidate(order?.orderData?.order?.waiterName);
    addCandidate(order?.order_data?.waiterName);
    addCandidate(order?.order_data?.order?.waiterName);
    addCandidate(order?.orderData?.order_data?.waiterName);
    addCandidate(order?.order_data?.order_data?.waiterName);
    addCandidate(order?.editableByWaiterName);
    addCandidate(order?.mergeTargetWaiterName);
    addCandidate(order?.mergeEditableBy);

    return candidateValues.some((value) => {
      const parts = value.split(/(?:\s*&\s*|\s*,\s*|\/)/g).filter(Boolean);
      return parts.some((part) => part === normalizedWaiter || part.includes(normalizedWaiter) || normalizedWaiter.includes(part));
    });
  }

  async function getOrders() {
    const waiterName = String(session?.username || '').trim().toLowerCase();
    if (!waiterName) {
      return [];
    }
    const response = await fetchBackend(`/api/orders/all?waiterName=${encodeURIComponent(waiterName)}`);
    const orders = Array.isArray(response.orders) ? response.orders : [];
    return orders.filter((order) => orderMatchesWaiter(order, waiterName));
  }

  async function refreshDashboard() {
    if (!billingSettingsLoaded) {
      await loadBillingSettings().catch(() => {});
    }
    await loadBusinessDayCutoff();
    const orders = await getOrders();
    const waiterName = String(session?.username || '').trim().toLowerCase();
    const range = getBusinessDayRange(businessDayCutoff);

    const waiterOrders = (orders || [])
      .filter(order => orderMatchesWaiter(order, waiterName))
      .filter(order => {
        const createdAt = order.createdAt || order.orderData?.createdAt || order.created_at || order.date || order.orderData?.order?.createdAt || order.orderData?.order?.created_at;
        const created = new Date(createdAt || '');
        return !Number.isNaN(created.getTime()) && created >= range.start && created < range.end;
      });

    currentWaiterOrders = waiterOrders;
    existingTableOrderMap = new Map();
    waiterOrders.forEach((order) => {
      const tableName = String(order?.tableName || order?.orderData?.tableName || order?.orderData?.order?.tableName || '').trim();
      if (tableName) {
        existingTableOrderMap.set(tableName.toLowerCase(), order);
      }
    });
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
    renderFilteredOrderCards();
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
  let currentOrderSearchQuery = '';
  let currentOrderSortMode = 'newest';
  let realtimeRefreshTimer = null;
  const REALTIME_REFRESH_INTERVAL = 15000;

  function getOrderCreatedTimestamp(order) {
    const createdAt = order?.createdAt || order?.orderData?.createdAt || order?.created_at || order?.date || order?.orderData?.order?.createdAt || order?.orderData?.order?.created_at;
    const created = new Date(createdAt || '');
    return Number.isNaN(created.getTime()) ? 0 : created.getTime();
  }

  function getOrderAmount(order) {
    const amount = Number(order?.totalAmount ?? order?.subtotal ?? order?.amount ?? 0);
    return Number.isNaN(amount) ? 0 : amount;
  }

  function getOrderSearchText(order) {
    const tableName = String(order?.tableName || order?.orderData?.tableName || order?.orderData?.order?.tableName || '').trim();
    const waiterName = getOrderWaiterName(order);
    const cashierName = getOrderCashierName(order);
    const status = getOrderStatus(order);
    const itemNames = Array.isArray(order?.items) ? order.items.map((item) => String(item?.name || item?.productName || item?.product?.name || '')).filter(Boolean) : [];
    return [tableName, waiterName, cashierName, status, String(order?.id || ''), ...itemNames].join(' ').toLowerCase();
  }

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

  function applySearchFilter(orders) {
    if (!Array.isArray(orders)) return [];
    const query = currentOrderSearchQuery.trim().toLowerCase();
    if (!query) return orders;
    return orders.filter((order) => getOrderSearchText(order).includes(query));
  }

  function applySort(orders) {
    if (!Array.isArray(orders)) return [];
    const sorted = [...orders];
    const statusRank = (order) => (getOrderStatus(order) === 'completed' ? 1 : 0);
    sorted.sort((a, b) => {
      const statusDiff = statusRank(a) - statusRank(b);
      if (statusDiff !== 0) return statusDiff;

      if (currentOrderSortMode === 'oldest') {
        const timeDiff = getOrderCreatedTimestamp(a) - getOrderCreatedTimestamp(b);
        if (timeDiff !== 0) return timeDiff;
      } else if (currentOrderSortMode === 'amount-desc') {
        const amountDiff = getOrderAmount(b) - getOrderAmount(a);
        if (amountDiff !== 0) return amountDiff;
      } else if (currentOrderSortMode === 'amount-asc') {
        const amountDiff = getOrderAmount(a) - getOrderAmount(b);
        if (amountDiff !== 0) return amountDiff;
      } else {
        const timeDiff = getOrderCreatedTimestamp(b) - getOrderCreatedTimestamp(a);
        if (timeDiff !== 0) return timeDiff;
      }

      const idA = String(a?.id ?? '');
      const idB = String(b?.id ?? '');
      return idA.localeCompare(idB);
    });
    return sorted;
  }

  function updateStatusTabActive(filterValue = currentOrderStatusFilter) {
    const mapping = {
      all: 'pos-status-all',
      pending: 'pos-status-pending',
      completed: 'pos-status-completed'
    };
    ['pos-status-all', 'pos-status-pending', 'pos-status-completed'].forEach((id) => {
      const btn = $(id);
      if (btn) {
        btn.classList.toggle('active', id === mapping[filterValue]);
      }
    });
  }

  function renderFilteredOrderCards() {
    const orders = Array.isArray(currentWaiterOrders) ? currentWaiterOrders : [];
    renderPosOrderCards(orders);
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
          const statusSelect = $('pos-order-status-filter');
          if (statusSelect) statusSelect.value = currentOrderStatusFilter;
          updateStatusTabActive(currentOrderStatusFilter);
          renderFilteredOrderCards();
        });
      }
    });

    const searchInput = $('pos-order-search');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        currentOrderSearchQuery = event.target.value;
        renderFilteredOrderCards();
      });
    }

    const statusSelect = $('pos-order-status-filter');
    if (statusSelect) {
      statusSelect.addEventListener('change', (event) => {
        currentOrderStatusFilter = event.target.value;
        updateStatusTabActive(currentOrderStatusFilter);
        renderFilteredOrderCards();
      });
    }

    const sortSelect = $('pos-order-sort-filter');
    if (sortSelect) {
      sortSelect.addEventListener('change', (event) => {
        currentOrderSortMode = event.target.value;
        renderFilteredOrderCards();
      });
    }

    updateStatusTabActive(currentOrderStatusFilter);
    if (statusSelect) statusSelect.value = currentOrderStatusFilter;
    if (sortSelect) sortSelect.value = currentOrderSortMode;
    if (searchInput) searchInput.value = currentOrderSearchQuery;
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

  await loadBillingSettings().catch(() => {});
  wireWaiterReportControls();
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function getOrderCreatedDate(order) {
    const createdAt = order?.createdAt || order?.orderData?.createdAt || order?.created_at || order?.date || order?.orderData?.order?.createdAt || order?.orderData?.order?.created_at;
    const created = new Date(createdAt || '');
    return Number.isNaN(created.getTime()) ? null : created;
  }

  function getItemSubcategoryName(item) {
    const rawSubcategory = item?.subcategoryName || item?.subcategory || item?.subCategoryName || item?.subCategory || item?.sub_name || item?.product?.subcategoryName || item?.product?.subcategory || item?.product?.subCategoryName || item?.product?.subCategory || '';
    if (rawSubcategory) return String(rawSubcategory).trim();

    const subcategoryId = item?.sub ?? item?.subcategoryId ?? item?.subcategory_id ?? item?.product?.sub ?? null;
    if (subcategoryId != null && subcategoryId !== '' && Array.isArray(allSubcategories)) {
      const matchedSubcategory = allSubcategories.find((subcategory) => String(subcategory.id) === String(subcategoryId));
      if (matchedSubcategory?.name) return String(matchedSubcategory.name).trim();
    }

    return 'Unspecified';
  }

  function getOrderPaymentMethod(order) {
    if (Array.isArray(order?.payments) && order.payments.length) {
      return order.payments.map((entry) => String(entry?.method || '')).filter(Boolean).join(', ') || 'N/A';
    }
    return String(order?.paymentMethod || order?.payment_method || order?.payment?.method || 'N/A').trim() || 'N/A';
  }

  function getReportRange() {
    const sel = document.getElementById('report-range');
    const startInput = document.getElementById('report-start');
    const endInput = document.getElementById('report-end');
    const now = new Date();
    let label = 'Today';
    let range = {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    };

    if (sel) {
      const value = sel.value || 'today';
      if (value === 'yesterday') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(todayStart.getDate() - 1);
        range = { start: yesterdayStart, end: new Date(todayStart) };
        label = 'Yesterday';
      } else if (value === 'this-week') {
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);
        range = { start: startOfWeek, end: new Date(now.getTime()) };
        label = 'This Week';
      } else if (value === 'custom') {
        if (startInput && startInput.value) {
          range.start = new Date(startInput.value + 'T00:00:00');
        }
        if (endInput && endInput.value) {
          range.end = new Date(endInput.value + 'T23:59:59');
        }
        label = startInput && endInput && startInput.value && endInput.value
          ? `${new Date(range.start).toLocaleDateString()} - ${new Date(range.end).toLocaleDateString()}`
          : 'Custom Range';
      }
    }

    return { start: range.start, end: range.end, label };
  }

  async function renderWaiterReports() {
    const tbodyItems = document.querySelector('#report-items-table tbody');
    const tbodyCats = document.querySelector('#report-categories-table tbody');
    const tbodySubs = document.querySelector('#report-subcategories-table tbody');
    const tbodyVoids = document.querySelector('#report-voided-table tbody');
    const paymentsEl = document.getElementById('report-payments');
    const reportDateEl = document.getElementById('report-date');

    if (!tbodyItems || !tbodyCats || !tbodySubs || !tbodyVoids || !paymentsEl) return;

    if (!allCategories.length && !allSubcategories.length && !allProducts.length) {
      await loadInventoryData();
    }

    const rangeInfo = getReportRange();
    if (reportDateEl) {
      reportDateEl.textContent = rangeInfo.label || 'Today';
    }

    try {
      // Ensure billing settings are available for any breakdowns
      try{ await loadBillingSettings(); }catch(e){ /* ignore */ }
      const allWaiterOrders = await getOrders();
      const filteredOrders = (allWaiterOrders || []).filter((order) => {
        const createdAt = getOrderCreatedDate(order);
        return createdAt && createdAt >= rangeInfo.start && createdAt < rangeInfo.end;
      });

      const itemsMap = new Map();
      const categoryMap = new Map();
      const subcategoryMap = new Map();
      const paymentsMap = new Map();
      const voidedList = [];

      filteredOrders.forEach((order) => {
        if (Array.isArray(order?.payments) && order.payments.length) {
          order.payments.forEach((payment) => {
            const method = String(payment?.method || 'unknown').toLowerCase();
            paymentsMap.set(method, (paymentsMap.get(method) || 0) + (Number(payment?.amount) || 0));
          });
        } else {
          const paymentMethod = String(order?.paymentMethod || order?.payment_method || order?.payment?.method || 'unknown').toLowerCase();
          paymentsMap.set(paymentMethod, (paymentsMap.get(paymentMethod) || 0) + (Number(order?.totalAmount || 0) || 0));
        }

        (Array.isArray(order?.items) ? order.items : []).forEach((item) => {
          const name = item?.productName || item?.name || item?.product?.name || 'Unknown';
          const quantity = Number(item?.quantity || item?.qty || 0);
          const unitPrice = Number(item?.unitPrice ?? item?.price ?? item?.product?.price ?? 0);
          const lineRevenue = quantity * unitPrice;
          const itemKey = item?.productId || name || JSON.stringify(item);
          if (!itemsMap.has(itemKey)) {
            itemsMap.set(itemKey, { name, qty: 0, revenue: 0 });
          }
          const currentItem = itemsMap.get(itemKey);
          currentItem.qty += quantity;
          currentItem.revenue += lineRevenue;

          const categoryName = getItemCategoryName(item) || 'Uncategorized';
          const subcategoryName = getItemSubcategoryName(item) || 'Unspecified';

          if (!categoryMap.has(categoryName)) {
            categoryMap.set(categoryName, { items: 0, revenue: 0 });
          }
          const categoryEntry = categoryMap.get(categoryName);
          categoryEntry.items += quantity;
          categoryEntry.revenue += lineRevenue;

          if (!subcategoryMap.has(subcategoryName)) {
            subcategoryMap.set(subcategoryName, { items: 0, revenue: 0 });
          }
          const subcategoryEntry = subcategoryMap.get(subcategoryName);
          subcategoryEntry.items += quantity;
          subcategoryEntry.revenue += lineRevenue;
        });

        if (Array.isArray(order?.voidedItems) && order.voidedItems.length) {
          order.voidedItems.forEach((entry) => {
            voidedList.push({
              item: entry?.productName || entry?.name || 'Unknown',
              qty: Number(entry?.quantity || entry?.qty || 0),
              table: order?.tableName || '—'
            });
          });
        }
      });

      const itemsArr = Array.from(itemsMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 20);
      const itemsTotal = itemsArr.reduce((sum, item) => sum + item.revenue, 0);
      tbodyItems.innerHTML = itemsArr.length === 0
        ? '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>'
        : itemsArr.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td style="text-align:center">${item.qty}</td><td style="text-align:right">${formatCurrency(item.revenue)}</td></tr>`).join('');
      const reportItemTotal = document.getElementById('report-item-total');
      if (reportItemTotal) reportItemTotal.textContent = `Total: ${formatCurrency(itemsTotal)}`;

      const categoryArr = Array.from(categoryMap.entries()).map(([name, entry]) => ({ name, ...entry })).sort((a, b) => b.revenue - a.revenue);
      const categoryTotal = categoryArr.reduce((sum, entry) => sum + entry.revenue, 0);
      tbodyCats.innerHTML = categoryArr.length === 0
        ? '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>'
        : categoryArr.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td style="text-align:center">${entry.items}</td><td style="text-align:right">${formatCurrency(entry.revenue)}</td></tr>`).join('');
      const reportCategoryTotal = document.getElementById('report-category-total');
      if (reportCategoryTotal) reportCategoryTotal.textContent = `Total: ${formatCurrency(categoryTotal)}`;

      const subcategoryArr = Array.from(subcategoryMap.entries()).map(([name, entry]) => ({ name, ...entry })).sort((a, b) => b.revenue - a.revenue);
      const subcategoryTotal = subcategoryArr.reduce((sum, entry) => sum + entry.revenue, 0);
      tbodySubs.innerHTML = subcategoryArr.length === 0
        ? '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No data</td></tr>'
        : subcategoryArr.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td style="text-align:center">${entry.items}</td><td style="text-align:right">${formatCurrency(entry.revenue)}</td></tr>`).join('');
      const reportSubcategoryTotal = document.getElementById('report-subcategory-total');
      if (reportSubcategoryTotal) reportSubcategoryTotal.textContent = `Total: ${formatCurrency(subcategoryTotal)}`;

      tbodyVoids.innerHTML = voidedList.length === 0
        ? '<tr><td colspan="3" class="muted" style="text-align:center;padding:12px;">No voided items</td></tr>'
        : voidedList.map((entry) => `<tr><td>${escapeHtml(entry.item)}</td><td style="text-align:center">${entry.qty}</td><td>${escapeHtml(entry.table)}</td></tr>`).join('');

      const paymentsList = Array.from(paymentsMap.entries()).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount);
      const paymentsListContainer = paymentsEl.querySelector('.report-payments-list');
      if (paymentsListContainer) {
        paymentsListContainer.innerHTML = paymentsList.length === 0
          ? '<div class="muted" style="text-align:center;padding:12px;">No payments yet</div>'
          : paymentsList.map((payment) => `<div class="report-payment-item"><div class="label">${escapeHtml(payment.method.toUpperCase())}</div><div class="value">${formatCurrency(payment.amount)}</div></div>`).join('');
      }

      if (window.Chart) {
        const topLabels = itemsArr.slice(0, 8).map((item) => item.name);
        const topData = itemsArr.slice(0, 8).map((item) => Math.round(item.revenue * 100) / 100);
        const topChartEl = document.getElementById('chart-top-items');
        if (topChartEl) {
          topChartEl.parentElement.style.display = topLabels.length ? 'block' : 'none';
          if (window.waiterTopChart) {
            window.waiterTopChart.data.labels = topLabels;
            window.waiterTopChart.data.datasets[0].data = topData;
            window.waiterTopChart.update();
          } else {
            window.waiterTopChart = new Chart(topChartEl, { type: 'bar', data: { labels: topLabels, datasets: [{ label: 'Revenue', data: topData, backgroundColor: ['#60a5fa','#7c3aed','#34d399','#f59e0b','#fb7185','#60a5fa','#7dd3fc','#a78bfa'] }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
          }
        }

        const paymentLabels = paymentsList.slice(0, 8).map((payment) => payment.method.toUpperCase());
        const paymentData = paymentsList.slice(0, 8).map((payment) => Math.round(payment.amount * 100) / 100);
        const paymentChartEl = document.getElementById('chart-payments');
        if (paymentChartEl) {
          paymentChartEl.parentElement.style.display = paymentLabels.length ? 'block' : 'none';
          if (window.waiterPaymentChart) {
            window.waiterPaymentChart.data.labels = paymentLabels;
            window.waiterPaymentChart.data.datasets[0].data = paymentData;
            window.waiterPaymentChart.update();
          } else {
            window.waiterPaymentChart = new Chart(paymentChartEl, { type: 'doughnut', data: { labels: paymentLabels, datasets: [{ data: paymentData, backgroundColor: ['#60a5fa','#7c3aed','#34d399','#f59e0b','#fb7185','#60a5fa','#7dd3fc','#a78bfa'] }] }, options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false } });
          }
        }
      }
    } catch (err) {
      console.error('Failed to render waiter reports:', err);
    }
  }

  function wireWaiterReportControls() {
    const sel = document.getElementById('report-range');
    const startInput = document.getElementById('report-start');
    const endInput = document.getElementById('report-end');

    if (sel) {
      sel.addEventListener('change', () => {
        const custom = sel.value === 'custom';
        if (startInput) startInput.style.display = custom ? 'inline-block' : 'none';
        if (endInput) endInput.style.display = custom ? 'inline-block' : 'none';
        renderWaiterReports();
      });
    }
    if (startInput) startInput.addEventListener('change', () => renderWaiterReports());
    if (endInput) endInput.addEventListener('change', () => renderWaiterReports());
    // export button removed; reports render when range or dates change
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

  function getItemCategoryName(item) {
    const rawCategory = item?.categoryName || item?.category || item?.category_name || item?.productCategory || item?.product?.categoryName || item?.product?.category || '';
    if (rawCategory) return String(rawCategory).trim();

    const product = item?.product || item?.productDetails || null;
    const productCategory = product?.categoryName || product?.category || '';
    if (productCategory) return String(productCategory).trim();

    const categoryId = item?.cat ?? product?.cat ?? item?.categoryId ?? item?.category_id ?? null;
    if (categoryId != null && categoryId !== '' && Array.isArray(allCategories)) {
      const matchedCategory = allCategories.find((cat) => String(cat.id) === String(categoryId));
      if (matchedCategory?.name) return String(matchedCategory.name).trim();
    }

    const subcategoryId = item?.sub ?? product?.sub ?? item?.subcategoryId ?? item?.subcategory_id ?? null;
    if (subcategoryId != null && subcategoryId !== '' && Array.isArray(allSubcategories)) {
      const matchedSubcategory = allSubcategories.find((sub) => String(sub.id) === String(subcategoryId));
      if (matchedSubcategory?.name) {
        const parentId = matchedSubcategory.parent;
        if (parentId != null && parentId !== '' && Array.isArray(allCategories)) {
          const matchedCategory = allCategories.find((cat) => String(cat.id) === String(parentId));
          if (matchedCategory?.name) return String(matchedCategory.name).trim();
        }
        return String(matchedSubcategory.name).trim();
      }
    }

    return 'Uncategorized';
  }

  function buildCategoryGroupedItems(items) {
    const grouped = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const categoryName = getItemCategoryName(item) || 'Uncategorized';
      if (!grouped.has(categoryName)) {
        grouped.set(categoryName, []);
      }
      grouped.get(categoryName).push(item);
    });
    return Array.from(grouped.entries()).map(([categoryName, categoryItems]) => ({ categoryName, items: categoryItems }));
  }

  function waiterMatches(value, currentWaiter) {
    const normalizedValue = normalizeWaiterName(value);
    if (!normalizedValue || !currentWaiter) return false;
    const parts = normalizedValue.split(/(?:\s*&\s*|\s*,\s*|\/)/g).filter(Boolean);
    return parts.some((part) => part === currentWaiter || part.includes(currentWaiter) || currentWaiter.includes(part));
  }

  function canEditWaiterOrder(order) {
    const currentWaiter = normalizeWaiterName(session?.username || '');
    if (!currentWaiter) return true;

    const primaryWaiter = normalizeWaiterName(order?.waiterName || order?.waiter || '');
    const editableBy = normalizeWaiterName(order?.editableByWaiterName || order?.mergeTargetWaiterName || order?.mergeEditableBy || '');
    const isSplitOrder = Boolean(order?.splitReference || order?.splitFromBillId || order?.splitPlace || order?.splitTotal);

    if (isSplitOrder) {
      return waiterMatches(primaryWaiter, currentWaiter) || waiterMatches(editableBy, currentWaiter);
    }

    if (order?.createdFrom === 'cashier-merge' || order?.mergeTargetTableName) {
      return waiterMatches(editableBy, currentWaiter) || waiterMatches(primaryWaiter, currentWaiter);
    }

    if (waiterMatches(primaryWaiter, currentWaiter) || waiterMatches(editableBy, currentWaiter)) {
      return true;
    }

    return true;
  }

  function renderPosOrderCards(orders) {
    const container = $('pos-order-cards');
    if (!container) return;
    const filteredOrders = applySort(applySearchFilter(applyStatusFilter(orders)));
    if (!filteredOrders || !filteredOrders.length) {
      container.innerHTML = '<div class="order-card" style="grid-column:1/-1;"><span class="order-card-title">No open orders</span><div class="muted">No orders match the current filters.</div></div>';
      return;
    }
    container.innerHTML = filteredOrders.map((order) => {
      const status = getOrderStatus(order);
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      const canEdit = canEditWaiterOrder(order);
      const badgeStyle = status === 'completed'
        ? 'background: linear-gradient(90deg, #10b981, #059669); color: white;'
        : 'background: linear-gradient(90deg, #3b82f6, #2563eb); color: white;';
      const actionButton = canEdit
        ? `<button type="button" class="btn btn-accent btn-update-order" data-order-id="${order.id}" style="border:none;">Update Order</button>`
        : `<button type="button" class="btn btn-update-order" data-order-id="${order.id}" style="border:none; background:#e5e7eb; color:#6b7280; cursor:not-allowed; opacity:0.7;" disabled>Update Order</button>`;
      return `
        <div class="order-card">
          <div class="order-card-header">
            <h4 class="order-card-title">Table ${order.tableName || 'N/A'}</h4>
            <span class="order-card-badge" style="${badgeStyle}">${statusLabel}</span>
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
            ${actionButton}
          </div>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.btn-update-order').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
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
      <div class="modal-panel waiter-order-modal" role="dialog" aria-modal="true" style="max-height:92vh;overflow:hidden;">
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

  function isTableOccupied(tableName) {
    if (!tableName || currentOrderId) return false;
    return existingTableOrderMap.has(String(tableName).trim().toLowerCase());
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
    container.innerHTML = waiterTables.map((table) => {
      const normalizedTable = String(table).trim();
      const isOccupied = isTableOccupied(normalizedTable);
      const isSelected = String(selectedTableId) === normalizedTable;
      const selectedClass = isSelected ? ' selected' : '';
      const occupiedLabel = isOccupied ? '<span class="muted" style="font-size:0.8rem;margin-left:8px;">In use</span>' : '';
      return `
        <button type="button" class="pos-chip table${selectedClass}" data-table="${normalizedTable}" style="${isOccupied ? 'opacity:0.65;cursor:not-allowed;' : ''}">
          <span class="pos-chip-label">${normalizedTable}</span>
          ${occupiedLabel}
          ${isSelected ? '<span class="pos-chip-check">✓</span>' : ''}
        </button>
      `;
    }).join('');
    container.querySelectorAll('.pos-chip.table').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tableName = btn.dataset.table;
        if (isTableOccupied(tableName)) {
          showToast(`An order already exists for table ${tableName}. Use Update Order to add items.`, 'error', 3200);
          return;
        }
        selectedTableId = tableName;
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
    if (!currentOrderId && selectedTableId && isTableOccupied(selectedTableId)) {
      container.innerHTML = '<div class="pos-section-empty">This table already has an order. Use Update Order to add items.</div>';
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
    const subtotal = currentOrderItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
    const discount = (subtotal * (billingSettings.discountPercentage || 0)) / 100;
    const tax = (subtotal * (billingSettings.taxPercentage || 0)) / 100;
    const service = (subtotal * (billingSettings.serviceChargePercentage || 0)) / 100;
    const totalAmount = subtotal - discount + tax + service;
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
      <div class="order-summary-breakdown">
        <div style="display:flex;justify-content:space-between;"> <span>Subtotal</span><strong>${formatCurrency(subtotal)}</strong></div>
        ${discount > 0 ? `<div style="display:flex;justify-content:space-between;color:#ef4444;"> <span>Discount (${billingSettings.discountPercentage}%)</span><strong>-${formatCurrency(discount)}</strong></div>` : ''}
        ${tax > 0 ? `<div style="display:flex;justify-content:space-between;color:#10b981;"> <span>Tax (${billingSettings.taxPercentage}%)</span><strong>+${formatCurrency(tax)}</strong></div>` : ''}
        ${service > 0 ? `<div style="display:flex;justify-content:space-between;color:#3b82f6;"> <span>Service (${billingSettings.serviceChargePercentage}%)</span><strong>+${formatCurrency(service)}</strong></div>` : ''}
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-weight:700;"> <span>Total</span><strong>${formatCurrency(totalAmount)}</strong></div>
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
    if (!currentOrderId && selectedTableId && isTableOccupied(selectedTableId)) {
      showToast(`An order already exists for table ${selectedTableId}. Use Update Order to add items.`, 'error', 3200);
      return;
    }
    const product = findProductById(productId);
    if (!product) return;
    const existing = getOrderItem(productId);
    const categoryName = getItemCategoryName({ product });
    if (existing && !existing.isExisting) {
      existing.quantity += 1;
      existing.categoryName = categoryName;
      existing.category = categoryName;
      existing.cat = product.cat ?? null;
      existing.sub = product.sub ?? null;
    } else if (existing && existing.isExisting) {
      currentOrderItems.push({
        productId: product.id,
        name: product.name,
        price: Number(product.price || 0),
        quantity: 1,
        isExisting: false,
        categoryName,
        category: categoryName,
        cat: product.cat ?? null,
        sub: product.sub ?? null
      });
    } else {
      currentOrderItems.push({
        productId: product.id,
        name: product.name,
        price: Number(product.price || 0),
        quantity: 1,
        isExisting: false,
        categoryName,
        category: categoryName,
        cat: product.cat ?? null,
        sub: product.sub ?? null
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

  function printReceipt(order, itemsToPrint = null) {
    const printWindow = window.open('', '_blank', 'width=380,height=700');
    if (!printWindow) return;

    const receiptItems = Array.isArray(itemsToPrint) ? itemsToPrint : (order.items || []);
    const normalizedItems = receiptItems.map((item) => ({
      ...item,
      productName: item.productName || item.name || item.product?.name || 'Unknown',
      productId: item.productId ?? item.id ?? item.product?.id ?? null,
      unitPrice: Number(item.unitPrice ?? item.price ?? item.product?.price ?? 0),
      quantity: Number(item.quantity ?? item.qty ?? 1),
      categoryName: item.categoryName || item.category || getItemCategoryName(item),
      category: item.categoryName || item.category || getItemCategoryName(item),
      cat: item.cat ?? item.product?.cat ?? null,
      sub: item.sub ?? item.product?.sub ?? null
    }));

    const receiptSubtotal = Number(order.subtotal ?? order.billingBreakdown?.subtotal ?? normalizedItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0));
    const receiptDiscountPercentage = Number(order.discountPercentage ?? order.billingBreakdown?.discountPercentage ?? 0);
    const receiptTaxPercentage = Number(order.taxPercentage ?? order.billingBreakdown?.taxPercentage ?? 0);
    const receiptServiceChargePercentage = Number(order.serviceChargePercentage ?? order.billingBreakdown?.serviceChargePercentage ?? 0);
    const receiptDiscountAmount = Number(order.discountAmount ?? order.billingBreakdown?.discountAmount ?? (receiptSubtotal * receiptDiscountPercentage) / 100);
    const receiptTaxAmount = Number(order.taxAmount ?? order.billingBreakdown?.taxAmount ?? (receiptSubtotal * receiptTaxPercentage) / 100);
    const receiptServiceChargeAmount = Number(order.serviceChargeAmount ?? order.billingBreakdown?.serviceChargeAmount ?? (receiptSubtotal * receiptServiceChargePercentage) / 100);
    const receiptTotal = Number(order.totalAmount ?? order.billingBreakdown?.totalAmount ?? receiptSubtotal - receiptDiscountAmount + receiptTaxAmount + receiptServiceChargeAmount);

    const groupedItems = buildCategoryGroupedItems(normalizedItems);
    const shouldSplitByCategory = groupedItems.length > 1;
    const printGroups = shouldSplitByCategory
      ? groupedItems.map(({ categoryName, items }) => ({ categoryName, items }))
      : [{ categoryName: null, items: normalizedItems }];

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const parts = [];

    printGroups.forEach(({ categoryName, items }) => {
      const categoryLabel = categoryName || 'Items';
      const itemsHtml = items.map((item) => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dotted #cbd5e1;font-size:13px;">
          <span style="font-weight:600;">${String(item.productName || item.name || 'Unnamed item').substring(0, 36)}</span>
          <span style="font-weight:700;">x${item.quantity}</span>
        </div>
      `).join('');

      const html = `
        <html>
          <head>
            <title>Order Slip</title>
            <style>
              body{font-family:Arial,Helvetica,sans-serif;margin:10px;padding:6px;color:#111827;background:#fff;font-size:13px;line-height:1.3;}
              .title{font-size:16px;font-weight:700;text-align:center;text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;}
              .meta{border-top:1px solid #000;border-bottom:1px solid #000;padding:6px 0;margin:8px 0;}
              .meta-row{display:flex;justify-content:space-between;margin:3px 0;font-size:12px;}
              .banner{margin:6px 0 4px;padding:4px 0;border-top:1px dashed #999;border-bottom:1px dashed #999;text-align:center;font-weight:700;font-size:12px;text-transform:uppercase;}
            </style>
          </head>
          <body>
            <div class="title">Order Slip</div>
            <div class="meta">
              <div class="meta-row"><span><strong>Table:</strong></span><span>${order.tableName || 'N/A'}</span></div>
              <div class="meta-row"><span><strong>Waiter:</strong></span><span>${order.waiterName || 'N/A'}</span></div>
              <div class="meta-row"><span><strong>Time:</strong></span><span>${timeStr}</span></div>
            </div>
            ${shouldSplitByCategory ? `<div class="banner">${categoryLabel}</div>` : ''}
            <div style="margin-top:8px;">${itemsHtml}</div>
            <div class="meta" style="margin-top:12px;border-top:1px solid #000;padding-top:8px;">
              <div class="meta-row"><span>Subtotal</span><span>${formatCurrency(receiptSubtotal)}</span></div>
              ${receiptDiscountAmount > 0 ? `<div class="meta-row"><span>Discount (${receiptDiscountPercentage}%)</span><span>-${formatCurrency(receiptDiscountAmount)}</span></div>` : ''}
              ${receiptTaxAmount > 0 ? `<div class="meta-row"><span>Tax (${receiptTaxPercentage}%)</span><span>+${formatCurrency(receiptTaxAmount)}</span></div>` : ''}
              ${receiptServiceChargeAmount > 0 ? `<div class="meta-row"><span>Service (${receiptServiceChargePercentage}%)</span><span>+${formatCurrency(receiptServiceChargeAmount)}</span></div>` : ''}
              <div class="meta-row" style="font-weight:700;"><span>Total</span><span>${formatCurrency(receiptTotal)}</span></div>
            </div>
          </body>
        </html>
      `;
      parts.push(html);
    });

    parts.forEach((html, index) => {
      if (index === 0) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      } else {
        const extraWindow = window.open('', '_blank', 'width=380,height=700');
        if (extraWindow) {
          extraWindow.document.write(html);
          extraWindow.document.close();
          extraWindow.focus();
          extraWindow.print();
        }
      }
    });
  }

  async function saveOrderToBackend(orderData, orderId = null) {
    const finalOrderId = orderId || `waiter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subtotal = currentOrderItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
    const discountAmount = (subtotal * (billingSettings.discountPercentage || 0)) / 100;
    const taxAmount = (subtotal * (billingSettings.taxPercentage || 0)) / 100;
    const serviceChargeAmount = (subtotal * (billingSettings.serviceChargePercentage || 0)) / 100;
    const totalAmount = subtotal - discountAmount + taxAmount + serviceChargeAmount;
    const now = new Date().toISOString();
    const isUpdate = Boolean(orderId);
    const orderPayload = {
      id: finalOrderId,
      waiterName: session?.username || 'Waiter',
      customerName: orderData.customerName || null,
      tableName: orderData.tableName,
      status: 'pending',
      items: currentOrderItems.map((item) => ({
        productId: item.productId,
        productName: item.name || item.productName || item.product?.name || 'Unknown',
        name: item.name || item.productName || item.product?.name || 'Unknown',
        price: Number(item.price ?? item.unitPrice ?? item.product?.price ?? 0),
        unitPrice: Number(item.price ?? item.unitPrice ?? item.product?.price ?? 0),
        quantity: Number(item.quantity || 1),
        qty: Number(item.quantity || 1),
        categoryName: item.categoryName || item.category || getItemCategoryName(item),
        category: item.categoryName || item.category || getItemCategoryName(item),
        cat: item.cat ?? item.product?.cat ?? null,
        sub: item.sub ?? item.product?.sub ?? null
      })),
      subtotal,
      discountPercentage: billingSettings.discountPercentage || 0,
      discountAmount,
      taxPercentage: billingSettings.taxPercentage || 0,
      taxAmount,
      serviceChargePercentage: billingSettings.serviceChargePercentage || 0,
      serviceChargeAmount,
      totalAmount,
      billingBreakdown: {
        subtotal,
        discountPercentage: billingSettings.discountPercentage || 0,
        discountAmount,
        taxPercentage: billingSettings.taxPercentage || 0,
        taxAmount,
        serviceChargePercentage: billingSettings.serviceChargePercentage || 0,
        serviceChargeAmount,
        totalAmount
      },
      allowCashierDelete: isUpdate ? false : true,
      createdFrom: isUpdate ? 'waiter-update' : 'waiter-create',
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
    const isEditing = Boolean(order?.id || currentOrderId);
    selectedCategoryId = null;
    selectedSubcategoryId = null;
    currentOrderItems = Array.isArray(order?.items) ? order.items.map((item) => ({
      productId: item.productId,
      name: item.name || item.productName || item.product?.name || 'Unknown',
      price: Number(item.price ?? item.unitPrice ?? item.product?.price ?? 0),
      quantity: Number(item.quantity || 1),
      isExisting: true,
      categoryName: item.categoryName || item.category || getItemCategoryName(item),
      category: item.categoryName || item.category || getItemCategoryName(item),
      cat: item.cat ?? item.product?.cat ?? null,
      sub: item.sub ?? item.product?.sub ?? null
    })) : [];

    const headerText = order ? 'Update Order' : 'Create Order';
    const buttonText = order ? 'Update Order' : 'Place Order';
    const modalHint = order ? 'You are updating an existing order.' : 'Select a table to start a new order.';

    const { modal, close } = createModal(`
      <header class="modal-header">
        <h3>${headerText}</h3>
        <button type="button" class="modal-close" aria-label="Close">✕</button>
      </header>
      <div class="modal-body" style="display:grid;gap:16px;max-height:70vh;overflow:auto;">
        <div class="muted" style="font-size:0.95rem;">${modalHint}</div>
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
      if (!currentOrderId && existingTableOrderMap.has(String(tableName).trim().toLowerCase())) {
        showToast(`An order already exists for table ${tableName}. Use Update Order to add items.`, 'error', 3200);
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
        const itemsForReceipt = currentOrderId
          ? currentOrderItems.filter((item) => item && !item.isExisting)
          : currentOrderItems;
        if (itemsForReceipt.length || !currentOrderId) {
          printReceipt(orderPayload, itemsForReceipt);
        }
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
