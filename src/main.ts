/// <reference types="dom-serial" />
import Papa from 'papaparse';

interface CardData {
  id: string; // Unique identifier
  [key: string]: string;
}

// Global state
let cards: CardData[] = [];
let port: SerialPort | null = null;
let currentEditId: string | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let countdownSeconds = 0;

// DOM Elements
const csvUrlInput = document.getElementById('csv-url') as HTMLInputElement;
const fetchDataBtn = document.getElementById('fetch-data-btn') as HTMLButtonElement;
const connectPrinterBtn = document.getElementById('connect-printer-btn') as HTMLButtonElement;
const printerStatus = document.getElementById('printer-status') as HTMLDivElement;
const cardsContainer = document.getElementById('cards-container') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const lastSyncTime = document.getElementById('last-sync-time') as HTMLSpanElement;
const autoSyncToggle = document.getElementById('auto-sync-toggle') as HTMLInputElement;
const syncIntervalSelect = document.getElementById('sync-interval') as HTMLSelectElement;
const countdownDisplay = document.getElementById('countdown-display') as HTMLDivElement;
const countdownValue = document.getElementById('countdown-value') as HTMLSpanElement;

const previewModal = document.getElementById('preview-modal') as HTMLDivElement;
const closePreview = document.getElementById('close-preview') as HTMLSpanElement;
const previewBody = document.getElementById('preview-body') as HTMLDivElement;
const previewEditBtn = document.getElementById('preview-edit-btn') as HTMLButtonElement;
const previewPrintBtn = document.getElementById('preview-print-btn') as HTMLButtonElement;

const editModal = document.getElementById('edit-modal') as HTMLDivElement;
const closeModal = document.getElementById('close-modal') as HTMLSpanElement;
const editForm = document.getElementById('edit-form') as HTMLFormElement;
const editFieldsContainer = document.getElementById('edit-fields-container') as HTMLDivElement;
const modalPrintBtn = document.getElementById('modal-print-btn') as HTMLButtonElement;

// Map verbose Google Sheets question headers to short labels for card display
function shortLabel(key: string): string {
  const map: Record<string, string> = {
    'Donation #': '#',
    'What is your Community Name?': 'Community',
    'What is a brief identifier for your donation?': 'Item',
    'Please Describe your donation': 'Description',
    'What would you like the starting bid for your item to be?': 'Starting Bid',
    'Please take a picture of your donation': 'Photo',
  };
  return map[key] || key;
}

// Initialization
function init() {
  const savedUrl = localStorage.getItem('csv-url');
  if (savedUrl) csvUrlInput.value = savedUrl;

  const savedCards = localStorage.getItem('cards-data');
  if (savedCards) {
    cards = JSON.parse(savedCards);
    renderCards();
  }

  const syncTime = localStorage.getItem('last-sync');
  if (syncTime) {
    lastSyncTime.textContent = new Date(syncTime).toLocaleString();
  }

  // Restore auto-sync settings
  const savedInterval = localStorage.getItem('sync-interval');
  if (savedInterval) syncIntervalSelect.value = savedInterval;

  const savedAutoSync = localStorage.getItem('auto-sync');
  if (savedAutoSync === 'true') {
    autoSyncToggle.checked = true;
    startAutoSync();
  }

  // Check if serial is supported
  if (!('serial' in navigator)) {
    printerStatus.textContent = 'Web Serial API not supported';
    printerStatus.className = 'status disconnected';
    connectPrinterBtn.disabled = true;
  }
}

// Fetch Data from Google Sheets CSV
async function fetchData() {
  const url = csvUrlInput.value.trim();
  if (!url) return alert('Please enter a valid CSV URL');

  localStorage.setItem('csv-url', url);
  fetchDataBtn.textContent = 'Fetching...';
  fetchDataBtn.disabled = true;

  try {
    const response = await fetch(url);
    const csvText = await response.text();

    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data as Record<string, string>[];
        
        // Filter out rows that are entirely empty except for the ID field
        const validCards = parsed.filter(item => {
          return Object.entries(item).some(([key, val]) => {
            if (key === 'Donation #' || key.toLowerCase() === 'id') return false;
            return val && val.trim() !== '';
          });
        });

        cards = validCards.map((item, index) => {
          const existingId = item['Donation #'] || item['id'] || item['ID'] || `item-${Date.now()}-${index}`;
          return { ...item, id: existingId };
        });

        saveCards();
        renderCards();
        
        const now = new Date().toISOString();
        localStorage.setItem('last-sync', now);
        lastSyncTime.textContent = new Date(now).toLocaleString();
      },
      error: (err: any) => {
        alert('Error parsing CSV: ' + err.message);
      }
    });
  } catch (err: any) {
    alert('Error fetching data: ' + err.message);
  } finally {
    fetchDataBtn.textContent = 'Fetch Data';
    fetchDataBtn.disabled = false;
  }
}

