// Чтение Excel файла напрямую без JSON!
// Использует SheetJS для работы с Excel

// Элементы интерфейса
const $fio = document.getElementById('fio');
const $btn = document.getElementById('findBtn');
const $addresses = document.getElementById('addresses');
const $details = document.getElementById('details');
const $container = document.querySelector('.container');

// Кеш данных Excel
let excelData = {
    выборка: null,
    тексты: null
};

// Статус индикатор
const statusIndicator = document.createElement('div');
statusIndicator.className = 'status-indicator';
document.body.appendChild(statusIndicator);

// Утилиты
function htmlEscape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function normalizeString(text) {
    if (!text) return '';
    return text.toString().toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е');
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

function showStatus(message, isError = false) {
    statusIndicator.textContent = message;
    statusIndicator.className = `status-indicator ${isError ? 'error' : 'success'} show`;
    
    setTimeout(() => {
        statusIndicator.classList.remove('show');
    }, 3000);
}

function animateResults() {
    const cards = document.querySelectorAll('.addr');
    cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
        card.classList.add('fadeInUp');
    });
}

// Загрузка и парсинг Excel файла из папки проекта
async function loadExcelFile() {
    try {
        // Предупреждаем, если открыто через file:// (браузер блокирует fetch)
        if (location.protocol === 'file:') {
            showStatus('Откройте страницу через http://localhost:8080/ (а не file://)', true);
            console.error('Страница открыта через file:// — fetch к локальным файлам заблокирован политикой браузера.');
            return false;
        }

        console.log('🔄 Начинаем загрузку Excel файла из папки проекта...');
        showStatus('Загружаем Excel файл...', false);
        
        // Пытаемся сначала загрузить безопасное имя (ASCII), затем старое кириллическое
        const candidatePaths = ['data.xlsx', 'Таблица для загрузки.xlsx'];
        let response = null;
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                const r = await fetch(encodeURI(path));
                if (r.ok) {
                    response = r;
                    console.log(`📥 Загружен файл: ${path}`);
                    break;
                } else {
                    lastError = new Error(`HTTP ${r.status} для ${path}`);
                }
            } catch (e) {
                lastError = e;
            }
        }

        if (!response) {
            throw lastError || new Error('Не удалось найти Excel файл рядом со страницей');
        }
        
        console.log('✅ Excel файл загружен, читаем данные...');
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        
        console.log('📋 Найдены листы:', workbook.SheetNames);
        
        // Читаем лист "Выборка"
        if (workbook.SheetNames.includes('Выборка')) {
            const worksheet = workbook.Sheets['Выборка'];
            excelData.выборка = XLSX.utils.sheet_to_json(worksheet);
            console.log(`📊 Лист "Выборка": ${excelData.выборка.length} записей`);
            
            // Проверяем первые несколько записей
            console.log('🔍 Первые 3 записи:', excelData.выборка.slice(0, 3));
        } else {
            console.error('❌ Лист "Выборка" не найден!');
            showStatus('Лист "Выборка" не найден в файле!', true);
            return false;
        }
        
        // Читаем лист "Тексты"
        if (workbook.SheetNames.includes('Тексты')) {
            const worksheet = workbook.Sheets['Тексты'];
            const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            excelData.тексты = rawData;
            console.log(`📝 Лист "Тексты": ${rawData.length} строк`);
        } else {
            console.error('❌ Лист "Тексты" не найден!');
            showStatus('Лист "Тексты" не найден в файле!', true);
            return false;
        }
        
        console.log('🎉 Excel файл успешно обработан!');
        showStatus(`✅ Excel загружен: ${excelData.выборка.length} записей`, false);
        
        return true;
    } catch (error) {
        console.error('❌ Ошибка загрузки Excel:', error);
        showStatus(`Ошибка загрузки Excel: ${error.message}`, true);
        return false;
    }
}

