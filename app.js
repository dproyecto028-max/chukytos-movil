const apiUrl = 'https://script.google.com/macros/s/AKfycbws2H8kVv_9lOoMBgxzD4OojmPpFWFqy4F9TDLBZ8x-SwtBbkgycVyInO5NXOlTwGIo_Q/exec';
const defaultApiToken = '251372019d54420b835602be76029df8';
let currentUser = '';
let apiToken = localStorage.getItem('chukytosApiToken') || defaultApiToken;
let products = [];
let saleCart = [];
let cameraStream = null;
let cameraLoop = null;
let activeScanTarget = null;

const $ = (selector) => document.querySelector(selector);
const money = (value) => `$ ${Number(value || 0).toLocaleString('es-AR')}`;

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== name);
    panel.classList.toggle('active', panel.id === name);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
}

function setMessage(element, text, isError = false) {
  const node = $(element);
  if (!node) return;
  node.textContent = text;
  node.style.color = isError ? '#d5524b' : '#176b4b';
}

function normalizeCode(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function renderCart() {
  const list = $('#saleCartList');
  const totalEl = $('#saleTotal');
  if (!list || !totalEl) return;

  if (!saleCart.length) {
    list.innerHTML = '<div class="cart-item"><div><strong>Carrito vacío</strong><small>Aún no agregaste productos</small></div></div>';
    totalEl.textContent = '$ 0';
    return;
  }

  list.innerHTML = saleCart.map((item, index) => `
    <div class="cart-item">
      <div>
        <strong>${item.name}</strong>
        <small>${item.quantity} x ${money(item.price)}</small>
      </div>
      <button class="ghost" data-remove="${index}" type="button">Quitar</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-remove]').forEach(button => {
    button.addEventListener('click', () => {
      saleCart.splice(Number(button.dataset.remove), 1);
      renderCart();
    });
  });

  const total = saleCart.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
  totalEl.textContent = money(total);
}

function logIn() {
  const user = $('#loginUser').value.trim();
  const password = $('#loginPassword').value.trim();
  if (!user || !password) {
    $('#loginError').textContent = 'Ingresá usuario y contraseña.';
    return;
  }

  $('#loginError').textContent = 'Validando...';

  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'login',
      token: apiToken,
      username: user,
      password: password
    })
  })
    .then((response) => response.json())
    .then((result) => {
      if (!result.ok) throw new Error(result.error || 'No se pudo iniciar sesión.');
      currentUser = result.username || user;
      $('#loginScreen').classList.add('hidden');
      $('#mainScreen').classList.remove('hidden');
      $('#loginError').textContent = '';
      syncInventory();
    })
    .catch((error) => {
      $('#loginError').textContent = error.message;
    });
}

function syncInventory() {
  fetch(`${apiUrl}?action=inventory&token=${encodeURIComponent(apiToken)}`)
    .then((response) => response.json())
    .then((result) => {
      if (!result.ok) throw new Error(result.error || 'No se pudo sincronizar inventario.');
      products = Array.isArray(result.data) ? result.data.map(item => ({
        code: String(item.barcode || '').trim(),
        name: item.name || 'Producto',
        price: Number(item.price || 0),
        stock: Number(item.stock || 0),
        minimum: Number(item.minimum || 0),
        category: item.category || 'General',
        lots: Array.isArray(item.lots) ? item.lots : []
      })) : [];
    })
    .catch(() => {
      products = [];
    });
}

function addSaleItem() {
  const code = normalizeCode($('#saleCode').value);
  const qty = Math.max(1, Number($('#saleQty').value) || 1);
  if (!code) {
    setMessage('#saleMessage', 'Ingresá un código de barras.', true);
    return;
  }

  const found = products.find(item => normalizeCode(item.code) === code);
  if (!found) {
    setMessage('#saleMessage', 'No existe ese código en el inventario.', true);
    return;
  }

  const existing = saleCart.find(item => normalizeCode(item.code) === code);
  if (existing) {
    existing.quantity += qty;
  } else {
    saleCart.push({ code: found.code, name: found.name, price: Number(found.price || 0), quantity: qty });
  }

  renderCart();
  $('#saleCode').value = '';
  $('#saleQty').value = 1;
  setMessage('#saleMessage', `${found.name} agregado al carrito.`);
}

function finishSale() {
  if (!saleCart.length) {
    setMessage('#saleMessage', 'Agregá al menos un producto.', true);
    return;
  }

  const payload = {
    action: 'registerSale',
    token: apiToken,
    sale: {
      seller: currentUser,
      paymentMethod: 'Efectivo',
      paymentStatus: 'ABONADO',
      lines: saleCart.map(item => ({ lotId: item.code, quantity: item.quantity, unitPrice: item.price }))
    }
  };

  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
    .then((response) => response.json())
    .then((result) => {
      if (!result.ok) throw new Error(result.error || 'No se pudo registrar la venta.');
      saleCart = [];
      renderCart();
      setMessage('#saleMessage', 'Venta registrada correctamente.');
      syncInventory();
    })
    .catch((error) => {
      setMessage('#saleMessage', error.message, true);
    });
}

function saveEntry() {
  const barcode = normalizeCode($('#entryCode').value);
  const description = $('#entryName').value.trim();
  const category = $('#entryCategory').value.trim();
  const quantity = Number($('#entryQty').value || 0);
  const minimum = Number($('#entryMin').value || 0);
  const cost = Number($('#entryCost').value || 0);
  const salePrice = Number($('#entryPrice').value || 0);
  const expiry = $('#entryExpiry').value;

  if (!barcode || !description || !category || quantity < 1 || !expiry) {
    setMessage('#entryMessage', 'Completá código, nombre, categoría, cantidad y vencimiento.', true);
    return;
  }

  const exists = products.some(item => normalizeCode(item.code) === barcode);
  if (exists) {
    setMessage('#entryMessage', 'Ese código ya existe en el catálogo.', true);
    return;
  }

  const payload = {
    action: 'stockEntry',
    token: apiToken,
    lot: {
      barcode,
      description,
      category,
      quantity,
      minimum,
      cost,
      salePrice,
      expiry,
    },
    user: currentUser
  };

  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
    .then((response) => response.json())
    .then((result) => {
      if (!result.ok) throw new Error(result.error || 'No se pudo guardar la mercadería.');
      $('#entryCode').value = '';
      $('#entryName').value = '';
      $('#entryQty').value = 1;
      $('#entryMin').value = 0;
      $('#entryCost').value = '';
      $('#entryPrice').value = '';
      $('#entryCategory').value = '';
      $('#entryExpiry').value = '';
      setMessage('#entryMessage', 'Ingreso registrado.');
      syncInventory();
    })
    .catch((error) => {
      setMessage('#entryMessage', error.message, true);
    });
}

function lookupProduct() {
  const code = normalizeCode($('#lookupCode').value);
  const box = $('#lookupResult');
  if (!code) {
    box.className = 'lookup-box empty';
    box.innerHTML = '<span>Ingresá el código del producto para consultar.</span>';
    return;
  }

  const found = products.find(item => normalizeCode(item.code) === code);
  if (!found) {
    box.className = 'lookup-box';
    box.innerHTML = '<div class="product-meta"><strong>Código no encontrado</strong><small>Verificá que esté cargado en el inventario.</small></div>';
    return;
  }

  box.className = 'lookup-box';
  box.innerHTML = `
    <div class="product-meta">
      <strong>${found.name}</strong>
      <small>Código: ${found.code}</small>
      <small>Stock: ${found.stock} u.</small>
      <small>Precio: ${money(found.price)}</small>
      <small>Categoría: ${found.category}</small>
    </div>
  `;
}

function stopCamera() {
  if (cameraLoop) {
    clearInterval(cameraLoop);
    cameraLoop = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  $('#cameraModal').classList.add('hidden');
  $('#cameraVideo').srcObject = null;
}

async function startCameraScan(targetId) {
  const target = $(targetId);
  if (!target) return;

  activeScanTarget = target;
  $('#cameraStatus').textContent = 'Ajustá la cámara sobre el código.';
  $('#cameraModal').classList.remove('hidden');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#cameraStatus').textContent = 'Este navegador no admite cámara.';
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    $('#cameraVideo').srcObject = cameraStream;
    await $('#cameraVideo').play();
    $('#cameraStatus').textContent = 'Escaneando…';

    const detector = new BarcodeDetector({ formats: ['code_128','code_39','code_93','ean_13','ean_8','itf','upc_a','upc_e'] });
    cameraLoop = setInterval(async () => {
      try {
        const barcodes = await detector.detect($('#cameraVideo'));
        const found = barcodes.find(item => item.rawValue && item.rawValue.trim());
        if (!found) return;
        const code = normalizeCode(found.rawValue);
        if (!code) return;
        target.value = code;
        stopCamera();
        if (target.id === 'saleCode') addSaleItem();
        if (target.id === 'lookupCode') lookupProduct();
      } catch (error) {
        $('#cameraStatus').textContent = 'No se pudo detectar el código. Ajustá la cámara.';
      }
    }, 600);
  } catch (error) {
    $('#cameraStatus').textContent = 'No se pudo acceder a la cámara.';
  }
}

$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  logIn();
});

$('#logoutBtn').addEventListener('click', () => {
  $('#mainScreen').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
  $('#loginPassword').value = '';
  $('#loginUser').focus();
});

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => showPanel(button.dataset.tab));
});

$('#addSaleItemBtn').addEventListener('click', addSaleItem);
$('#finishSaleBtn').addEventListener('click', finishSale);
$('#saveEntryBtn').addEventListener('click', saveEntry);
$('#lookupBtn').addEventListener('click', lookupProduct);
$('#quickScanBtn').addEventListener('click', () => startCameraScan('#saleCode'));
$('#closeCameraBtn').addEventListener('click', stopCamera);
$('#cameraModal').addEventListener('click', (event) => {
  if (event.target === $('#cameraModal')) stopCamera();
});

$('#saleCode').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addSaleItem();
  }
});

$('#lookupCode').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupProduct();
  }
});

$('#entryCode').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveEntry();
  }
});

localStorage.setItem('chukytosApiToken', apiToken);
renderCart();
showPanel('panelVentas');