function saveCards() {
  localStorage.setItem('cards-data', JSON.stringify(cards));
}

// Render Cards
function renderCards(filterText = '') {
  cardsContainer.innerHTML = '';

  const filtered = cards.filter(c => {
    const values = Object.values(c).join(' ').toLowerCase();
    return values.includes(filterText.toLowerCase());
  });

  if (filtered.length === 0) {
    cardsContainer.innerHTML = `
      <div class="empty-state">
        <p>No items found.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.id = card.id;

    // Try to find a title field
    const titleKey = Object.keys(card).find(k => 
      k.toLowerCase().includes('brief identifier') || 
      k.toLowerCase().match(/name|title|item/)
    ) || Object.keys(card)[0];
    const title = card[titleKey] || 'Untitled Item';

    // Find the donation number
    const donationNum = card['Donation #'] || card.id;

    // Show a compact preview of a few key fields
    let fieldsHtml = '';
    let fieldCount = 0;
    for (const [key, value] of Object.entries(card)) {
      if (key === 'id' || key === titleKey || key === 'Donation #') continue;
      if (!value || !value.trim()) continue;
      if (fieldCount >= 3) { fieldsHtml += `<div class="row-field more">…more</div>`; break; }
      fieldsHtml += `
        <div class="row-field">
          <strong>${shortLabel(key)}</strong>
          <span>${value.length > 60 ? value.slice(0, 60) + '…' : value}</span>
        </div>
      `;
      fieldCount++;
    }

    cardEl.innerHTML = `
      <div class="card-header">
        <span class="card-badge">#${donationNum}</span>
        <div class="card-title">${title}</div>
      </div>
      <div class="card-content">
        ${fieldsHtml}
      </div>
      <div class="card-actions">
        <button class="btn secondary-btn edit-btn" data-id="${card.id}">✏️ Edit</button>
        <button class="btn print-btn print-item-btn" data-id="${card.id}">🖨️ Print</button>
      </div>
    `;

    cardsContainer.appendChild(cardEl);
  });

  // Click card body to open preview
  document.querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Don't open preview if they clicked an action button
      if (target.closest('.card-actions')) return;
      const id = (cardEl as HTMLElement).dataset.id;
      if (id) openPreviewModal(id);
    });
  });

  // Attach action button listeners
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (e.currentTarget as HTMLButtonElement).dataset.id;
      if (id) openEditModal(id);
    });
  });

  document.querySelectorAll('.print-item-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (e.currentTarget as HTMLButtonElement).dataset.id;
      if (id) openPrintPreview(id);
    });
  });
}

// Preview Modal
function openPreviewModal(id: string) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  currentEditId = id;

  const titleKey = Object.keys(card).find(k => 
    k.toLowerCase().includes('brief identifier') || 
    k.toLowerCase().match(/name|title|item/)
  ) || Object.keys(card)[0];
  const title = card[titleKey] || 'Untitled Item';
  const donationNum = card['Donation #'] || card.id;

  let fieldsHtml = '';
  for (const [key, value] of Object.entries(card)) {
    if (key === 'id' || key === titleKey || key === 'Donation #') continue;
    if (!value || !value.trim()) continue;

    // Check if it's an image URL
    const isPhotoColumn = key.toLowerCase().includes('picture') || key.toLowerCase().includes('photo') || key.toLowerCase().includes('image');
    const looksLikeImageUrl = /^https?:\/\/.+/i.test(value.trim()) && (
      /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(value) ||
      value.includes('googleusercontent') ||
      value.includes('drive.google') ||
      value.includes('imgur')
    );
    const isImage = isPhotoColumn && looksLikeImageUrl;
    const valueHtml = isImage
      ? `<img src="${value.trim()}" alt="${shortLabel(key)}" class="preview-image" />`
      : `<span>${value}</span>`;

    fieldsHtml += `
      <div class="preview-field">
        <label>${shortLabel(key)}</label>
        ${valueHtml}
      </div>
    `;
  }

  previewBody.innerHTML = `
    <div class="preview-header">
      <span class="preview-badge">#${donationNum}</span>
      <h2>${title}</h2>
    </div>
    <div class="preview-fields">
      ${fieldsHtml}
    </div>
  `;

  previewModal.classList.remove('hidden');
}

function closePreviewModal() {
  previewModal.classList.add('hidden');
  currentEditId = null;
}

closePreview.addEventListener('click', closePreviewModal);
previewModal.addEventListener('click', (e) => {
  if (e.target === previewModal) closePreviewModal();
});

previewEditBtn.addEventListener('click', () => {
  if (currentEditId) {
    const id = currentEditId;
    closePreviewModal();
    openEditModal(id);
  }
});

previewPrintBtn.addEventListener('click', () => {
  if (currentEditId) {
    openPrintPreview(currentEditId);
  }
});

// Edit Modal
function openEditModal(id: string) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  currentEditId = id;
  editFieldsContainer.innerHTML = '';

  for (const [key, value] of Object.entries(card)) {
    if (key === 'id') continue;
    
    const group = document.createElement('div');
    group.className = 'input-group';
    
    const label = document.createElement('label');
    label.textContent = key;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.name = key;
    input.value = value;
    
    group.appendChild(label);
    group.appendChild(input);
    editFieldsContainer.appendChild(group);
  }

  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  currentEditId = null;
}

editForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentEditId) return;

  const cardIndex = cards.findIndex(c => c.id === currentEditId);
  if (cardIndex === -1) return;

  const formData = new FormData(editForm);
  const updatedCard = { id: currentEditId } as CardData;

  formData.forEach((value, key) => {
    updatedCard[key] = value.toString();
  });

  cards[cardIndex] = updatedCard;
  saveCards();
  renderCards(searchInput.value);
  closeEditModal();
});

modalPrintBtn.addEventListener('click', () => {
  if (currentEditId) {
    // Save current form state before printing
    const formData = new FormData(editForm);
    const tempCard = { id: currentEditId } as CardData;
    formData.forEach((value, key) => {
      tempCard[key] = value.toString();
    });
    
    const cardIndex = cards.findIndex(c => c.id === currentEditId);
    if (cardIndex !== -1) {
      cards[cardIndex] = tempCard;
      saveCards();
      renderCards(searchInput.value);
    }
    
    openPrintPreview(currentEditId);
    closeEditModal();
  }
});

closeModal.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditModal();
});

// Printer Logic
async function connectPrinter() {
  if (!('serial' in navigator)) {
    alert('Web Serial API not supported in this browser. Please use Chrome/Edge.');
    return;
  }

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 }); // Receipt printers usually default to 9600 or 115200

    printerStatus.textContent = 'Connected';
    printerStatus.className = 'status connected';
    
    port.addEventListener('disconnect', () => {
      printerStatus.textContent = 'Disconnected';
      printerStatus.className = 'status disconnected';
      port = null;
    });

  } catch (err: any) {
    console.error(err);
    alert('Failed to connect to printer: ' + err.message);
  }
}

// Print Preview System
interface PrintLine {
  enabled: boolean;
  text: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  size: 'normal' | 'large' | 'small';
  isSeparator?: boolean;
}

let printLines: PrintLine[] = [];

const printPreviewModal = document.getElementById('print-preview-modal') as HTMLDivElement;
const closePrintPreview = document.getElementById('close-print-preview') as HTMLSpanElement;
const receiptPaper = document.getElementById('receipt-paper') as HTMLDivElement;
const printLinesControls = document.getElementById('print-lines-controls') as HTMLDivElement;
const addPrintLineBtn = document.getElementById('add-print-line-btn') as HTMLButtonElement;
const printPreviewCancel = document.getElementById('print-preview-cancel') as HTMLButtonElement;
const printPreviewSend = document.getElementById('print-preview-send') as HTMLButtonElement;

function openPrintPreview(id: string) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  currentEditId = id;

  const titleKey = Object.keys(card).find(k => 
    k.toLowerCase().includes('brief identifier') || 
    k.toLowerCase().match(/name|title|item/)
  ) || Object.keys(card)[0];
  const title = card[titleKey] || 'Receipt';
  const donationNum = card['Donation #'] || card.id;

  // Build default print lines from card data
  printLines = [];

  // Title line (large, bold, centered)
  printLines.push({ enabled: true, text: title, bold: true, align: 'center', size: 'large' });

  // Donation number
  printLines.push({ enabled: true, text: `Donation #${donationNum}`, bold: false, align: 'center', size: 'normal' });

  // Separator
  printLines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true });

  // Card fields
  for (const [key, value] of Object.entries(card)) {
    if (key === 'id' || key === titleKey || key === 'Donation #') continue;
    if (!value || !value.trim()) continue;

    // Skip photo URLs in print
    const isPhotoColumn = key.toLowerCase().includes('picture') || key.toLowerCase().includes('photo') || key.toLowerCase().includes('image');
    const isUrl = /^https?:\/\//i.test(value.trim());
    if (isPhotoColumn && isUrl) continue;

    printLines.push({ enabled: true, text: `${shortLabel(key)}: ${value}`, bold: false, align: 'left', size: 'normal' });
  }

  // Footer separator
  printLines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true });

  renderPrintPreview();
  printPreviewModal.classList.remove('hidden');
}

