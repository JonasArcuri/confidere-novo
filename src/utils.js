function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function setOptions(select, options, placeholder, currentValue = '') {
  if (!select) return;
  select.textContent = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = placeholder.value ?? '';
    opt.textContent = placeholder.label ?? '';
    select.appendChild(opt);
  }
  options.forEach(({ value, label, dataset }) => {
    const opt = document.createElement('option');
    opt.value = value ?? '';
    opt.textContent = label ?? '';
    if (dataset) {
      Object.entries(dataset).forEach(([key, val]) => {
        opt.dataset[key] = val ?? '';
      });
    }
    select.appendChild(opt);
  });
  if (currentValue) select.value = currentValue;
}

export { escapeHtml, escapeAttr, setOptions };
