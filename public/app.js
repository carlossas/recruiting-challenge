const merchantPicker = document.getElementById('merchant-picker');
const merchantSelect = document.getElementById('merchant-select');
const sessionLabel = document.getElementById('session-label');
const salesOrdersEl = document.getElementById('sales-orders');
const refundOrdersEl = document.getElementById('refund-orders');
const avgOrderEl = document.getElementById('avg-order');
const avgNetOrderEl = document.getElementById('avg-net-order');
const revenue30dEl = document.getElementById('revenue-30d');
const revenueBreakdownEl = document.getElementById('revenue-breakdown');
const ordersTbody = document.getElementById('orders-tbody');
const downloadCsvButton = document.getElementById('download-csv');

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

// One definition of "the window on screen", shared by the cards and the CSV export so the two
// can never disagree. `to` is exclusive, hence tomorrow: with today's date it would drop today.
function currentRange() {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
    to: isoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
  };
}

function setStatus(text) {
  sessionLabel.textContent = text;
}

async function refresh() {
  const summary = await api('/api/metrics/summary');
  salesOrdersEl.textContent = summary.sales_orders ?? '—';
  refundOrdersEl.textContent = summary.refund_orders ?? '—';
  avgOrderEl.textContent = money(summary.avg_order_value_cents ?? 0);
  avgNetOrderEl.textContent = `${money(summary.avg_net_order_value_cents ?? 0)} net of refunds`;

  const { from, to } = currentRange();
  const revenue = await api(`/api/revenue?from=${from}&to=${to}`);
  revenue30dEl.textContent = money(revenue.revenue_cents ?? 0);
  revenueBreakdownEl.textContent = `${money(revenue.gross_sales_cents ?? 0)} sales − ${money(revenue.refunds_cents ?? 0)} refunded`;

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

  // Decide by capability, not identity: after picking a merchant the session reads as
  // "merchant" while the admin cookie is still there and can mint (plan 007).
  if (!session.canSwitchMerchants) {
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
  if (merchants.length === 0) return;

  if (session.merchantId) {
    // Reload with a live merchant session: reuse it instead of minting another token.
    merchantSelect.value = session.merchantId;
    selectedMerchantId = session.merchantId;
    setStatus(`Viewing ${session.merchantId}`);
    await refresh();
    return;
  }
  await selectMerchant(merchantSelect.value);
}

async function downloadCsv() {
  if (!selectedMerchantId) return;
  const { from, to } = currentRange();
  const path = `/api/orders/export.csv?from=${from}&to=${to}`;

  // A plain <a download> would save the JSON error body when the short-lived merchant token has
  // expired, so fetch first and re-mint on 401 exactly like the data calls do.
  let response = await request(path);
  if (response.status === 401 && (await mintMerchantToken(selectedMerchantId))) {
    response = await request(path);
  }
  if (!response.ok) {
    setStatus(`Export failed (${response.status})`);
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFrom(response) ?? `orders-${selectedMerchantId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameFrom(response) {
  const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '');
  return match ? match[1] : null;
}

downloadCsvButton.addEventListener('click', () => {
  downloadCsvButton.disabled = true;
  downloadCsv()
    .catch((error) => setStatus(String(error)))
    .finally(() => {
      downloadCsvButton.disabled = false;
    });
});

merchantSelect.addEventListener('change', () => {
  selectMerchant(merchantSelect.value).catch((error) => setStatus(String(error)));
});

start().catch((error) => setStatus(String(error)));