function closePrintPreviewModal() {
  printPreviewModal.classList.add('hidden');
  currentEditId = null;
}

function renderPrintPreview() {
  // Render receipt paper
  receiptPaper.innerHTML = '';
  printLines.forEach(line => {
    if (!line.enabled) return;
    const div = document.createElement('div');
    div.className = 'receipt-line';
    if (line.align === 'center') div.classList.add('align-center');
    if (line.align === 'right') div.classList.add('align-right');
    if (line.bold) div.classList.add('bold');
    if (line.size === 'large') div.classList.add('size-large');
    if (line.size === 'small') div.classList.add('size-small');
    if (line.isSeparator) div.classList.add('separator');
    div.textContent = line.text;
    receiptPaper.appendChild(div);
  });

  // Render controls
  printLinesControls.innerHTML = '';
  printLines.forEach((line, index) => {
    const control = document.createElement('div');
    control.className = 'print-line-control';

    const topRow = document.createElement('div');
    topRow.className = 'print-line-top';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = line.enabled;
    checkbox.addEventListener('change', () => {
      printLines[index].enabled = checkbox.checked;
      renderPrintPreview();
    });

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = line.text;
    textInput.addEventListener('input', () => {
      printLines[index].text = textInput.value;
      renderPrintPreview();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-line-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      printLines.splice(index, 1);
      renderPrintPreview();
    });

    topRow.appendChild(checkbox);
    topRow.appendChild(textInput);
    topRow.appendChild(removeBtn);

    // Options row
    const optionsRow = document.createElement('div');
    optionsRow.className = 'print-line-options';

    const makeBtn = (label: string, isActive: boolean, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.type = 'button';
      if (isActive) btn.classList.add('active');
      btn.addEventListener('click', onClick);
      return btn;
    };

    optionsRow.appendChild(makeBtn('Bold', line.bold, () => {
      printLines[index].bold = !printLines[index].bold;
      renderPrintPreview();
    }));

    optionsRow.appendChild(makeBtn('Left', line.align === 'left', () => {
      printLines[index].align = 'left';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Center', line.align === 'center', () => {
      printLines[index].align = 'center';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Right', line.align === 'right', () => {
      printLines[index].align = 'right';
      renderPrintPreview();
    }));

    optionsRow.appendChild(makeBtn('Normal', line.size === 'normal', () => {
      printLines[index].size = 'normal';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Large', line.size === 'large', () => {
      printLines[index].size = 'large';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Small', line.size === 'small', () => {
      printLines[index].size = 'small';
      renderPrintPreview();
    }));

    control.appendChild(topRow);
    control.appendChild(optionsRow);
    printLinesControls.appendChild(control);
  });
}

