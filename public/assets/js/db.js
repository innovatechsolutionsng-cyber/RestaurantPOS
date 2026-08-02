// IndexedDB helper with users store and auth utilities
const RestaurantDB = (function(){
  const DB_NAME = 'restaurantDB';
  const DB_VERSION = 4;
  let db = null;

  function openDB(){
    return new Promise((resolve,reject)=>{
      if(db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev)=>{
        const idb = ev.target.result;
        console.log('Database upgrade triggered, current version:', ev.oldVersion, 'new version:', ev.newVersion);
        if(!idb.objectStoreNames.contains('users')){
          const store = idb.createObjectStore('users',{keyPath:'id',autoIncrement:true});
          store.createIndex('by_username','username',{unique:true});
        }
        if(!idb.objectStoreNames.contains('menu')){
          const store = idb.createObjectStore('menu',{keyPath:'id',autoIncrement:true});
          store.createIndex('by_category','category',{unique:false});
        }
        if(!idb.objectStoreNames.contains('orders')){
          idb.createObjectStore('orders',{keyPath:'id',autoIncrement:true});
        }
        if(!idb.objectStoreNames.contains('events')){
          idb.createObjectStore('events',{keyPath:'id',autoIncrement:true});
        }
        // inventory stores: categories, subcategories, products
        if(!idb.objectStoreNames.contains('categories')){
          const s = idb.createObjectStore('categories',{keyPath:'id',autoIncrement:true});
          s.createIndex('by_name','name',{unique:false});
        }
        if(!idb.objectStoreNames.contains('subcategories')){
          const s = idb.createObjectStore('subcategories',{keyPath:'id',autoIncrement:true});
          s.createIndex('by_parent','parent',{unique:false});
        }
        if(!idb.objectStoreNames.contains('products')){
          const s = idb.createObjectStore('products',{keyPath:'id',autoIncrement:true});
          s.createIndex('by_sub','sub',{unique:false});
          s.createIndex('by_cat','cat',{unique:false});
        }
        if(!idb.objectStoreNames.contains('settings')){
          idb.createObjectStore('settings',{keyPath:'key'});
        }
      };
      req.onsuccess = ()=>{ db = req.result; resolve(db); };
      req.onerror = ()=> reject(req.error);
    });
  }

  function promisifyRequest(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  }

  async function withStore(name, mode, cb){
    const d = await openDB();
    const tx = d.transaction(name, mode);
    const store = tx.objectStore(name);
    const result = await cb(store);
    return new Promise((resolve,reject)=>{
      tx.oncomplete = ()=>resolve(result);
      tx.onerror = ()=>reject(tx.error);
    });
  }

  // simple hex helper
  function buf2hex(buffer){
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
  }

  async function hashPassword(password, salt){
    // salt: hex string
    const enc = new TextEncoder();
    const data = enc.encode(salt + password);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return buf2hex(hashBuf);
  }

  function normalizeIdKey(id){
    if (id === null || typeof id === 'undefined') return id;
    if (typeof id === 'number' || (typeof id === 'string' && /^[0-9]+$/.test(id.trim()))) {
      return Number(id);
    }
    return id;
  }

  function genSalt(){
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return buf2hex(arr.buffer);
  }

  function normalizeTables(tables){
    if(Array.isArray(tables)) return tables.map(x=>String(x).trim()).filter(Boolean);
    if(typeof tables === 'string') return tables.split(',').map(x=>x.trim()).filter(Boolean);
    return [];
  }

  // user helpers
  async function createUser({username, password, role='cashier', fullName='', status='active', tables=[]}){
    const safeUsername = (username || '').trim();
    const safeFullName = (fullName || '').trim();
    if(!safeUsername) throw new Error('username_required');
    if(!password || String(password).trim() === '') throw new Error('password_required');
    const existing = await getUserByUsername(safeUsername);
    if(existing) throw new Error('username_exists');
    const salt = genSalt();
    const hash = await hashPassword(String(password), salt);
    const user = {
      username: safeUsername,
      role,
      fullName: safeFullName || safeUsername,
      status: status || 'active',
      tables: normalizeTables(tables),
      hash,
      salt,
      createdAt:new Date().toISOString()
    };
    return withStore('users','readwrite', store => promisifyRequest(store.add(user)));
  }

  async function createWaiter({fullName, username, password, tables, status='active'}){
    return createUser({username, password, role:'waiter', fullName, status, tables});
  }

  async function getUserByUsername(username){
    return withStore('users','readonly', store => {
      const idx = store.index('by_username');
      return promisifyRequest(idx.get(username));
    });
  }

  async function getAllUsers(){
    return withStore('users','readonly', store => promisifyRequest(store.getAll()));
  }

  async function ensureInitialAdmin(){
    // If no users exist, create a default admin (admin / admin123)
    const users = await getAllUsers();
    if(!users || users.length===0){
      try{
        await createUser({username:'admin', password:'admin123', role:'admin'});
        return {seeded: true, username:'admin', password:'admin123'};
      }catch(err){
        return {seeded:false, error:err.message};
      }
    }
    return {seeded:false};
  }

  async function clearAndReinitDB(){
    return new Promise((resolve, reject) => {
      if(db) {
        db.close();
        db = null;
      }
      const deleteReq = indexedDB.deleteDatabase(DB_NAME);
      deleteReq.onsuccess = () => {
        console.log('Database deleted, reopening...');
        openDB().then(resolve).catch(reject);
      };
      deleteReq.onerror = () => {
        console.error('Failed to delete database:', deleteReq.error);
        reject(deleteReq.error);
      };
    });
  }

  return {
    init: openDB,
    clearAndReinitDB,
    withStore,
    promisifyRequest,
    hashPassword,
    genSalt,
    // user API
    createUser,
    createWaiter,
    getUserByUsername,
    // get user by id
    getUserById(id){
      return withStore('users','readonly', store => promisifyRequest(store.get(Number(id))));
    },
    // update a user's non-sensitive fields (role, username)
    updateUser(user){
      // user should contain id
      return withStore('users','readwrite', store => promisifyRequest(store.put(user)));
    },
    deleteUser(id){
      return withStore('users','readwrite', store => promisifyRequest(store.delete(Number(id))));
    },
    // change password for user id
    async changeUserPassword(id, newPassword){
      const u = await withStore('users','readonly', store => promisifyRequest(store.get(Number(id))));
      if(!u) throw new Error('no_user');
      const salt = genSalt();
      const hash = await hashPassword(newPassword, salt);
      u.salt = salt; u.hash = hash; // overwrite
      return withStore('users','readwrite', store => promisifyRequest(store.put(u)));
    },
    getAllUsers,
    ensureInitialAdmin,
    // menu & orders minimal APIs (kept for future use)
    addMenuItem(item){ return withStore('menu','readwrite', store => promisifyRequest(store.add(item))); },
    getAllMenuItems(){ return withStore('menu','readonly', store => promisifyRequest(store.getAll())); },
    addOrder(order){ 
      order.createdAt = new Date().toISOString(); 
      order.status = order.status || 'pending';
      return withStore('orders','readwrite', store => promisifyRequest(store.add(order))); 
    },
    getAllOrders(){ return withStore('orders','readonly', store => promisifyRequest(store.getAll())); },
    getOrderById(id){ return withStore('orders','readonly', store => promisifyRequest(store.get(normalizeIdKey(id)))); },
    updateOrder(order){ return withStore('orders','readwrite', store => promisifyRequest(store.put(order))); },
    deleteOrder(id){ return withStore('orders','readwrite', store => promisifyRequest(store.delete(normalizeIdKey(id)))); }
    ,
    // Inventory APIs
    addCategory(category){ category.createdAt = new Date().toISOString(); category.color = category.color || '#38bdf8'; return withStore('categories','readwrite', store => promisifyRequest(store.add(category))); },
    getAllCategories(){ return withStore('categories','readonly', store => promisifyRequest(store.getAll())); },
    deleteCategory(id){
      // remove category, its subcategories and their products
      return (async ()=>{
        await withStore('categories','readwrite', store => promisifyRequest(store.delete(Number(id))));
        // find subcategories belonging to this category
        const subs = await withStore('subcategories','readonly', store => promisifyRequest(store.getAll()));
        const subsToRemove = subs.filter(s=>String(s.parent)===String(id));
        const subsIds = subsToRemove.map(s=>String(s.id));
        // delete those subcategories
        await Promise.all(subsToRemove.map(s=> withStore('subcategories','readwrite', store => promisifyRequest(store.delete(Number(s.id))))));
        // remove products under this category or under the removed subcategories
        const prods = await withStore('products','readonly', store => promisifyRequest(store.getAll()));
        const prodsToRemove = prods.filter(p=> String(p.cat)===String(id) || subsIds.includes(String(p.sub)) );
        await Promise.all(prodsToRemove.map(p=> withStore('products','readwrite', store => promisifyRequest(store.delete(Number(p.id))))));
        return true;
      })();
    },
    addSubcategory(sub){ sub.createdAt = new Date().toISOString(); sub.color = sub.color || '#6ee7b7'; return withStore('subcategories','readwrite', store => promisifyRequest(store.add(sub))); },
    getAllSubcategories(){ return withStore('subcategories','readonly', store => promisifyRequest(store.getAll())); },
    deleteSubcategory(id){
      return (async ()=>{
        await withStore('subcategories','readwrite', store => promisifyRequest(store.delete(Number(id))));
        // delete products under this sub
        const prods = await withStore('products','readonly', store => promisifyRequest(store.getAll()));
        const remove = prods.filter(p=>String(p.sub)===String(id)).map(p=> withStore('products','readwrite', store => promisifyRequest(store.delete(Number(p.id)))));
        await Promise.all(remove);
        return true;
      })();
    },
    addProduct(prod){ prod.createdAt = new Date().toISOString(); prod.color = prod.color || '#c7d2fe'; // ensure barcode field exists (can be null)
      if(typeof prod.barcode === 'undefined') prod.barcode = null;
      // ensure quantity field exists (default 0)
      if(typeof prod.quantity === 'undefined' || prod.quantity === null) prod.quantity = 0;
      return withStore('products','readwrite', store => promisifyRequest(store.add(prod))); },
    getAllProducts(){ return withStore('products','readonly', store => promisifyRequest(store.getAll())); },
    getProductsBySub(subId){ return (async ()=>{ const all = await withStore('products','readonly', store => promisifyRequest(store.getAll())); return all.filter(p=>String(p.sub)===String(subId)); })(); },
    deleteProduct(id){ return withStore('products','readwrite', store => promisifyRequest(store.delete(Number(id)))); }
    ,
    // Get by id helpers for inventory
    getCategoryById(id){ return withStore('categories','readonly', store => promisifyRequest(store.get(Number(id)))); },
    getSubcategoryById(id){ return withStore('subcategories','readonly', store => promisifyRequest(store.get(Number(id)))); },
    getProductById(id){ return withStore('products','readonly', store => promisifyRequest(store.get(Number(id)))); },
    // Update helpers for inventory items
    updateCategory(cat){ return (async ()=>{ const existing = await withStore('categories','readonly', s => promisifyRequest(s.get(Number(cat.id)))); if(!existing) throw new Error('no_category'); existing.name = cat.name || existing.name; if(typeof cat.color !== 'undefined' && cat.color !== null) existing.color = cat.color; existing.updatedAt = new Date().toISOString(); return withStore('categories','readwrite', store => promisifyRequest(store.put(existing))); })(); },
    updateSubcategory(sub){ return (async ()=>{ const existing = await withStore('subcategories','readonly', s => promisifyRequest(s.get(Number(sub.id)))); if(!existing) throw new Error('no_subcategory'); existing.name = sub.name || existing.name; if(typeof sub.parent !== 'undefined' && sub.parent !== null) existing.parent = sub.parent; if(typeof sub.color !== 'undefined' && sub.color !== null) existing.color = sub.color; existing.updatedAt = new Date().toISOString(); return withStore('subcategories','readwrite', store => promisifyRequest(store.put(existing))); })(); },
    updateProduct(prod){ return (async ()=>{ const existing = await withStore('products','readonly', s => promisifyRequest(s.get(Number(prod.id)))); if(!existing) throw new Error('no_product'); existing.name = prod.name || existing.name; if(typeof prod.barcode !== 'undefined') existing.barcode = prod.barcode; if(typeof prod.cat !== 'undefined') existing.cat = prod.cat; if(typeof prod.sub !== 'undefined') existing.sub = prod.sub; if(typeof prod.color !== 'undefined' && prod.color !== null) existing.color = prod.color; // allow updating quantity
      if(typeof prod.quantity !== 'undefined') existing.quantity = Number(prod.quantity);
      existing.updatedAt = new Date().toISOString(); return withStore('products','readwrite', store => promisifyRequest(store.put(existing))); })(); },
    // Event APIs
    addEvent(event){ event.createdAt = new Date().toISOString(); return withStore('events','readwrite', store => promisifyRequest(store.add(event))); },
    getAllEvents(){ return withStore('events','readonly', store => promisifyRequest(store.getAll())); },
    getEventById(id){ return withStore('events','readonly', store => promisifyRequest(store.get(Number(id)))); },
    updateEvent(event){ return withStore('events','readwrite', store => promisifyRequest(store.put(event))); },
    deleteEvent(id){ return withStore('events','readwrite', store => promisifyRequest(store.delete(Number(id)))); },
    
    // Settings APIs
    getSetting(key){ return withStore('settings','readonly', store => promisifyRequest(store.get(String(key)))); },
    getAllSettings(){ return withStore('settings','readonly', store => promisifyRequest(store.getAll())); },
    setSetting(key, value){ return withStore('settings','readwrite', store => promisifyRequest(store.put({key: String(key), value, updatedAt: new Date().toISOString()}))); },
    deleteSetting(key){ return withStore('settings','readwrite', store => promisifyRequest(store.delete(String(key)))); }
  };
})();
