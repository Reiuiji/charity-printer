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

  let printedIds: Set<string> = new Set();
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = new Set(JSON.parse(saved));
  } catch(e) {}

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
        <button class="btn print-btn print-item-btn ${printedIds.has(card.id) ? 'printed' : ''}" data-id="${card.id}">
          ${printedIds.has(card.id) ? '✅ Printed' : '🖨️ Print'}
        </button>
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
  id?: string;
  enabled: boolean;
  text: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  size: 'xl' | 'large' | 'normal' | 'small' | 'xs';
  isSeparator?: boolean;
  isImage?: boolean;
  imageUrl?: string;
  gamma?: number;
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

  // Template logic
  let template: Record<string, any> = {};
  try {
    const saved = localStorage.getItem('print-template');
    if (saved) template = JSON.parse(saved);
  } catch(e) {}

  const applyTemplate = (id: string, defaultLine: Omit<PrintLine, 'id'>): PrintLine => {
    const t = template[id];
    if (t) {
      return {
        ...defaultLine,
        enabled: t.enabled !== undefined ? t.enabled : defaultLine.enabled,
        bold: t.bold !== undefined ? t.bold : defaultLine.bold,
        align: t.align || defaultLine.align,
        size: t.size || defaultLine.size,
        gamma: t.gamma !== undefined ? t.gamma : (defaultLine.gamma || 1.0),
        id
      };
    }
    return { ...defaultLine, id };
  };

  // Build default print lines from card data
  printLines = [];

  // Title line
  printLines.push(applyTemplate('__title__', { enabled: true, text: title, bold: true, align: 'center', size: 'large' }));

  // Donation number
  printLines.push(applyTemplate('__donation_num__', { enabled: true, text: `Donation #${donationNum}`, bold: false, align: 'center', size: 'normal' }));

  // Separator
  printLines.push(applyTemplate('__separator_top__', { enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true }));

  // Card fields
  for (const [key, value] of Object.entries(card)) {
    if (key === 'id' || key === titleKey || key === 'Donation #') continue;
    if (!value || !value.trim()) continue;

    // Skip photo URLs in print text, but add them as an image line
    const isPhotoColumn = key.toLowerCase().includes('picture') || key.toLowerCase().includes('photo') || key.toLowerCase().includes('image');
    const looksLikeImageUrl = /^https?:\/\/.+/i.test(value.trim()) && (
      /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(value) ||
      value.includes('googleusercontent') ||
      value.includes('drive.google') ||
      value.includes('imgur')
    );
    
    if (isPhotoColumn && looksLikeImageUrl) {
      printLines.push(applyTemplate(`__img_${key}__`, { enabled: true, text: '', bold: false, align: 'center', size: 'normal', isImage: true, imageUrl: value.trim(), gamma: 1.0 }));
      continue;
    }

    printLines.push(applyTemplate(`__field_${key}__`, { enabled: true, text: `${shortLabel(key)}: ${value}`, bold: false, align: 'left', size: 'normal' }));
  }

  // Footer separator
  printLines.push(applyTemplate('__separator_bottom__', { enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true }));

  renderPrintPreview();
  printPreviewModal.classList.remove('hidden');
}

function closePrintPreviewModal() {
  printPreviewModal.classList.add('hidden');
  currentEditId = null;
}

