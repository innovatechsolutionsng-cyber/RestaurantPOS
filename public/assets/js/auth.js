// Authentication helper (uses RestaurantDB)
const Auth = (function(){
  const STORAGE_KEY = 'restaurant_session';
  const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

  async function getConfiguredSessionTTL(){
    try {
      const timeoutSetting = await RestaurantDB.getSetting('sessionTimeoutMinutes');
      const minutes = timeoutSetting ? Number(timeoutSetting.value) : NaN;
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
        return DEFAULT_SESSION_TTL_MS;
      }
      return minutes * 60 * 1000;
    } catch (err) {
      return DEFAULT_SESSION_TTL_MS;
    }
  }

  async function encodeBase64Url(bytes) {
    const binary = Array.from(bytes).map(byte => String.fromCharCode(byte)).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function utf8ToBytes(value) {
    return new TextEncoder().encode(value);
  }

  async function hmacSha256(secret, message) {
    const key = await crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, utf8ToBytes(message));
    return new Uint8Array(signature);
  }

  const API_BASE_URL = (() => {
    try {
      if (window.location.protocol.startsWith('http')) {
        return `${window.location.protocol}//${window.location.host}`;
      }
    } catch (e) {
      // Running in non-browser environment
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

  async function getJwtSecret(){
    try{
      const secretSetting = await RestaurantDB.getSetting('jwtSecret');
      return secretSetting ? String(secretSetting.value) : null;
    }catch(e){
      return null;
    }
  }

  async function saveSession(user, token){
    const now = Date.now();
    const ttl = await getConfiguredSessionTTL();
    const session = {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName || user.username || null,
      status: user.status || null,
      issuedAt: now,
      expiresAt: now + ttl,
      token: token || null
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function clearSession(){
    localStorage.removeItem(STORAGE_KEY);
  }

  function updateSession(changes){
    const current = getSession();
    if(!current) return null;
    const updated = Object.assign({}, current, changes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  function getSession(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    try{
      const s = JSON.parse(raw);
      if(s.expiresAt && Date.now() > s.expiresAt){
        clearSession();
        return null;
      }
      return s;
    }catch(e){
      clearSession();
      return null;
    }
  }

  async function login(username, password){
    const payload = { username: username.trim(), password };
    const data = await fetchBackend('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    if (data.success && data.user) {
      await saveSession(data.user, data.token);
      return { id: data.user.id, username: data.user.username, role: data.user.role };
    }
    throw new Error(data.error || 'login_failed');
  }

  async function logout(){
    clearSession();
  }

  async function changePassword(currentPassword, newPassword){
    const s = getSession();
    if(!s) throw new Error('not_authenticated');

    const response = await fetchBackend('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ username: s.username, currentPassword, newPassword })
    });
    return response.success === true;
  }

  function updateSession(changes){
    const current = getSession();
    if(!current) return null;
    const updated = Object.assign({}, current, changes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  function requireRole(required){
    const s = getSession();
    if(!s) { location.replace('index.html'); return false; }
    if(Array.isArray(required)){
      if(!required.includes(s.role)){ location.replace('index.html'); return false; }
    } else {
      if(s.role !== required){ location.replace('index.html'); return false; }
    }
    return true;
  }

  async function getToken(){
    const s = getSession();
    return s ? s.token || null : null;
  }

  return { login, logout, getSession, updateSession, requireRole, changePassword, getToken, getJwtSecret };
})();
