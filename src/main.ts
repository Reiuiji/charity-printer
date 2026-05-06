/// <reference types="dom-serial" />
import Papa from 'papaparse';
import * as QRCode from 'qrcode';
import * as bwipjs from 'bwip-js';

interface CardData {
  id: string; // Unique identifier
  [key: string]: string;
}

interface PrinterTransport {
  type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
}

class SerialPrinterTransport implements PrinterTransport {
  type = 'serial';
  port: any | null = null;
  async connect() {
    this.port = await (navigator as any).serial.requestPort();
    await this.port.open({ baudRate: 9600 });
  }
  async disconnect() {
    if (this.port) await this.port.close();
  }
  async write(data: Uint8Array) {
    if (!this.port || !this.port.writable) throw new Error('Port not writable');
    const writer = this.port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }
}

class UsbPrinterTransport implements PrinterTransport {
  type = 'usb';
  device: any | null = null;
  outEndpoint: number = -1;
  async connect() {
    this.device = await (navigator as any).usb.requestDevice({ filters: [] });
    await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
    await this.device.claimInterface(0);
    const iface = this.device.configuration.interfaces[0];
    const alt = iface.alternates[0];
    for (const ep of alt.endpoints) {
      if (ep.direction === 'out' && ep.type === 'bulk') {
        this.outEndpoint = ep.endpointNumber;
      }
    }
  }
  async disconnect() {
    if (this.device) await this.device.close();
  }
  async write(data: Uint8Array) {
    if (!this.device || this.outEndpoint === -1) throw new Error('USB Device not connected');
    await this.device.transferOut(this.outEndpoint, data);
  }
}