function renderPrintPreview() {
  savePrintTemplate();
  // Render receipt paper
  receiptPaper.innerHTML = '';
  printLines.forEach((line, index) => {
    if (!line.enabled) return;
    if (line.isImage && line.imageUrl) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'receipt-line';
      if (line.align === 'center') imgWrap.classList.add('align-center');
      if (line.align === 'right') imgWrap.classList.add('align-right');
      const img = document.createElement('img');
      img.id = 'preview-img-' + index;
      img.src = line.imageUrl;
      img.style.maxWidth = '100%';
      img.style.display = 'inline-block';
      img.style.filter = `grayscale(100%) contrast(150%) brightness(${line.gamma || 1.0})`; // Visual approximation of thermal print
      imgWrap.appendChild(img);
      receiptPaper.appendChild(imgWrap);
      return;
    }

    const div = document.createElement('div');
    div.className = 'receipt-line';
    if (line.align === 'center') div.classList.add('align-center');
    if (line.align === 'right') div.classList.add('align-right');
    if (line.bold) div.classList.add('bold');
    if (line.size === 'xl') div.classList.add('size-xl');
    if (line.size === 'large') div.classList.add('size-large');
    if (line.size === 'small') div.classList.add('size-small');
    if (line.size === 'xs') div.classList.add('size-xs');
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

    if (line.isImage) {
      const textSpan = document.createElement('span');
      textSpan.textContent = `🖼️ Image: ${line.imageUrl?.split('/').pop() || 'Photo'}`;
      textSpan.style.flex = '1';
      textSpan.style.fontSize = '0.85rem';
      textSpan.style.color = 'var(--primary-color)';
      textSpan.style.overflow = 'hidden';
      textSpan.style.textOverflow = 'ellipsis';
      textSpan.style.whiteSpace = 'nowrap';

      const sliderWrap = document.createElement('div');
      sliderWrap.style.display = 'flex';
      sliderWrap.style.alignItems = 'center';
      sliderWrap.style.gap = '5px';
      sliderWrap.style.marginLeft = '10px';
      
      const leftLabel = document.createElement('span');
      leftLabel.textContent = '🌘';
      leftLabel.style.fontSize = '0.8rem';
      
      const rightLabel = document.createElement('span');
      rightLabel.textContent = '☀️';
      rightLabel.style.fontSize = '0.8rem';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0.2';
      slider.max = '3.0';
      slider.step = '0.1';
      slider.value = (line.gamma || 1.0).toString();
      slider.addEventListener('input', () => {
        printLines[index].gamma = parseFloat(slider.value);
        const img = document.getElementById('preview-img-' + index);
        if (img) {
          img.style.filter = `grayscale(100%) contrast(150%) brightness(${slider.value})`;
        }
      });
      slider.addEventListener('change', () => {
        savePrintTemplate();
      });
      
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.innerHTML = '↺';
      resetBtn.style.background = 'none';
      resetBtn.style.border = 'none';
      resetBtn.style.color = 'var(--text-color)';
      resetBtn.style.cursor = 'pointer';
      resetBtn.style.padding = '0 4px';
      resetBtn.style.fontSize = '1rem';
      resetBtn.title = 'Reset to default contrast';
      resetBtn.addEventListener('click', () => {
        slider.value = '1.0';
        printLines[index].gamma = 1.0;
        const img = document.getElementById('preview-img-' + index);
        if (img) {
          img.style.filter = `grayscale(100%) contrast(150%) brightness(1.0)`;
        }
        savePrintTemplate();
      });
      
      sliderWrap.appendChild(leftLabel);
      sliderWrap.appendChild(slider);
      sliderWrap.appendChild(rightLabel);
      sliderWrap.appendChild(resetBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-line-btn';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        printLines.splice(index, 1);
        renderPrintPreview();
      });

      topRow.appendChild(checkbox);
      topRow.appendChild(textSpan);
      topRow.appendChild(sliderWrap);
      topRow.appendChild(removeBtn);
    } else {
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
    }

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

    optionsRow.appendChild(makeBtn('XL', line.size === 'xl', () => {
      printLines[index].size = 'xl';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Large', line.size === 'large', () => {
      printLines[index].size = 'large';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Normal', line.size === 'normal', () => {
      printLines[index].size = 'normal';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('Small', line.size === 'small', () => {
      printLines[index].size = 'small';
      renderPrintPreview();
    }));
    optionsRow.appendChild(makeBtn('XS', line.size === 'xs', () => {
      printLines[index].size = 'xs';
      renderPrintPreview();
    }));

    control.appendChild(topRow);
    control.appendChild(optionsRow);
    printLinesControls.appendChild(control);
  });
}