// Поиск назначений по ФИО
async function findAssignments(fio) {
    console.log('🔍 Ищем назначения для ФИО:', fio);
    
    if (!excelData.выборка) {
        console.log('📄 Данные не загружены, загружаем Excel...');
        const loaded = await loadExcelFile();
        if (!loaded) return [];
    }
    
    const normalizedFio = normalizeString(fio);
    console.log('🔤 Нормализованное ФИО:', normalizedFio);
    
    const results = [];
    let checkedCount = 0;
    let wave1Count = 0;
    let matchingTesters = [];
    
    excelData.выборка.forEach((row, index) => {
        checkedCount++;
        
        const тестировщик = normalizeString(row['Тестировщик'] || '');
        const волнаСырье = row['№ волны'];
        // Нормализуем значение волны: поддерживаем 1, '1', '1 ', '1.0', '1,0'
        const волнаСтр = String(волнаСырье ?? '').trim().replace(',', '.');
        const этоПерваяВолна = волнаСырье === 1 || волнаСтр === '1' || волнаСтр === '1.0';
        
        if (этоПерваяВолна) {
            wave1Count++;
        }
        
        // Собираем всех тестировщиков для отладки
        if (row['Тестировщик'] && row['Тестировщик'].trim()) {
            matchingTesters.push({
                original: row['Тестировщик'],
                normalized: тестировщик,
                wave: волна
            });
        }
        
        // Фильтруем по ФИО и волне 1
        if (тестировщик.includes(normalizedFio) && этоПерваяВолна) {
            console.log(`✅ Найдено совпадение в строке ${index + 1}:`, {
                тестировщик: row['Тестировщик'],
                normalized: тестировщик,
                волна: волнаСырье,
                партнер: row['Партнер'],
                ресторан: row['Ресторан']
            });
            
            results.push({
                partner: row['Партнер'] || '',
                restaurant: row['Ресторан'] || '',
                address: row['Адрес'] || '',
                city: row['Город'] || '',
                method: row['Способ проверки'] || '',
                wave: волнаСырье,
                booking: row['Нужна бронь?'] || '',
                min_order: row['Минимальный заказ на доставку'] || '',
                website: row['Ссылка на сайт'] || '',
                comment: row['Комментарий'] || '',
                display: `${row['Партнер'] || ''} → ${row['Ресторан'] || ''} → ${row['Адрес'] || ''} → ${row['Способ проверки'] || ''}`
            });
        }
    });
    
    console.log(`📊 Статистика поиска:
        - Проверено строк: ${checkedCount}
        - Записей с волной 1: ${wave1Count}
        - Найдено результатов: ${results.length}
        - Уникальные тестировщики (первые 10):`, matchingTesters.slice(0, 10));
    
    return results;
}

// Поиск текста по партнеру и способу
async function findText(partner, method) {
    if (!excelData.тексты) {
        const loaded = await loadExcelFile();
        if (!loaded) return 'Текст не найден';
    }
    
    const normalizedPartner = normalizeString(partner);
    const normalizedMethod = normalizeString(method);
    
    // Структура листа "Тексты": 
    // Строка 0: партнеры, Строка 1: способы, Строка 2: тексты
    if (excelData.тексты.length < 3) {
        return 'Неверная структура листа "Тексты"';
    }
    
    const partnersRow = excelData.тексты[0] || [];
    const methodsRow = excelData.тексты[1] || [];
    const textsRow = excelData.тексты[2] || [];
    
    // Ищем подходящую колонку
    let foundText = '';
    
    for (let i = 1; i < partnersRow.length; i++) {
        const partnerInCol = normalizeString(partnersRow[i] || '');
        const methodInCol = normalizeString(methodsRow[i] || '');
        
        if (partnerInCol === normalizedPartner && methodInCol === normalizedMethod) {
            foundText = textsRow[i] || '';
            break;
        }
    }
    
    // Если не найден, берем общий текст (последняя колонка)
    if (!foundText && textsRow.length > 0) {
        foundText = textsRow[textsRow.length - 1] || 'Текст не найден';
    }
    
    return foundText || 'Текст не найден';
}