class NetworkPrinterTransport implements PrinterTransport {
  type = 'network';
  ws: WebSocket | null = null;
  ip: string;
  constructor(ip: string) {
    this.ip = ip;
  }
  async connect() {
    return new Promise<void>((resolve, reject) => {
      let url = this.ip;
      if (!url.startsWith('ws://')) url = 'ws://' + url;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
  }
  async disconnect() {
    if (this.ws) this.ws.close();
  }
  async write(data: Uint8Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket not open');
    this.ws.send(data as any);
  }
}

// Global state
let cards: CardData[] = [];
let activeTransport: PrinterTransport | null = null;
let currentEditId: string | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let countdownSeconds = 0;
let currentFilter: 'all' | 'unprinted' | 'printed' = 'all';
let isTemplateMode = false;

// DOM Elements
const csvUrlInput = document.getElementById('csv-url') as HTMLInputElement;
const fetchDataBtn = document.getElementById('fetch-data-btn') as HTMLButtonElement;
const connectionTypeSelect = document.getElementById('connection-type') as HTMLSelectElement;
const networkIpInput = document.getElementById('network-ip') as HTMLInputElement;
const connectPrinterBtn = document.getElementById('connect-printer-btn') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement;
const testPrinterBtn = document.getElementById('test-printer-btn') as HTMLButtonElement;
const exportPrintedBtn = document.getElementById('export-printed-btn') as HTMLButtonElement;
const printerStatus = document.getElementById('printer-status') as HTMLDivElement;
const printerStatusText = document.getElementById('printer-status-text') as HTMLSpanElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const closeSettingsBtn = document.getElementById('close-settings') as HTMLSpanElement;
const cardsContainer = document.getElementById('cards-container') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const lastSyncTime = document.getElementById('last-sync-time') as HTMLSpanElement;
const autoSyncToggle = document.getElementById('auto-sync-toggle') as HTMLInputElement;
const autoPrintToggle = document.getElementById('auto-print-toggle') as HTMLInputElement;
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
  
  const savedAutoPrint = localStorage.getItem('auto-print');
  if (savedAutoPrint === 'true') {
    autoPrintToggle.checked = true;
  }

  // Initialize connection UI
  connectionTypeSelect.addEventListener('change', () => {
    if (connectionTypeSelect.value === 'network') {
      networkIpInput.classList.remove('hidden');
    } else {
      networkIpInput.classList.add('hidden');
    }
  });

  // Check support warnings, but don't disable since they might use Network
  if (!('serial' in navigator) && !('usb' in navigator)) {
    printerStatus.textContent = 'Web Serial/USB APIs not supported (HTTPS required)';
    printerStatusText.textContent = 'APIs not supported';
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
        
        if (autoPrintToggle.checked && activeTransport) {
          autoPrintNewItems();
        }
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

async function autoPrintNewItems() {
  let printedIds: Set<string> = new Set();
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = new Set(JSON.parse(saved));
  } catch(e) {}
  
  const unprintedCards = cards.filter(c => !printedIds.has(c.id));
  if (unprintedCards.length === 0) return;
  
  for (const card of unprintedCards) {
     try {
       const lines = await generatePrintLines(card);
       await sendLinesToPrinter(lines);
       
       printedIds.add(card.id);
       localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
       
       await new Promise(r => setTimeout(r, 500));
     } catch (err) {
       console.error("Auto-print failed for", card.id, err);
     }
  }
  renderCards(searchInput.value);
}

// Render Cards
function renderCards(filterText = '') {
  cardsContainer.innerHTML = '';

  let printedIds: Set<string> = new Set();
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = new Set(JSON.parse(saved));
  } catch(e) {}

  const filtered = cards.filter(c => {
    const values = Object.values(c).join(' ').toLowerCase();
    if (!values.includes(filterText.toLowerCase())) return false;
    
    if (currentFilter === 'unprinted' && printedIds.has(c.id)) return false;
    if (currentFilter === 'printed' && !printedIds.has(c.id)) return false;

    return true;
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
  const type = connectionTypeSelect.value;

  try {
    if (activeTransport) {
      await activeTransport.disconnect();
      activeTransport = null;
    }

    if (type === 'serial') {
      if (!('serial' in navigator)) throw new Error('Web Serial API not supported in this browser.');
      activeTransport = new SerialPrinterTransport();
    } else if (type === 'usb') {
      if (!('usb' in navigator)) throw new Error('Web USB API not supported in this browser.');
      activeTransport = new UsbPrinterTransport();
    } else if (type === 'network') {
      const ip = networkIpInput.value.trim();
      if (!ip) throw new Error('Please enter a valid WebSocket IP (e.g. ws://192.168.1.100:9100)');
      activeTransport = new NetworkPrinterTransport(ip);
    }

    connectPrinterBtn.textContent = 'Connecting...';
    connectPrinterBtn.disabled = true;

    await activeTransport!.connect();

    printerStatus.textContent = 'Connected (' + type.toUpperCase() + ')';
    printerStatus.className = 'status connected';
    printerStatusText.textContent = 'Connected (' + type.toUpperCase() + ')';
    printerStatusText.className = 'status connected';
    
    if (type === 'serial' && (activeTransport as SerialPrinterTransport).port) {
      (activeTransport as SerialPrinterTransport).port.addEventListener('disconnect', () => {
        printerStatus.textContent = 'Disconnected';
        printerStatus.className = 'status disconnected';
        printerStatusText.textContent = 'Disconnected';
        printerStatusText.className = 'status disconnected';
        activeTransport = null;
      });
    }

  } catch (err: any) {
    console.error(err);
    alert('Failed to connect to printer: ' + err.message);
    printerStatus.textContent = 'Disconnected';
    printerStatus.className = 'status disconnected';
    printerStatusText.textContent = 'Disconnected';
    printerStatusText.className = 'status disconnected';
    activeTransport = null;
  } finally {
    connectPrinterBtn.innerHTML = '<span class="icon">🖨️</span> Connect';
    connectPrinterBtn.disabled = false;
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
  isQr?: boolean;
  isBarcode?: boolean;
}

let printLines: PrintLine[] = [];

const printPreviewModal = document.getElementById('print-preview-modal') as HTMLDivElement;
const closePrintPreview = document.getElementById('close-print-preview') as HTMLSpanElement;
const receiptPaper = document.getElementById('receipt-paper') as HTMLDivElement;
const printLinesControls = document.getElementById('print-lines-controls') as HTMLDivElement;
const addPrintLineBtn = document.getElementById('add-print-line-btn') as HTMLButtonElement;
const addQrBtn = document.getElementById('add-qr-btn') as HTMLButtonElement;
const addBarcodeBtn = document.getElementById('add-barcode-btn') as HTMLButtonElement;
const addSeparatorBtn = document.getElementById('add-separator-btn') as HTMLButtonElement;
const printPreviewCancel = document.getElementById('print-preview-cancel') as HTMLButtonElement;
const printPreviewSend = document.getElementById('print-preview-send') as HTMLButtonElement;
const templateVariablesPanel = document.getElementById('template-variables-panel') as HTMLDivElement;
const templateVariablesList = document.getElementById('template-variables-list') as HTMLDivElement;

const importTemplateBtn = document.getElementById('import-template-btn') as HTMLButtonElement;
const exportTemplateBtn = document.getElementById('export-template-btn') as HTMLButtonElement;
const importTemplateFile = document.getElementById('import-template-file') as HTMLInputElement;

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function interpolate(templateString: string, card: any): string {
  if (!templateString) return '';
  let result = templateString;
  for (const [key, value] of Object.entries(card)) {
    const escapedKey = escapeRegExp(key);
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'gi');
    result = result.replace(regex, (value as string) || '');
  }
  return result;
}

function generateDefaultTemplateLines(card: any): PrintLine[] {
  const titleKey = Object.keys(card).find(k => 
    k.toLowerCase().includes('brief identifier') || 
    k.toLowerCase().match(/name|title|item/)
  ) || Object.keys(card)[0];
  
  const lines: PrintLine[] = [];
  lines.push({ enabled: true, text: `{{${titleKey}}}`, bold: true, align: 'center', size: 'large' });
  const donationKey = Object.keys(card).find(k => k.toLowerCase().includes('donation')) || 'id';
  lines.push({ enabled: true, text: `Donation #{{${donationKey}}}`, bold: false, align: 'center', size: 'normal' });
  lines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true });

  for (const key of Object.keys(card)) {
    if (key === 'id' || key === titleKey || key === donationKey) continue;
    const isPhotoColumn = key.toLowerCase().includes('picture') || key.toLowerCase().includes('photo') || key.toLowerCase().includes('image');
    if (isPhotoColumn) {
      lines.push({ enabled: true, text: '', bold: false, align: 'center', size: 'normal', isImage: true, imageUrl: `{{${key}}}`, gamma: 1.0 });
      continue;
    }
    lines.push({ enabled: true, text: `${shortLabel(key)}: {{${key}}}`, bold: false, align: 'left', size: 'normal' });
  }

  lines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true });
  return lines;
}