addPrintLineBtn.addEventListener('click', () => {
  printLines.push({ enabled: true, text: '', bold: false, align: 'left', size: 'normal' });
  renderPrintPreview();
});

closePrintPreview.addEventListener('click', closePrintPreviewModal);
printPreviewCancel.addEventListener('click', closePrintPreviewModal);
printPreviewModal.addEventListener('click', (e) => {
  if (e.target === printPreviewModal) closePrintPreviewModal();
});

// Send to Printer from preview
printPreviewSend.addEventListener('click', async () => {
  if (!port || !port.writable) {
    alert('Printer not connected! Please connect the printer first.');
    return;
  }

  const enabledLines = printLines.filter(l => l.enabled);
  if (enabledLines.length === 0) return;

  try {
    const writer = port.writable.getWriter();
    const ESC = 0x1B;
    const GS = 0x1D;
    const textEncoder = new TextEncoder();

    // Init printer
    await writer.write(new Uint8Array([ESC, 0x40]));

    for (const line of enabledLines) {
      // Alignment
      const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
      await writer.write(new Uint8Array([ESC, 0x61, alignByte]));

      // Size
      if (line.size === 'large') {
        await writer.write(new Uint8Array([GS, 0x21, 0x11]));
      } else if (line.size === 'small') {
        await writer.write(new Uint8Array([GS, 0x21, 0x00])); // same as normal for most printers
      } else {
        await writer.write(new Uint8Array([GS, 0x21, 0x00]));
      }

      // Bold
      await writer.write(new Uint8Array([ESC, 0x45, line.bold ? 0x01 : 0x00]));

      // Text
      await writer.write(textEncoder.encode(line.text + '\n'));
    }

    // Reset
    await writer.write(new Uint8Array([GS, 0x21, 0x00]));
    await writer.write(new Uint8Array([ESC, 0x45, 0x00]));

    // Feed & cut
    await writer.write(new Uint8Array([0x0A, 0x0A, 0x0A, 0x0A]));
    await writer.write(new Uint8Array([GS, 0x56, 0x41, 0x10]));

    writer.releaseLock();

    closePrintPreviewModal();

    // UI feedback on card
    if (currentEditId) {
      const btn = document.querySelector(`.print-item-btn[data-id="${currentEditId}"]`) as HTMLButtonElement;
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✅ Printed!';
        setTimeout(() => btn.textContent = originalText, 2000);
      }
    }
  } catch (err: any) {
    console.error('Print failed', err);
    alert('Print failed: ' + err.message);
  }
});

