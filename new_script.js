const $fio = document.getElementById('fio');
const $btn = document.getElementById('findBtn');
const $addresses = document.getElementById('addresses');
const $details = document.getElementById('details');
const $container = document.querySelector('.container');

// Создаем элемент для статус уведомлений
const statusIndicator = document.createElement('div');
statusIndicator.className = 'status-indicator';
document.body.appendChild(statusIndicator);

function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Функции для управления состоянием загрузки и уведомлений
function showLoading(button, text = 'Загрузка...') {
  button.disabled = true;
  const originalText = button.innerHTML;
  button.innerHTML = `<div class="loading"><div class="spinner"></div> ${text}</div>`;
  return originalText;
}

function hideLoading(button, originalText) {
  button.disabled = false;
  button.innerHTML = originalText;
}

function showStatus(message, isError = false) {
  statusIndicator.textContent = message;
  statusIndicator.className = `status-indicator ${isError ? 'error' : ''} show`;
  
  setTimeout(() => {
    statusIndicator.classList.remove('show');
  }, 3000);
}

// Улучшенная функция анимации при показе результатов
function animateResults() {
  $container.classList.add('with-result');
  
  // Анимация появления карточек с задержкой
  const cards = document.querySelectorAll('.addr');
  cards.forEach((card, index) => {
    card.style.animationDelay = `${index * 0.1}s`;
  });
}

async function fetchAssignments(fio) {
  const url = `/api/assignments?fio=${encodeURIComponent(fio)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Ошибка загрузки адресов');
  const data = await res.json();
  if (data && data.error) {
    throw new Error(data.message || 'Ошибка загрузки адресов');
  }
  return data;
}

async function fetchText(partner, method) {
  const url = `/api/text?partner=${encodeURIComponent(partner)}&method=${encodeURIComponent(method)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Ошибка загрузки текста');
  const data = await res.json();
  if (data && data.error) {
    throw new Error(data.message || 'Ошибка загрузки текста');
  }
  return data;
}

function renderAddresses(list) {
  if (!list || list.length === 0) {
    $addresses.style.display = 'none';
    showStatus('Адреса для волны 1 не найдены', true);
    return;
  }
  
  $addresses.innerHTML = '';
  $addresses.style.display = 'grid';
  
  list.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'addr';
    div.dataset.partner = item.partner;
    div.dataset.method = item.method;
    div.dataset.display = item.display;
    div.innerHTML = htmlEscape(item.display);
    div.style.animationDelay = `${index * 0.1}s`;
    
    div.addEventListener('click', () => onPick(item));
    $addresses.appendChild(div);
  });
  
  animateResults();
  showStatus(`Найдено ${list.length} адресов`);
}

async function onPick(item) {
  try {
    const data = await fetchText(item.partner, item.method);
    
    $details.style.display = 'block';
    document.querySelector('#details .tester').innerHTML = `Тестировщик: <strong>${htmlEscape($fio.value)}</strong>`;
    document.querySelector('#details .place').innerHTML = htmlEscape(item.display);
    
    const textContent = data.text || data.general || 'Текст не найден';
    document.querySelector('#details .text').innerHTML = textContent;
    
    // Плавная прокрутка к деталям
    $details.scrollIntoView({ 
      behavior: 'smooth',
      block: 'start'
    });
    
    showStatus('Инструкции готовы');
    
  } catch (e) {
    showStatus(e.message || 'Ошибка получения текста', true);
  }
}

$btn.addEventListener('click', async () => {
  const fio = $fio.value.trim();
  if (!fio) {
    showStatus('Введите ФИО', true);
    $fio.focus();
    return;
  }
  
  const originalText = showLoading($btn, 'Поиск адресов...');
  
  try {
    const data = await fetchAssignments(fio);
    renderAddresses(data.items);
    $details.style.display = 'none';
    
  } catch (e) {
    showStatus(e.message || 'Ошибка поиска', true);
    $addresses.style.display = 'none';
    $container.classList.remove('with-result');
  } finally {
    hideLoading($btn, originalText);
  }
});

// Обработчики событий

// Поиск по Enter
$fio.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    $btn.click();
  }
});

// Автофокус на поле ввода при загрузке
document.addEventListener('DOMContentLoaded', () => {
  $fio.focus();
});