async function generatePrintLines(card: any): Promise<PrintLine[]> {
  const saved = localStorage.getItem('base-print-template');
  let baseLines: PrintLine[] = [];
  if (saved) {
    try { baseLines = JSON.parse(saved); } catch(e) {}
  }
  if (!baseLines.length) {
    baseLines = generateDefaultTemplateLines(card);
  }

  const lines: PrintLine[] = [];
  for (const tLine of baseLines) {
    const line = { ...tLine };
    if (!line.enabled) continue;
    
    line.text = interpolate(line.text, card);
    if (line.isImage && line.imageUrl && !line.isQr && !line.isBarcode) {
      line.imageUrl = interpolate(line.imageUrl, card);
      if (line.imageUrl && !line.imageUrl.startsWith('http') && !line.imageUrl.startsWith('data:')) continue; // Skip invalid
    }
    
    if (line.isQr || line.isBarcode) {
      await updateBarcodeQrImage(line, -1);
    }
    lines.push(line);
  }
  return lines;
}

async function openPrintPreview(id: string) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  currentEditId = id;
  isTemplateMode = false;
  printPreviewSend.textContent = '🖨️ Print';
  templateVariablesPanel.classList.add('hidden');
  importTemplateBtn.classList.add('hidden');
  exportTemplateBtn.classList.add('hidden');
  printLines = await generatePrintLines(card);

  renderPrintPreview();
  printPreviewModal.classList.remove('hidden');
}

