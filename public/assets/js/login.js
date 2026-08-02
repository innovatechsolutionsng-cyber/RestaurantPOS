// login page logic moved from inline script
(async function(){
  // remember-me support: prefills email if stored
  const remembered = localStorage.getItem('rememberedEmail');
  if(remembered){
    const el = document.getElementById('email'); if(el) el.value = remembered;
    const cb = document.getElementById('remember'); if(cb) cb.checked = true;
  }

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const uel = document.getElementById('email');
    const pwd = document.getElementById('password');
    const remember = document.getElementById('remember');
    const u = uel ? uel.value.trim() : '';
    const p = pwd ? pwd.value : '';
    if(!u || !p){ alert('Please enter email and password'); return; }
    try{
      const user = await Auth.login(u,p);
      if(remember && remember.checked){ localStorage.setItem('rememberedEmail', u); } else { localStorage.removeItem('rememberedEmail'); }
      // redirect by role
      if(user.role === 'admin') location.href = 'admin.html';
      else location.href = 'cashier.html';
    }catch(err){
      alert('Login failed: '+err.message + '. Backend connection is required.');
    }
  });
})();