function savePrintTemplate() {
  const template: Record<string, any> = {};
  try {
    const saved = localStorage.getItem('print-template');
    if (saved) Object.assign(template, JSON.parse(saved));
  } catch(e) {}

  for (const line of printLines) {
    if (line.id) {
      template[line.id] = {
        enabled: line.enabled,
        bold: line.bold,
        align: line.align,
        size: line.size,
        gamma: line.gamma
      };
    }
  }
  localStorage.setItem('print-template', JSON.stringify(template));
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

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

async function convertImageToRaster(url: string, gamma: number = 1.0): Promise<Uint8Array | null> {
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch {
      // Fallback to proxy to bypass CORS
      img = await loadImage(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Max width 576 dots for 80mm
    const maxWidth = 576;
    let width = img.width;
    let height = img.height;

    if (width > maxWidth) {
      height = Math.round(height * (maxWidth / width));
      width = maxWidth;
    }
    
    // width must be multiple of 8
    width = Math.floor(width / 8) * 8;

    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
       const idx = i * 4;
       const a = pixels[idx + 3];
       if (a < 128) {
         gray[i] = 255; // transparent = white
       } else {
         let luminance = (pixels[idx] * 0.299 + pixels[idx+1] * 0.587 + pixels[idx+2] * 0.114);
         if (gamma !== 1.0) {
           luminance = 255 * Math.pow(luminance / 255, 1 / gamma);
         }
         gray[i] = Math.min(255, Math.max(0, luminance));
       }
    }
    
    // Floyd-Steinberg dithering
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const oldPixel = gray[i];
        const newPixel = oldPixel < 128 ? 0 : 255;
        gray[i] = newPixel;
        const err = oldPixel - newPixel;
        
        if (x + 1 < width) gray[i + 1] += err * (7/16);
        if (y + 1 < height) {
          if (x - 1 >= 0) gray[i + width - 1] += err * (3/16);
          gray[i + width] += err * (5/16);
          if (x + 1 < width) gray[i + width + 1] += err * (1/16);
        }
      }
    }

    const xL = (width / 8) % 256;
    const xH = Math.floor((width / 8) / 256);
    const yL = height % 256;
    const yH = Math.floor(height / 256);

    const data = new Uint8Array(8 + (width / 8) * height);
    data[0] = 0x1D; data[1] = 0x76; data[2] = 0x30; data[3] = 0x00;
    data[4] = xL; data[5] = xH; data[6] = yL; data[7] = yH;

    let idx = 8;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += 8) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
           if (gray[y * width + x + b] < 128) { // black
             byte |= (1 << (7 - b));
           }
        }
        data[idx++] = byte;
      }
    }
    
    return data;
  } catch (err) {
    console.error('Failed to convert image to raster', err);
    return null;
  }
}

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
      if (line.isImage && line.imageUrl) {
        const originalText = printPreviewSend.textContent;
        printPreviewSend.textContent = 'Preparing Image...';
        
        const rasterData = await convertImageToRaster(line.imageUrl, line.gamma || 1.0);
        if (rasterData) {
          const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
          await writer.write(new Uint8Array([ESC, 0x61, alignByte]));
          await writer.write(rasterData);
        } else {
          alert('Could not download or convert image: ' + line.imageUrl);
        }
        
        if (printPreviewSend.textContent === 'Preparing Image...') {
          printPreviewSend.textContent = originalText;
        }
      } else {
        // Alignment
        const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
        await writer.write(new Uint8Array([ESC, 0x61, alignByte]));

        // Size and Font
        if (line.size === 'xl') {
          await writer.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await writer.write(new Uint8Array([GS, 0x21, 0x22]));  // Triple height/width
        } else if (line.size === 'large') {
          await writer.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await writer.write(new Uint8Array([GS, 0x21, 0x11]));  // Double height/width
        } else if (line.size === 'small') {
          await writer.write(new Uint8Array([ESC, 0x4D, 0x01])); // Font B
          await writer.write(new Uint8Array([GS, 0x21, 0x00]));
        } else if (line.size === 'xs') {
          await writer.write(new Uint8Array([ESC, 0x4D, 0x01])); // Font B
          await writer.write(new Uint8Array([GS, 0x21, 0x00]));
        } else {
          await writer.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await writer.write(new Uint8Array([GS, 0x21, 0x00]));
        }

        // Bold
        await writer.write(new Uint8Array([ESC, 0x45, line.bold ? 0x01 : 0x00]));

        // Text
        await writer.write(textEncoder.encode(line.text + '\n'));
      }
    }

    // Reset
    await writer.write(new Uint8Array([GS, 0x21, 0x00]));
    await writer.write(new Uint8Array([ESC, 0x45, 0x00]));

    // Feed & cut
    await writer.write(new Uint8Array([0x0A, 0x0A, 0x0A, 0x0A]));
    await writer.write(new Uint8Array([GS, 0x56, 0x41, 0x10]));

    writer.releaseLock();

    closePrintPreviewModal();

    // UI feedback on card and persistent printed tracking
    if (currentEditId) {
      // Mark as printed persistently
      let printedIds: string[] = [];
      try {
        const saved = localStorage.getItem('printed-items');
        if (saved) printedIds = JSON.parse(saved);
      } catch(e) {}
      
      if (!printedIds.includes(currentEditId)) {
        printedIds.push(currentEditId);
        localStorage.setItem('printed-items', JSON.stringify(printedIds));
      }

      const btn = document.querySelector(`.print-item-btn[data-id="${currentEditId}"]`) as HTMLButtonElement;
      if (btn) {
        btn.textContent = '✅ Printed';
        btn.classList.add('printed');
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