function closePrintPreviewModal() {
  printPreviewModal.classList.add('hidden');
  currentEditId = null;
  isTemplateMode = false;
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
      
      let src = line.imageUrl;
      if (isTemplateMode && cards.length > 0 && !line.isQr && !line.isBarcode) {
        src = interpolate(src, cards[0]);
      }
      img.src = src;
      
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
    
    div.textContent = (isTemplateMode && cards.length > 0) ? interpolate(line.text, cards[0]) : line.text;
    receiptPaper.appendChild(div);
  });

  let dragStartIndex = -1;

  // Render controls
  printLinesControls.innerHTML = '';
  printLines.forEach((line, index) => {
    const control = document.createElement('div');
    control.className = 'print-line-control';
    control.draggable = true;
    control.style.cursor = 'grab';

    // Drag and Drop Logic
    control.addEventListener('dragstart', (e) => {
      dragStartIndex = index;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
      }
      control.style.opacity = '0.5';
    });
    control.addEventListener('dragend', () => {
      control.style.opacity = '1';
    });
    control.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      control.style.borderTop = '2px solid var(--primary-color)';
    });
    control.addEventListener('dragleave', () => {
      control.style.borderTop = '';
    });
    control.addEventListener('drop', (e) => {
      e.preventDefault();
      control.style.borderTop = '';
      if (dragStartIndex > -1 && dragStartIndex !== index) {
        const item = printLines.splice(dragStartIndex, 1)[0];
        printLines.splice(index, 0, item);
        renderPrintPreview();
      }
    });

    const topRow = document.createElement('div');
    topRow.className = 'print-line-top';

    const dragHandle = document.createElement('span');
    dragHandle.textContent = '☰';
    dragHandle.style.cursor = 'grab';
    dragHandle.style.marginRight = '8px';
    dragHandle.style.color = '#888';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = line.enabled;
    checkbox.addEventListener('change', () => {
      printLines[index].enabled = checkbox.checked;
      renderPrintPreview();
    });

    topRow.appendChild(dragHandle);
    topRow.appendChild(checkbox);

    if (line.isImage) {
      if (line.isQr || line.isBarcode) {
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = line.text || '';
        textInput.style.flex = '1';
        textInput.placeholder = line.isQr ? 'QR Code Data' : 'Barcode Data';
        
        let typingTimer: any;
        textInput.addEventListener('input', () => {
          printLines[index].text = textInput.value;
          clearTimeout(typingTimer);
          typingTimer = setTimeout(() => {
            updateBarcodeQrImage(printLines[index], index);
            savePrintTemplate();
          }, 300);
        });
        topRow.appendChild(textInput);
      } else {
        const textSpan = document.createElement('span');
        textSpan.textContent = `🖼️ Image: ${line.imageUrl?.split('/').pop() || 'Photo'}`;
        textSpan.style.flex = '1';
        textSpan.style.fontSize = '0.85rem';
        textSpan.style.color = 'var(--primary-color)';
        textSpan.style.overflow = 'hidden';
        textSpan.style.textOverflow = 'ellipsis';
        textSpan.style.whiteSpace = 'nowrap';
        topRow.appendChild(textSpan);
      }

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
      slider.addEventListener('change', () => savePrintTemplate());
      
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
        if (img) img.style.filter = `grayscale(100%) contrast(150%) brightness(1.0)`;
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
    if (!line.isImage || line.isQr || line.isBarcode) {
      control.appendChild(optionsRow);
    } else {
      control.appendChild(optionsRow); // keep layout consistent
    }
    printLinesControls.appendChild(control);
  });
}

function savePrintTemplate() {
  if (isTemplateMode) {
    localStorage.setItem('base-print-template', JSON.stringify(printLines));
  }
}

async function updateBarcodeQrImage(line: PrintLine, index: number) {
  const evalText = (isTemplateMode && cards.length > 0) ? interpolate(line.text || ' ', cards[0]) : (line.text || ' ');
  if (line.isQr) {
    try {
      line.imageUrl = await QRCode.toDataURL(evalText, { width: 250, margin: 2, scale: 4 });
    } catch {}
  } else if (line.isBarcode) {
    try {
      const canvas = document.createElement('canvas');
      bwipjs.toCanvas(canvas, { bcid: 'code128', text: evalText || '1234', scale: 3, height: 10, includetext: true, textxalign: 'center' });
      line.imageUrl = canvas.toDataURL('image/png');
    } catch {}
  }
  
  if (index >= 0) {
    const img = document.getElementById('preview-img-' + index) as HTMLImageElement;
    if (img && line.imageUrl) {
      img.src = line.imageUrl;
    }
  }
}

