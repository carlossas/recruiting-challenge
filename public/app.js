const merchantPicker = document.getElementById('merchant-picker');
const merchantSelect = document.getElementById('merchant-select');
const sessionLabel = document.getElementById('session-label');
const totalOrdersEl = document.getElementById('total-orders');
const uniqueCustomersEl = document.getElementById('unique-customers');
const avgOrderEl = document.getElementById('avg-order');
const revenue30dEl = document.getElementById('revenue-30d');
const ordersTbody = document.getElementById('orders-tbody');

// The session lives in HttpOnly cookies, so this page never holds a token.
// Merchant tokens are short-lived: on a 401 we ask for a new one and retry once.
let selectedMerchantId = null;

function request(path, options = {}) {
  return fetch(path, { credentials: 'same-origin', ...options });
}

async function mintMerchantToken(merchantId) {
  const response = await request('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merchantId }),
  });
  return response.ok;
}

async function api(path) {
  let response = await request(path);
  if (response.status === 401 && selectedMerchantId && (await mintMerchantToken(selectedMerchantId))) {
    response = await request(path);
  }
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
}

function money(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function setStatus(text) {
  sessionLabel.textContent = text;
}

async function refresh() {
  const summary = await api('/api/metrics/summary');
  totalOrdersEl.textContent = summary.total_orders ?? '—';
  uniqueCustomersEl.textContent = summary.unique_customers ?? '—';
  avgOrderEl.textContent = money(summary.avg_order_value_cents ?? 0);

  const now = new Date();
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const revenue = await api(`/api/revenue?from=${isoDate(thirtyAgo)}&to=${isoDate(now)}`);
  revenue30dEl.textContent = money(revenue.revenue_cents ?? 0);

  const ordersRes = await api('/api/orders?limit=10');
  ordersTbody.innerHTML = '';
  for (const o of ordersRes.orders ?? []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(o.created_at).toLocaleDateString()}</td>
      <td>${o.customer_email}</td>
      <td>${o.type}</td>
      <td>${money(o.total_amount)}</td>
    `;
    ordersTbody.appendChild(tr);
  }
}

async function selectMerchant(merchantId) {
  selectedMerchantId = merchantId;
  if (!(await mintMerchantToken(merchantId))) {
    setStatus(`Could not open a session for ${merchantId}.`);
    return;
  }
  setStatus(`Viewing ${merchantId}`);
  await refresh();
}

async function start() {
  const sessionResponse = await request('/api/auth/session');
  if (!sessionResponse.ok) {
    merchantPicker.hidden = true;
    setStatus('No session. Run "npm run token" and POST it to /api/auth/admin-session.');
    return;
  }
  const session = await sessionResponse.json();

  if (session.role === 'merchant') {
    // A merchant session is bound to one merchant: no picker to show.
    merchantPicker.hidden = true;
    selectedMerchantId = session.merchantId;
    setStatus(`Viewing ${session.merchantId}`);
    await refresh();
    return;
  }

  const { merchants } = await api('/api/merchants');
  merchantSelect.innerHTML = '';
  for (const merchant of merchants) {
    const option = document.createElement('option');
    option.value = merchant.id;
    option.textContent = merchant.name;
    merchantSelect.appendChild(option);
  }
  merchantPicker.hidden = merchants.length === 0;
  if (merchants.length > 0) await selectMerchant(merchantSelect.value);
}

merchantSelect.addEventListener('change', () => {
  selectMerchant(merchantSelect.value).catch((error) => setStatus(String(error)));
});

start().catch((error) => setStatus(String(error)));
