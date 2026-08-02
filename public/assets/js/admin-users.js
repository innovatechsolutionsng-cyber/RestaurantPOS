// Run when DOM is ready (DOMContentLoaded or immediately if already loaded)
async function initializeEventManagement(){
  console.log('Initializing event management...');
  
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
    const response = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error = body && body.error ? body.error : response.statusText || 'backend_error';
      throw new Error(error);
    }
    return response.json();
  }

  async function isBackendAvailable() {
    try {
      const response = await fetchBackend('/health');
      return response && response.status === 'ok';
    } catch (err) {
      console.warn('Event management backend unavailable:', err);
      return false;
    }
  }

  let BACKEND_AVAILABLE = false;

  // Check if Auth is ready
  if (typeof Auth === 'undefined') {
    console.warn('Auth not yet defined, waiting...');
    return;
  }
  
  try {
    await RestaurantDB.init();
    BACKEND_AVAILABLE = await isBackendAvailable();
    console.log('Database initialized');
    console.log('Event management backend available:', BACKEND_AVAILABLE);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    alert('Database error. Clearing and retrying...');
    try {
      await RestaurantDB.clearAndReinitDB();
      console.log('Database reinitialized');
    } catch (clearErr) {
      console.error('Failed to clear database:', clearErr);
      alert('Critical: Could not initialize database');
      return;
    }
  }
  
  // Check session
  const session = Auth.getSession();
  console.log('Current session:', session);
  
  if(!session || session.role !== 'admin'){
    console.warn('User is not admin, skipping event management');
    return;
  }

  // ============= EVENT MANAGEMENT =============
  const eventNameInput = document.getElementById('event-name');
  const eventDateInput = document.getElementById('event-date');
  const eventLocationInput = document.getElementById('event-location');
  const eventPhoneInput = document.getElementById('event-phone');
  const btnAddEvent = document.getElementById('btn-add-event');
  const eventTable = document.getElementById('event-table');

  // Check if elements exist
  if (!eventNameInput || !eventDateInput || !eventLocationInput || !eventPhoneInput || !btnAddEvent || !eventTable) {
    console.error('Event management elements not found. Checking which ones are missing:');
    console.error('eventNameInput:', eventNameInput);
    console.error('eventDateInput:', eventDateInput);
    console.error('eventLocationInput:', eventLocationInput);
    console.error('eventPhoneInput:', eventPhoneInput);
    console.error('btnAddEvent:', btnAddEvent);
    console.error('eventTable:', eventTable);
    return;
  }
  
  console.log('Event management elements found, initializing...');

  async function loadAndRenderEvents(){
    try {
      console.log('Loading events...');
      let events = [];
      if (BACKEND_AVAILABLE) {
        try {
          const result = await fetchBackend('/api/events');
          events = result.events || [];
        } catch (err) {
          console.warn('Failed to load events from backend, falling back to local DB', err);
          events = await RestaurantDB.getAllEvents();
        }
      } else {
        events = await RestaurantDB.getAllEvents();
      }
      console.log('Fetched events:', events);
      const tbody = eventTable.querySelector('tbody');
      tbody.innerHTML = '';
      
      if (!events || events.length === 0) {
        console.log('No events found');
        tbody.innerHTML = '<tr><td colspan="6" style="padding:12px;text-align:center;color:var(--muted);">No events yet. Create one to get started.</td></tr>';
        return;
      }

      events.forEach(event => {
        console.log('Rendering event:', event);
        const row = document.createElement('tr');
        const createdDate = new Date(event.createdAt).toLocaleDateString('en-NG');
        // determine active event id from localStorage
        let activeId = null;
        try{ const a = JSON.parse(localStorage.getItem('activeEvent')||'null'); if(a && a.id) activeId = Number(a.id); }catch(e){}
        const isActive = activeId !== null && Number(activeId) === Number(event.id);
        row.innerHTML = `
          <td style="padding:8px;border-bottom:1px solid var(--border)">${event.name}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${event.date || 'N/A'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${event.location || 'N/A'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">${event.phone || 'N/A'}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border);font-size:0.85rem;color:var(--muted)">${createdDate}</td>
          <td style="padding:8px;border-bottom:1px solid var(--border)">
            <button data-edit-event="${event.id}" class="btn btn-secondary" style="padding:4px 8px;font-size:0.85rem">Edit</button>
            <button data-delete-event="${event.id}" class="btn btn-danger" style="padding:4px 8px;font-size:0.85rem;margin-left:4px">Delete</button>
            ${isActive ? `<span class="event-badge" style="display:inline-block;padding:4px 8px;border-radius:12px;margin-left:8px;background:linear-gradient(90deg,#10b981,#059669);color:#fff;font-weight:700;">ACTIVE</span>` : `<button data-make-active="${event.id}" class="btn btn-accent" style="padding:4px 8px;font-size:0.85rem;margin-left:8px">Make Active</button>`}
          </td>
        `;
        tbody.appendChild(row);
      });
      console.log('Rendered', events.length, 'events');

      // Wire up event handlers
      tbody.querySelectorAll('[data-delete-event]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const id = Number(ev.currentTarget.getAttribute('data-delete-event'));
          if (confirm('Delete this event?')) {
            try {
              if (BACKEND_AVAILABLE) {
                await fetchBackend('/api/events/delete', {
                  method: 'POST',
                  body: JSON.stringify({ id })
                });
              } else {
                await RestaurantDB.deleteEvent(id);
              }
              // if this was the active event, clear it so cashiers remove it
              try{ const act = JSON.parse(localStorage.getItem('activeEvent')||'null'); if(act && Number(act.id)===Number(id)) localStorage.removeItem('activeEvent'); }catch(e){}
              loadAndRenderEvents();
            } catch (err) {
              alert('Delete failed: ' + err.message);
            }
          }
        });
      });

      // Make Active handlers
      tbody.querySelectorAll('[data-make-active]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const id = Number(ev.currentTarget.getAttribute('data-make-active'));
          if (!id) return;
          try{
            const evt = await RestaurantDB.getEventById(id);
            if(evt){ localStorage.setItem('activeEvent', JSON.stringify(evt)); alert('Event set as active'); await loadAndRenderEvents(); }
          }catch(err){ console.error('Failed to set active event', err); alert('Failed to set active event'); }
        });
      });

      tbody.querySelectorAll('[data-edit-event]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const id = Number(ev.currentTarget.getAttribute('data-edit-event'));
          const event = await RestaurantDB.getEventById(id);
          if (event) {
            eventNameInput.value = event.name;
            eventDateInput.value = event.date || '';
            eventLocationInput.value = event.location || '';
            if (eventPhoneInput) eventPhoneInput.value = event.phone || '';
            btnAddEvent.setAttribute('data-edit-id', id);
            btnAddEvent.textContent = 'Update Event';
          }
        });
      });
    } catch (err) {
      console.error('Failed to load events:', err);
    }
  }

  btnAddEvent.addEventListener('click', async () => {
    console.log('Add Event button clicked');
    const name = eventNameInput.value.trim();
    const date = eventDateInput.value;
    const location = eventLocationInput.value.trim();

    const phone = (eventPhoneInput && eventPhoneInput.value.trim()) || '';
    console.log('Event data:', {name, date, location, phone});
                // do not auto-activate on create; admin can choose 'Make Active' explicitly

    try {
      const editId = btnAddEvent.getAttribute('data-edit-id');
      if (editId) {
        // Update
        console.log('Updating event with id:', editId);
        if (BACKEND_AVAILABLE) {
          await fetchBackend('/api/events/save', {
            method: 'POST',
            body: JSON.stringify({ id: Number(editId), name, date, location, phone })
          });
        } else {
          const event = await RestaurantDB.getEventById(Number(editId));
          if (event) {
            event.name = name;
            event.date = date;
            event.location = location;
            event.phone = phone;
            event.updatedAt = new Date().toISOString();
            await RestaurantDB.updateEvent(event);
          }
        }
        console.log('Event updated successfully');
        alert('Event updated!');
        btnAddEvent.removeAttribute('data-edit-id');
        btnAddEvent.textContent = 'Add Event';
      } else {
        // Add new
        console.log('Adding new event');
        if (BACKEND_AVAILABLE) {
          await fetchBackend('/api/events/save', {
            method: 'POST',
            body: JSON.stringify({ name, date, location, phone })
          });
        } else {
          const result = await RestaurantDB.addEvent({ name, date, location, phone });
          console.log('Event added with ID:', result);
        }
        alert('Event created!');
      }
      eventNameInput.value = '';
      eventDateInput.value = '';
      eventLocationInput.value = '';
      if (eventPhoneInput) eventPhoneInput.value = '';
      await loadAndRenderEvents();
      console.log('Events reloaded');
    } catch (err) {
      console.error('Error saving event:', err);
      alert('Error: ' + err.message);
    }
  });

  // Initialize - delay slightly to ensure DOM is ready
  setTimeout(() => {
    loadAndRenderEvents();
  }, 100);
}

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeEventManagement);
} else {
  // DOM is already loaded (happens when script loads late in page load)
  initializeEventManagement();
}