addPrintLineBtn.addEventListener('click', () => {
  printLines.push({ enabled: true, text: '', bold: false, align: 'left', size: 'normal' });
  renderPrintPreview();
});

addQrBtn.addEventListener('click', async () => {
  const line: PrintLine = { enabled: true, text: 'QRCODE', bold: false, align: 'center', size: 'normal', isImage: true, isQr: true, gamma: 1.0 };
  printLines.push(line);
  await updateBarcodeQrImage(line, printLines.length - 1);
  renderPrintPreview();
});

addBarcodeBtn.addEventListener('click', async () => {
  const line: PrintLine = { enabled: true, text: '12345678', bold: false, align: 'center', size: 'normal', isImage: true, isBarcode: true, gamma: 1.0 };
  printLines.push(line);
  await updateBarcodeQrImage(line, printLines.length - 1);
  renderPrintPreview();
});

addSeparatorBtn.addEventListener('click', () => {
  printLines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true });
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
async function sendLinesToPrinter(lines: PrintLine[]) {
  if (!activeTransport) throw new Error('Printer not connected! Please connect the printer first.');
  const enabledLines = lines.filter(l => l.enabled);
  if (enabledLines.length === 0) return;

  const ESC = 0x1B;
  const GS = 0x1D;
  const textEncoder = new TextEncoder();

  try {
    // Init printer
    await activeTransport.write(new Uint8Array([ESC, 0x40]));

    for (const line of enabledLines) {
      if (line.isImage && line.imageUrl) {
        const originalText = printPreviewSend.textContent;
        printPreviewSend.textContent = 'Preparing Image...';
        
        const rasterData = await convertImageToRaster(line.imageUrl, line.gamma || 1.0);
        if (rasterData) {
          const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
          await activeTransport.write(new Uint8Array([ESC, 0x61, alignByte]));
          await activeTransport.write(rasterData);
        } else {
          alert('Could not download or convert image: ' + line.imageUrl);
        }
        
        if (printPreviewSend.textContent === 'Preparing Image...') {
          printPreviewSend.textContent = originalText;
        }
      } else {
        // Alignment
        const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
        await activeTransport.write(new Uint8Array([ESC, 0x61, alignByte]));

        // Size and Font
        if (line.size === 'xl') {
          await activeTransport.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await activeTransport.write(new Uint8Array([GS, 0x21, 0x22]));  // Triple height/width
        } else if (line.size === 'large') {
          await activeTransport.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await activeTransport.write(new Uint8Array([GS, 0x21, 0x11]));  // Double height/width
        } else if (line.size === 'small') {
          await activeTransport.write(new Uint8Array([ESC, 0x4D, 0x01])); // Font B
          await activeTransport.write(new Uint8Array([GS, 0x21, 0x00]));
        } else if (line.size === 'xs') {
          await activeTransport.write(new Uint8Array([ESC, 0x4D, 0x01])); // Font B
          await activeTransport.write(new Uint8Array([GS, 0x21, 0x00]));
        } else {
          await activeTransport.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await activeTransport.write(new Uint8Array([GS, 0x21, 0x00]));
        }

        // Bold
        await activeTransport.write(new Uint8Array([ESC, 0x45, line.bold ? 0x01 : 0x00]));

        // Text
        await activeTransport.write(textEncoder.encode(line.text + '\n'));
      }
    }

    // Reset
    await activeTransport.write(new Uint8Array([GS, 0x21, 0x00]));
    await activeTransport.write(new Uint8Array([ESC, 0x45, 0x00]));

    // Feed & cut
    await activeTransport.write(new Uint8Array([0x0A, 0x0A, 0x0A, 0x0A]));
    await activeTransport.write(new Uint8Array([GS, 0x56, 0x41, 0x10]));
  } catch (err: any) {
    alert('Print error: ' + err.message);
  }
}