// Рендеринг списка адресов
function renderAddresses(items) {
    if (!items || items.length === 0) {
        $addresses.innerHTML = '<div class="no-results">Адреса не найдены для этого ФИО в волне 1</div>';
        $addresses.style.display = 'block';
        $container.classList.add('with-result');
        return;
    }

    const html = items.map(item => `
        <div class="addr" data-partner="${htmlEscape(item.partner)}" data-method="${htmlEscape(item.method)}">
            <div class="addr-header">
                <strong>${htmlEscape(item.partner)}</strong>
                <span class="method">${htmlEscape(item.method)}</span>
            </div>
            <div class="addr-details">
                <div class="restaurant">${htmlEscape(item.restaurant)}</div>
                <div class="address">${htmlEscape(item.address)}</div>
                ${item.city ? `<div class="city">Город: ${htmlEscape(item.city)}</div>` : ''}
                ${item.booking ? `<div class="booking">Бронь: ${htmlEscape(item.booking)}</div>` : ''}
                ${item.min_order ? `<div class="min-order">Мин. заказ: ${htmlEscape(item.min_order)}</div>` : ''}
                ${item.website ? `<div class="website"><a href="${htmlEscape(item.website)}" target="_blank">Сайт</a></div>` : ''}
                ${item.comment ? `<div class="comment">Комментарий: ${htmlEscape(item.comment)}</div>` : ''}
            </div>
        </div>
    `).join('');

    $addresses.innerHTML = html;
    $addresses.style.display = 'block';
    $container.classList.add('with-result');

    // Добавляем обработчики кликов
    document.querySelectorAll('.addr').forEach(addr => {
        addr.addEventListener('click', () => {
            const partner = addr.dataset.partner;
            const method = addr.dataset.method;
            onPick({ partner, method, display: addr.querySelector('.addr-header').textContent });
        });
    });

    animateResults();
    showStatus(`Найдено адресов: ${items.length}`);
}

// Обработка выбора адреса
async function onPick(item) {
    try {
        // Создаем элемент details если его нет
        if (!$details) {
            const detailsElement = document.createElement('div');
            detailsElement.id = 'details';
            detailsElement.className = 'details';
            detailsElement.innerHTML = `
                <div class="tester"></div>
                <div class="place"></div>
                <div class="text"></div>
            `;
            $container.appendChild(detailsElement);
        }

        const text = await findText(item.partner, item.method);

        document.getElementById('details').style.display = 'block';
        document.querySelector('#details .tester').innerHTML = `Тестировщик: <strong>${htmlEscape($fio.value)}</strong>`;
        document.querySelector('#details .place').innerHTML = htmlEscape(item.display);

        // Обрабатываем переносы строк в тексте
        const processedText = text.replace(/\n/g, '<br>');
        document.querySelector('#details .text').innerHTML = processedText;

        document.getElementById('details').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });

        showStatus('Инструкции готовы');

    } catch (error) {
        showStatus('Ошибка получения текста', true);
        console.error('Ошибка получения текста:', error);
    }
}

// Основная функция поиска
async function performSearch() {
    const fio = $fio.value.trim();
    if (!fio) {
        showStatus('Введите ФИО', true);
        $fio.focus();
        return;
    }

    const originalText = showLoading($btn, 'Поиск адресов...');

    try {
        const items = await findAssignments(fio);
        renderAddresses(items);
        
        // Скрываем детали при новом поиске
        if ($details) {
            $details.style.display = 'none';
        }

    } catch (error) {
        showStatus('Ошибка поиска', true);
        console.error('Ошибка поиска:', error);
        $addresses.style.display = 'none';
        $container.classList.remove('with-result');
    } finally {
        hideLoading($btn, originalText);
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    // Автофокус на поле ФИО
    $fio.focus();
    
    // Обработчик кнопки поиска
    $btn.addEventListener('click', performSearch);
    
    // Поиск по Enter
    $fio.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    // Предзагружаем Excel файл
    try {
        await loadExcelFile();
        showStatus('Excel файл загружен успешно');
    } catch (error) {
        showStatus('Ошибка предварительной загрузки Excel', true);
    }
});