// Auto-Sync Logic
function startAutoSync() {
  stopAutoSync();
  const minutes = parseInt(syncIntervalSelect.value, 10);
  countdownSeconds = minutes * 60;

  countdownDisplay.classList.remove('hidden');
  updateCountdownDisplay();

  countdownTimer = setInterval(() => {
    countdownSeconds--;
    updateCountdownDisplay();
    if (countdownSeconds <= 0) {
      countdownSeconds = minutes * 60;
    }
  }, 1000);

  autoSyncTimer = setInterval(() => {
    fetchData();
  }, minutes * 60 * 1000);
}

function stopAutoSync() {
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countdownDisplay.classList.add('hidden');
}

function updateCountdownDisplay() {
  const m = Math.floor(countdownSeconds / 60);
  const s = countdownSeconds % 60;
  countdownValue.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

// Event Listeners
fetchDataBtn.addEventListener('click', fetchData);
connectPrinterBtn.addEventListener('click', connectPrinter);
searchInput.addEventListener('input', (e) => renderCards((e.target as HTMLInputElement).value));

autoSyncToggle.addEventListener('change', () => {
  localStorage.setItem('auto-sync', String(autoSyncToggle.checked));
  if (autoSyncToggle.checked) {
    startAutoSync();
  } else {
    stopAutoSync();
  }
});

syncIntervalSelect.addEventListener('change', () => {
  localStorage.setItem('sync-interval', syncIntervalSelect.value);
  if (autoSyncToggle.checked) {
    startAutoSync();
  }
});

// Init
init();