// Send to Printer from preview
printPreviewSend.addEventListener('click', async () => {
  if (isTemplateMode) {
    savePrintTemplate();
    closePrintPreviewModal();
    return;
  }

  try {
    await sendLinesToPrinter(printLines);
    closePrintPreviewModal();

    if (currentEditId) {
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
    if (err.message !== 'Printer not connected! Please connect the printer first.') {
      console.error('Print failed', err);
    }
    alert(err.message);
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

settingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});
closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});

document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    (e.target as HTMLElement).classList.add('active');
    currentFilter = (e.target as HTMLElement).dataset.filter as any;
    renderCards(searchInput.value);
  });
});

const editTemplateBtn = document.getElementById('edit-template-btn') as HTMLButtonElement;
editTemplateBtn.addEventListener('click', async () => {
  if (cards.length === 0) {
    alert('Fetch data first so we know the column structure!');
    return;
  }
  isTemplateMode = true;
  printPreviewSend.textContent = '💾 Save Base Template';
  
  const saved = localStorage.getItem('base-print-template');
  if (saved) {
    try { printLines = JSON.parse(saved); } catch(e) { printLines = generateDefaultTemplateLines(cards[0]); }
  } else {
    printLines = generateDefaultTemplateLines(cards[0]);
  }
  
  for (const line of printLines) {
    if (line.isQr || line.isBarcode) {
      await updateBarcodeQrImage(line, -1);
    }
  }
  
  templateVariablesPanel.classList.remove('hidden');
  importTemplateBtn.classList.remove('hidden');
  exportTemplateBtn.classList.remove('hidden');
  templateVariablesList.innerHTML = '';
  
  const sampleCard = cards[0];
  for (const [key, value] of Object.entries(sampleCard)) {
    const varTag = document.createElement('div');
    varTag.style.background = 'rgba(255,255,255,0.1)';
    varTag.style.padding = '4px 8px';
    varTag.style.borderRadius = '4px';
    varTag.style.cursor = 'pointer';
    varTag.title = 'Click to copy';
    varTag.innerHTML = `<strong style="color:var(--primary-color)">{{${key}}}</strong> = <span style="opacity:0.8">${String(value).substring(0, 15) + (String(value).length > 15 ? '...' : '')}</span>`;
    
    varTag.addEventListener('click', () => {
      navigator.clipboard.writeText(`{{${key}}}`);
      const oldBg = varTag.style.background;
      varTag.style.background = 'rgba(74, 222, 128, 0.3)';
      setTimeout(() => varTag.style.background = oldBg, 300);
    });
    
    templateVariablesList.appendChild(varTag);
  }
  
  renderPrintPreview();
  printPreviewModal.classList.remove('hidden');
});

const printAllUnprintedBtn = document.getElementById('print-all-unprinted-btn') as HTMLButtonElement;
printAllUnprintedBtn.addEventListener('click', async () => {
  if (!activeTransport) {
    alert('Printer not connected! Please connect the printer first.');
    return;
  }

  let printedIds: Set<string> = new Set();
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = new Set(JSON.parse(saved));
  } catch(e) {}
  
  const unprintedCards = cards.filter(c => !printedIds.has(c.id));
  if (unprintedCards.length === 0) {
    alert('No unprinted items found.');
    return;
  }
  
  if (!confirm(`Are you sure you want to print ${unprintedCards.length} items sequentially?`)) {
    return;
  }
  
  const originalText = printAllUnprintedBtn.textContent;
  printAllUnprintedBtn.textContent = 'Printing...';
  printAllUnprintedBtn.disabled = true;
  
  try {
    for (const card of unprintedCards) {
       const lines = await generatePrintLines(card);
       await sendLinesToPrinter(lines);
       
       printedIds.add(card.id);
       localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
       
       // Wait a tiny bit between receipts to prevent buffer overflow
       await new Promise(r => setTimeout(r, 500));
    }
  } catch (err: any) {
    alert('Bulk print error: ' + err.message);
  } finally {
    printAllUnprintedBtn.textContent = originalText;
    printAllUnprintedBtn.disabled = false;
    renderCards(searchInput.value);
  }
});

exportTemplateBtn.addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(printLines, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "receipt-template.json");
  document.body.appendChild(downloadAnchorNode); 
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
});

