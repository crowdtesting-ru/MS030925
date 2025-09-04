// Логика взята из excel_script.js и адаптирована под папку new/ и файл data.xlsx

const $fio = document.getElementById('fio');
const $btn = document.getElementById('findBtn');
const $addresses = document.getElementById('addresses');
const $container = document.querySelector('.container');

let excelData = { выборка: null, тексты: null };

const statusIndicator = document.createElement('div');
statusIndicator.className = 'status-indicator';
document.body.appendChild(statusIndicator);

function normalizeString(text) {
  if (!text) return '';
  return text.toString().toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е');
}

function htmlEscape(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showStatus(message, isError = false) {
  statusIndicator.textContent = message;
  statusIndicator.className = `status-indicator ${isError ? 'error' : 'success'} show`;
  setTimeout(() => statusIndicator.classList.remove('show'), 3000);
}

function showLoading(button, text = 'Загрузка...') {
  const originalText = button.textContent;
  button.disabled = true;
  button.innerHTML = `<span class="loading">${text}</span>`;
  return originalText;
}

function hideLoading(button, originalText) {
  button.disabled = false;
  button.textContent = originalText;
}

async function loadExcelFile() {
  try {
    if (location.protocol === 'file:') {
      showStatus('Откройте через http://localhost/ (не file://)', true);
      return false;
    }

    // Сначала ищем рядом со страницей (new/data.xlsx), затем пробуем из корня проекта
    const candidatePaths = ['data.xlsx', 'Таблица для загрузки.xlsx', '../data.xlsx', '../Таблица для загрузки.xlsx'];
    let response = null;
    for (const path of candidatePaths) {
      try {
        const r = await fetch(encodeURI(path));
        if (r.ok) { response = r; break; }
      } catch (_) {}
    }
    if (!response) { throw new Error('Excel не найден рядом со страницей'); }

    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    if (workbook.SheetNames.includes('Выборка')) {
      excelData.выборка = XLSX.utils.sheet_to_json(workbook.Sheets['Выборка']);
    } else {
      showStatus('Нет листа "Выборка"', true);
      return false;
    }

    if (workbook.SheetNames.includes('Тексты')) {
      excelData.тексты = XLSX.utils.sheet_to_json(workbook.Sheets['Тексты'], { header: 1 });
    } else {
      // Лист "Тексты" может быть в подготовке — не блокируем работу, просто не будет инструкций
      excelData.тексты = [];
    }

    showStatus(`Excel загружен (${excelData.выборка.length})`);
    return true;
  } catch (e) {
    console.error(e);
    showStatus('Ошибка загрузки Excel', true);
    return false;
  }
}

async function findAssignments(fio) {
  if (!excelData.выборка) {
    const ok = await loadExcelFile();
    if (!ok) return [];
  }

  const normalizedFio = normalizeString(fio);

  const results = [];
  excelData.выборка.forEach(row => {
    const tester = normalizeString(row['Тестировщик'] || '');
    const waveRaw = row['№ волны'];
    const waveStr = String(waveRaw ?? '').trim().toLowerCase();
    const isWave1 = waveStr === 'волна 1';

    if (tester.includes(normalizedFio) && isWave1) {
      results.push({
        partner: row['Партнер'] || '',
        restaurant: row['Ресторан'] || '',
        address: row['Адрес'] || '',
        city: row['Город'] || '',
        method: row['Способ проверки'] || '',
        display: `${row['Партнер'] || ''} → ${row['Ресторан'] || ''} → ${row['Адрес'] || ''} → ${row['Способ проверки'] || ''}`
      });
    }
  });

  return results;
}

async function findText(partner, method) {
  if (!excelData.тексты) { await loadExcelFile(); }
  if (!excelData.тексты || excelData.тексты.length < 3) return '';
  const partnersRow = excelData.тексты[0] || [];
  const methodsRow = excelData.тексты[1] || [];
  const textsRow = excelData.тексты[2] || [];
  const np = normalizeString(partner), nm = normalizeString(method);
  for (let i = 1; i < partnersRow.length; i++) {
    if (normalizeString(partnersRow[i]) === np && normalizeString(methodsRow[i]) === nm) {
      return textsRow[i] || '';
    }
  }
  return textsRow[textsRow.length - 1] || '';
}

function renderAddresses(items) {
  if (!items || items.length === 0) {
    $addresses.innerHTML = '<div class="addr">Адреса не найдены для этой волны</div>';
    $addresses.style.display = 'block';
    $container.classList.add('with-result');
    return;
  }

  const html = items.map(item => `
    <div class="addr" data-partner="${htmlEscape(item.partner)}" data-method="${htmlEscape(item.method)}">
      <div class="addr-header"><strong>${htmlEscape(item.partner)}</strong> — ${htmlEscape(item.restaurant)}</div>
      <div class="addr-details">${htmlEscape(item.address)}<br>${htmlEscape(item.method)}</div>
    </div>
  `).join('');

  $addresses.innerHTML = html;
  $addresses.style.display = 'block';
  $container.classList.add('with-result');

  document.querySelectorAll('.addr').forEach(node => {
    node.addEventListener('click', async () => {
      const partner = node.dataset.partner;
      const method = node.dataset.method;
      await onPick({ partner, method, display: node.textContent.trim() });
    });
  });
}

async function onPick(item) {
  let details = document.getElementById('details');
  if (!details) {
    details = document.createElement('div');
    details.id = 'details';
    details.className = 'details';
    details.innerHTML = '<div class="tester"></div><div class="place"></div><div class="text"></div>';
    $container.appendChild(details);
  }
  const text = await findText(item.partner, item.method);
  details.style.display = 'block';
  details.querySelector('.tester').innerHTML = `Тестировщик: <strong>${htmlEscape($fio.value)}</strong>`;
  details.querySelector('.place').innerHTML = htmlEscape(item.display);
  details.querySelector('.text').innerHTML = (text || '').replace(/\n/g, '<br>');
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function performSearch() {
  const fio = $fio.value.trim();
  if (!fio) { showStatus('Введите ФИО', true); $fio.focus(); return; }
  const orig = showLoading($btn, 'Поиск адресов...');
  try {
    const items = await findAssignments(fio);
    renderAddresses(items);
    const details = document.getElementById('details');
    if (details) details.style.display = 'none';
  } catch (e) {
    console.error(e); showStatus('Ошибка поиска', true);
  } finally { hideLoading($btn, orig); }
}

document.addEventListener('DOMContentLoaded', async () => {
  $fio.focus();
  $btn.addEventListener('click', performSearch);
  $fio.addEventListener('keypress', e => { if (e.key === 'Enter') performSearch(); });
  await loadExcelFile();
});