importTemplateBtn.addEventListener('click', () => {
  importTemplateFile.click();
});

importTemplateFile.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const contents = ev.target?.result as string;
      const importedLines = JSON.parse(contents);
      if (Array.isArray(importedLines)) {
        printLines = importedLines;
        for (const line of printLines) {
          if (line.isQr || line.isBarcode) {
            await updateBarcodeQrImage(line, -1);
          }
        }
        renderPrintPreview();
        savePrintTemplate();
        alert('Template imported successfully!');
      } else {
        throw new Error('Invalid format');
      }
    } catch (err) {
      alert('Failed to parse template file. Make sure it is a valid JSON template.');
    }
    (document.getElementById('import-template-file') as HTMLInputElement).value = '';
  };
  reader.readAsText(file);
});

autoSyncToggle.addEventListener('change', () => {
  localStorage.setItem('auto-sync', String(autoSyncToggle.checked));
  if (autoSyncToggle.checked) {
    startAutoSync();
  } else {
    stopAutoSync();
  }
});

autoPrintToggle.addEventListener('change', () => {
  localStorage.setItem('auto-print', String(autoPrintToggle.checked));
});

syncIntervalSelect.addEventListener('change', () => {
  localStorage.setItem('sync-interval', syncIntervalSelect.value);
  if (autoSyncToggle.checked) {
    startAutoSync();
  }
});

// Theme Toggle
let isLightMode = localStorage.getItem('theme') === 'light';
function applyTheme() {
  if (isLightMode) {
    document.body.classList.add('light-theme');
    themeToggleBtn.textContent = '🌙';
  } else {
    document.body.classList.remove('light-theme');
    themeToggleBtn.textContent = '☀️';
  }
}
applyTheme();

themeToggleBtn.addEventListener('click', () => {
  isLightMode = !isLightMode;
  localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
  applyTheme();
});

// Test Printer
testPrinterBtn.addEventListener('click', async () => {
  if (!activeTransport) {
    alert('Printer not connected! Please connect the printer first.');
    return;
  }
  const originalText = testPrinterBtn.textContent;
  testPrinterBtn.textContent = 'Testing...';
  testPrinterBtn.disabled = true;
  try {
    const testLines: PrintLine[] = [
      { enabled: true, text: 'PRINTER DIAGNOSTICS', bold: true, align: 'center', size: 'large' },
      { enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true },
      { enabled: true, text: `Time: ${new Date().toLocaleString()}`, bold: false, align: 'left', size: 'normal' },
      { enabled: true, text: 'Connection: Web Serial API', bold: false, align: 'left', size: 'normal' },
      { enabled: true, text: 'Status: OK', bold: false, align: 'left', size: 'normal' },
      { enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true },
      { enabled: true, text: 'MUNBYN', bold: false, align: 'center', size: 'normal', isImage: true, isBarcode: true, gamma: 1.0 },
      { enabled: true, text: 'Web Receipt Printer Ready', bold: false, align: 'center', size: 'normal' }
    ];
    await updateBarcodeQrImage(testLines[6], -1); // generate barcode
    await sendLinesToPrinter(testLines);
  } catch (err: any) {
    alert('Diagnostic print failed: ' + err.message);
  } finally {
    testPrinterBtn.textContent = originalText;
    testPrinterBtn.disabled = false;
  }
});

// Export Printed Log
exportPrintedBtn.addEventListener('click', () => {
  if (!cards || cards.length === 0) return alert('No data loaded.');
  
  let printedIds: string[] = [];
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = JSON.parse(saved);
  } catch(e) {}
  
  const headers = Object.keys(cards[0]);
  const csvHeaders = headers.join(',') + ',"Printed"\n';
  
  const rows = cards.map(c => {
    const vals = headers.map(h => {
      const v = String(c[h] || '').replace(/"/g, '""');
      return `"${v}"`;
    });
    const isPrinted = printedIds.includes(c.id) ? 'Yes' : 'No';
    return vals.join(',') + `,"${isPrinted}"`;
  }).join('\n');
  
  const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvHeaders + rows);
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", `print_log_${new Date().getTime()}.csv`);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
});

// Init
init();
