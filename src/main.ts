/// <reference types="dom-serial" />
import Papa from 'papaparse';
import * as QRCode from 'qrcode';
import * as bwipjs from 'bwip-js';

import type { CardData, PrintLine, TemplateProfile, PrintHistoryLog, TemplateAssignments, SchemaProfile } from './types';
import { generateDefaultTemplateLines, generatePrintLines, interpolate, normalizeImageUrl } from './template';
import { sendLinesToPrinter as _sendLinesToPrinter } from './printer';
import type { PrinterTransport } from './transport';
import { 
  SerialPrinterTransport, 
  UsbPrinterTransport, 
  NetworkPrinterTransport,
  BrowserPrinterTransport
} from './transport';

// Global state
let cards: CardData[] = [];
let pendingNewCard: CardData | null = null;
let activeTransport: PrinterTransport | null = null;
let currentEditId: string | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let countdownSeconds = 0;
let currentFilter: 'all' | 'unprinted' | 'printed' = 'all';
let isTemplateMode = false;
let lastClickedCard: CardData | null = null;
let selectedPreviewFields: string[] = JSON.parse(localStorage.getItem('card-preview-fields') || '[]');
let isSelectMode = false;
let selectedItemIds: Set<string> = new Set();

// Schema Mapping
let activeSchemaId = localStorage.getItem('activeSchemaId') || 'Charity';
let schemaProfiles: Record<string, SchemaProfile> = JSON.parse(localStorage.getItem('schemaProfiles') || 'null');
if (!schemaProfiles) {
  schemaProfiles = {
    'Charity': {
      id: 'Charity',
      name: 'Charity',
      variables: ["Item Name", "Item ID", "Donor", "Price", "Image", "Description", "Number"],
      mapping: {
        "Item Name": "What is a brief identifier for your donation?",
        "Item ID": "id",
        "Donor": "What is your Community Name?",
        "Price": "What would you like the starting bid for your item to be?",
        "Image": "Please take a picture of your donation",
        "Description": "Please Describe your donation",
        "Number": "Donation #"
      }
    }
  };
}
let templateAssignments: TemplateAssignments = JSON.parse(localStorage.getItem('templateAssignments') || '{}');

// Template Profiles
let activeTemplateId = 'charity_receipt';
let templateProfiles: Record<string, TemplateProfile> = {
  'charity_receipt': { id: 'charity_receipt', name: 'Charity Receipt', lines: [] }
};

// History
let printHistory: PrintHistoryLog[] = [];

// DOM Elements
const csvUrlInput = document.getElementById('csv-url') as HTMLInputElement;
const fetchDataBtn = document.getElementById('fetch-data-btn') as HTMLButtonElement;
const shareLinkBtn = document.getElementById('share-link-btn') as HTMLButtonElement;
const connectionTypeSelect = document.getElementById('connection-type') as HTMLSelectElement;
const connectionDescription = document.getElementById('connection-description') as HTMLDivElement;
const networkIpInput = document.getElementById('network-ip') as HTMLInputElement;
const connectPrinterBtn = document.getElementById('connect-printer-btn') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement;
const testPrinterBtn = document.getElementById('test-printer-btn') as HTMLButtonElement;
const exportPrintedBtn = document.getElementById('export-printed-btn') as HTMLButtonElement;
const exportAppBackupBtn = document.getElementById('export-app-backup-btn') as HTMLButtonElement;
const importAppBackupBtn = document.getElementById('import-app-backup-btn') as HTMLButtonElement;
const resetAppBtn = document.getElementById('reset-app-btn') as HTMLButtonElement;
const appBackupFileInput = document.getElementById('app-backup-file-input') as HTMLInputElement;
const printerStatus = document.getElementById('printer-status') as HTMLDivElement;
const printerStatusText = document.getElementById('printer-status-text') as HTMLSpanElement;
const feedLinesInput = document.getElementById('feed-lines-input') as HTMLInputElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const closeSettingsBtn = document.getElementById('close-settings') as HTMLSpanElement;
const browserPrintSettings = document.getElementById('browser-print-settings') as HTMLDivElement;
const browserPaperSize = document.getElementById('browser-paper-size') as HTMLSelectElement;
const browserPrintScale = document.getElementById('browser-print-scale') as HTMLSelectElement;
const browserImageWidth = document.getElementById('browser-image-width') as HTMLSelectElement;
const cardPreviewFieldsContainer = document.getElementById('card-preview-fields-container') as HTMLDivElement;

// Advanced Features
const liveEditToggle = document.getElementById('live-edit-toggle') as HTMLInputElement;
const readOnlyToggle = document.getElementById('read-only-toggle') as HTMLInputElement;
const fullWidthToggle = document.getElementById('full-width-toggle') as HTMLInputElement;
const gridColumnsSelect = document.getElementById('grid-columns-select') as HTMLSelectElement;
const appElement = document.getElementById('app') as HTMLDivElement;
const customIdSettings = document.getElementById('custom-id-settings') as HTMLDivElement;
const customIdPrefix = document.getElementById('custom-id-prefix') as HTMLInputElement;
const customIdNext = document.getElementById('custom-id-next') as HTMLInputElement;
const createCustomReceiptBtn = document.getElementById('create-custom-receipt-btn') as HTMLButtonElement;
const mainAutoSyncStatus = document.getElementById('main-auto-sync-status') as HTMLDivElement;
const selectModeBtn = document.getElementById('select-mode-btn') as HTMLButtonElement;
const batchActionsBar = document.getElementById('batch-actions-bar') as HTMLDivElement;
const selectedCount = document.getElementById('selected-count') as HTMLSpanElement;
const batchSelectAllBtn = document.getElementById('batch-select-all-btn') as HTMLButtonElement;
const batchClearBtn = document.getElementById('batch-clear-btn') as HTMLButtonElement;
const batchMarkPrintedBtn = document.getElementById('batch-mark-printed-btn') as HTMLButtonElement;
const batchMarkUnprintedBtn = document.getElementById('batch-mark-unprinted-btn') as HTMLButtonElement;
const batchPrintBtn = document.getElementById('batch-print-btn') as HTMLButtonElement;
const mainAutoPrintStatus = document.getElementById('main-auto-print-status') as HTMLDivElement;
const cardsContainer = document.getElementById('cards-container') as HTMLDivElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const lastSyncTime = document.getElementById('last-sync-time') as HTMLSpanElement;
const autoSyncToggle = document.getElementById('auto-sync-toggle') as HTMLInputElement;
const autoPrintToggle = document.getElementById('auto-print-toggle') as HTMLInputElement;
const syncIntervalSelect = document.getElementById('sync-interval') as HTMLSelectElement;
const countdownDisplay = document.getElementById('countdown-display') as HTMLDivElement;
const countdownValue = document.getElementById('countdown-value') as HTMLSpanElement;

// Schema Mapper
const schemaProfileSelect = document.getElementById('schema-profile-select') as HTMLSelectElement;
const newSchemaBtn = document.getElementById('new-schema-btn') as HTMLButtonElement;
const deleteSchemaBtn = document.getElementById('delete-schema-btn') as HTMLButtonElement;
const schemaMapperContainer = document.getElementById('schema-mapper-container') as HTMLDivElement;
const addSchemaVarBtn = document.getElementById('add-schema-var-btn') as HTMLButtonElement;

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
const modalDeleteBtn = document.getElementById('modal-delete-btn') as HTMLButtonElement;

// Template Profile and History DOM
const templateProfileSelect = document.getElementById('template-profile-select') as HTMLSelectElement;
const newTemplateBtn = document.getElementById('new-template-btn') as HTMLButtonElement;
const deleteTemplateBtn = document.getElementById('delete-template-btn') as HTMLButtonElement;
const viewHistoryBtn = document.getElementById('view-history-btn') as HTMLButtonElement;
const historyModal = document.getElementById('history-modal') as HTMLDivElement;
const closeHistoryModal = document.getElementById('close-history-modal') as HTMLSpanElement;
const historyList = document.getElementById('history-list') as HTMLDivElement;
const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement;

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

function checkIsImageField(key: string, value: string): boolean {
  if (!value || !value.trim()) return false;
  const currentProfile = schemaProfiles[activeSchemaId];
  const imageMappedColumn = currentProfile ? currentProfile.mapping["Image"] : null;
  const isPhotoColumn = key.toLowerCase().includes('picture') || 
                        key.toLowerCase().includes('photo') || 
                        key.toLowerCase().includes('image') ||
                        (imageMappedColumn && key === imageMappedColumn);
                        
  const looksLikeImageUrl = /^https?:\/\/.+/i.test(value.trim()) && (
    /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(value) ||
    value.includes('googleusercontent') ||
    value.includes('drive.google') ||
    value.includes('docs.google.com') ||
    value.includes('imgur')
  );
  
  return !!(isPhotoColumn && looksLikeImageUrl);
}

// Update Header Statuses
function updateMainStatuses() {
  if (autoSyncToggle.checked) {
    mainAutoSyncStatus.textContent = 'Auto-Sync: On';
    mainAutoSyncStatus.style.background = 'rgba(74, 222, 128, 0.2)';
    mainAutoSyncStatus.style.color = '#4ade80';
    mainAutoSyncStatus.style.borderColor = 'rgba(74, 222, 128, 0.4)';
  } else {
    mainAutoSyncStatus.textContent = 'Auto-Sync: Off';
    mainAutoSyncStatus.style.background = 'var(--glass-bg)';
    mainAutoSyncStatus.style.color = 'var(--text-muted)';
    mainAutoSyncStatus.style.borderColor = 'var(--glass-border)';
  }

  if (autoPrintToggle.checked) {
    mainAutoPrintStatus.textContent = 'Auto-Print: On';
    mainAutoPrintStatus.style.background = 'rgba(99, 102, 241, 0.2)';
    mainAutoPrintStatus.style.color = '#818cf8';
    mainAutoPrintStatus.style.borderColor = 'rgba(99, 102, 241, 0.4)';
  } else {
    mainAutoPrintStatus.textContent = 'Auto-Print: Off';
    mainAutoPrintStatus.style.background = 'var(--glass-bg)';
    mainAutoPrintStatus.style.color = 'var(--text-muted)';
    mainAutoPrintStatus.style.borderColor = 'var(--glass-border)';
  }
}

function applyBrowserPrintSettings() {
  const paperSize = localStorage.getItem('browser-paper-size') || '80mm';
  const scale = localStorage.getItem('browser-print-scale') || '100%';
  const imgWidth = localStorage.getItem('browser-image-width') || '80%';
  
  const width = paperSize === '58mm' ? '200px' : '280px';
  const baseFontSize = 13 * (parseFloat(scale) / 100);
  
  const root = document.documentElement;
  root.style.setProperty('--paper-width', width);
  root.style.setProperty('--paper-font-size', baseFontSize + 'px');
  root.style.setProperty('--print-image-width', imgWidth);
}

function applyGridColumns() {
  const cols = localStorage.getItem('grid-columns') || 'auto';
  if (gridColumnsSelect) {
    gridColumnsSelect.value = cols;
  }
  
  const isFullWidth = localStorage.getItem('full-width') === 'true';
  if (gridColumnsSelect) {
    gridColumnsSelect.disabled = !isFullWidth;
  }

  const cardsContainer = document.getElementById('cards-container');
  if (!cardsContainer) return;

  if (isFullWidth && cols !== 'auto') {
    cardsContainer.style.setProperty('--grid-columns', `repeat(${cols}, 1fr)`);
  } else {
    cardsContainer.style.removeProperty('--grid-columns');
  }
}

// Initialization
function init() {
  // Inject build-time version info into the footer
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `V${__APP_VERSION__} (${__COMMIT_HASH__})`;

  const urlParams = new URLSearchParams(window.location.search);
  const sheetParam = urlParams.get('sheet');
  const autoSyncParam = urlParams.get('autoSync');
  const syncIntervalParam = urlParams.get('syncInterval');
  const readOnlyParam = urlParams.get('readOnly');
  
  if (autoSyncParam) localStorage.setItem('auto-sync', autoSyncParam);
  if (syncIntervalParam) localStorage.setItem('sync-interval', syncIntervalParam);
  if (readOnlyParam) localStorage.setItem('read-only', readOnlyParam);
  
  if (sheetParam) {
    csvUrlInput.value = sheetParam;
    localStorage.setItem('csv-url', sheetParam);
    // Clean up URL so it's not permanently stuck there
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.pushState({path:newUrl}, '', newUrl);
    
    // Automatically trigger fetch for convenience
    setTimeout(() => {
      fetchData();
    }, 500);
  } else {
    const savedUrl = localStorage.getItem('csv-url');
    if (savedUrl) csvUrlInput.value = savedUrl;
  }

  const savedCards = localStorage.getItem('cards-data');
  if (savedCards) {
    cards = JSON.parse(savedCards);
    initializeDefaultPreviewFields();
    renderCards();
  }
  
  renderSchemaMapper();
  renderCardPreviewFieldsSettings();
  initDragAndDrop();

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

  const savedLiveEdit = localStorage.getItem('live-edit');
  if (savedLiveEdit === 'true') {
    liveEditToggle.checked = true;
    createCustomReceiptBtn.classList.remove('hidden');
    customIdSettings.classList.remove('hidden');
  }

  const savedIdPrefix = localStorage.getItem('custom-id-prefix');
  if (savedIdPrefix !== null) customIdPrefix.value = savedIdPrefix;

  const savedIdNext = localStorage.getItem('custom-id-next');
  if (savedIdNext !== null) customIdNext.value = savedIdNext;

  const savedReadOnly = localStorage.getItem('read-only');
  if (savedReadOnly === 'true') {
    readOnlyToggle.checked = true;
    document.body.classList.add('read-only-mode');
  }

  const savedFullWidth = localStorage.getItem('full-width');
  if (savedFullWidth === 'true') {
    if (fullWidthToggle) fullWidthToggle.checked = true;
    if (appElement) appElement.classList.add('full-width');
  }

  // Load and apply browser print settings
  const savedPaperSize = localStorage.getItem('browser-paper-size') || '80mm';
  browserPaperSize.value = savedPaperSize;
  const savedPrintScale = localStorage.getItem('browser-print-scale') || '100%';
  browserPrintScale.value = savedPrintScale;
  const savedImageWidth = localStorage.getItem('browser-image-width') || '80%';
  browserImageWidth.value = savedImageWidth;
  applyBrowserPrintSettings();
  applyGridColumns();

  browserPaperSize.addEventListener('change', () => {
    localStorage.setItem('browser-paper-size', browserPaperSize.value);
    applyBrowserPrintSettings();
  });
  browserPrintScale.addEventListener('change', () => {
    localStorage.setItem('browser-print-scale', browserPrintScale.value);
    applyBrowserPrintSettings();
  });
  browserImageWidth.addEventListener('change', () => {
    localStorage.setItem('browser-image-width', browserImageWidth.value);
    applyBrowserPrintSettings();
  });
  gridColumnsSelect.addEventListener('change', () => {
    localStorage.setItem('grid-columns', gridColumnsSelect.value);
    applyGridColumns();
  });

  // Load Profiles and History
  const savedProfiles = localStorage.getItem('template-profiles');
  if (savedProfiles) {
    try { templateProfiles = JSON.parse(savedProfiles); } catch(e) {}
  } else {
    const oldBase = localStorage.getItem('base-print-template');
    if (oldBase) {
      try { templateProfiles['charity_receipt'].lines = JSON.parse(oldBase); } catch(e) {}
    }
  }
  
  const savedActive = localStorage.getItem('active-template-id');
  if (savedActive && templateProfiles[savedActive]) {
    activeTemplateId = savedActive;
  }
  
  const savedHistory = localStorage.getItem('print-history');
  if (savedHistory) {
    try { printHistory = JSON.parse(savedHistory); } catch(e) {}
  }

  renderTemplateProfiles();


  // Initialize connection UI
  function updateConnectionUI() {
    const val = connectionTypeSelect.value;
    if (val === 'network') {
      networkIpInput.classList.remove('hidden');
      connectionDescription.textContent = 'Connect via local Wi-Fi or LAN. Enter the raw WebSocket IP and Port of your thermal printer.';
      browserPrintSettings.classList.add('hidden');
    } else {
      networkIpInput.classList.add('hidden');
      if (val === 'serial') {
        connectionDescription.textContent = 'Connect to a virtual COM port. Supported in Chrome and Edge.';
        browserPrintSettings.classList.add('hidden');
      } else if (val === 'usb') {
        connectionDescription.textContent = 'Connect directly to raw USB bulk endpoints. Bypasses the need for OS-level serial drivers.';
        browserPrintSettings.classList.add('hidden');
      } else if (val === 'browser') {
        connectionDescription.textContent = 'Print using standard Chrome print dialog. Works on any OS without drivers or permissions.';
        browserPrintSettings.classList.remove('hidden');
      }
    }
  }

  connectionTypeSelect.addEventListener('change', updateConnectionUI);
  updateConnectionUI();

  // Check support warnings, but don't disable since they might use Network
  if (!('serial' in navigator) && !('usb' in navigator)) {
    printerStatus.textContent = 'Web Serial/USB APIs not supported (HTTPS required)';
    printerStatusText.textContent = 'APIs not supported';
  }

  updateMainStatuses();

  // Auto-Connect Logic
  setTimeout(async () => {
    const savedType = localStorage.getItem('last-transport-type');
    if (!savedType) return;
    connectionTypeSelect.value = savedType;
    updateConnectionUI();

    if (savedType === 'network') {
      const savedIp = localStorage.getItem('last-network-ip');
      if (savedIp) {
        networkIpInput.value = savedIp;
        await connectPrinter();
      }
    } else if (savedType === 'serial' && 'serial' in navigator) {
      const ports = await (navigator as any).serial.getPorts();
      if (ports.length > 0) {
        await connectPrinter(ports[0]);
      }
    } else if (savedType === 'usb' && 'usb' in navigator) {
      const devices = await (navigator as any).usb.getDevices();
      if (devices.length > 0) {
        await connectPrinter(devices[0]);
      }
    } else if (savedType === 'browser') {
      await connectPrinter();
    }
  }, 100);
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
        initializeDefaultPreviewFields();
        renderCards();
        renderSchemaMapper();
        renderCardPreviewFieldsSettings();
        
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

function saveSchemaProfiles() {
  localStorage.setItem('schemaProfiles', JSON.stringify(schemaProfiles));
  localStorage.setItem('activeSchemaId', activeSchemaId);
}

function renderSchemaMapper() {
  if (!schemaMapperContainer || !schemaProfileSelect) return;
  
  schemaProfileSelect.innerHTML = '';
  for (const profile of Object.values(schemaProfiles)) {
    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.textContent = profile.name;
    opt.style.color = '#000';
    if (profile.id === activeSchemaId) opt.selected = true;
    schemaProfileSelect.appendChild(opt);
  }

  schemaMapperContainer.innerHTML = '';
  
  if (cards.length === 0) {
    schemaMapperContainer.innerHTML = '<em style="font-size: 0.8rem; color: var(--text-muted);">Fetch data first to configure mapping.</em>';
    return;
  }
  
  const csvHeaders = Object.keys(cards[0]);
  const currentProfile = schemaProfiles[activeSchemaId];
  if (!currentProfile) return;
  
  currentProfile.variables.forEach((variable, index) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    
    const varInput = document.createElement('input');
    varInput.type = 'text';
    varInput.value = variable;
    varInput.className = 'form-input';
    varInput.style.flex = '1';
    varInput.style.minWidth = '0';
    varInput.style.padding = '6px';
    varInput.style.borderRadius = '4px';
    varInput.style.background = 'rgba(0,0,0,0.2)';
    varInput.style.color = 'var(--text-main)';
    varInput.style.border = '1px solid var(--glass-border)';
    varInput.placeholder = 'Internal Var';
    
    varInput.addEventListener('change', () => {
       const oldVar = currentProfile.variables[index];
       const newVar = varInput.value.trim() || oldVar;
       currentProfile.variables[index] = newVar;
       if (oldVar !== newVar) {
         currentProfile.mapping[newVar] = currentProfile.mapping[oldVar];
         delete currentProfile.mapping[oldVar];
         saveSchemaProfiles();
       }
    });

    const arrow = document.createElement('span');
    arrow.textContent = '←';
    arrow.style.color = 'var(--text-muted)';
    arrow.style.fontSize = '1.2rem';
    
    const headerSelect = document.createElement('select');
    headerSelect.className = 'form-input';
    headerSelect.style.flex = '1';
    headerSelect.style.minWidth = '0';
    headerSelect.style.padding = '6px';
    headerSelect.style.borderRadius = '4px';
    headerSelect.style.background = 'rgba(0,0,0,0.2)';
    headerSelect.style.color = 'var(--text-main)';
    headerSelect.style.border = '1px solid var(--glass-border)';
    
    const unmappedOpt = document.createElement('option');
    unmappedOpt.value = '';
    unmappedOpt.textContent = '-- Unmapped --';
    unmappedOpt.style.color = '#000';
    headerSelect.appendChild(unmappedOpt);
    
    csvHeaders.forEach(h => {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      opt.style.color = '#000';
      headerSelect.appendChild(opt);
    });
    
    headerSelect.value = currentProfile.mapping[variable] || '';
    
    headerSelect.addEventListener('change', () => {
      currentProfile.mapping[currentProfile.variables[index]] = headerSelect.value;
      saveSchemaProfiles();
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.className = 'remove-line-btn';
    removeBtn.style.padding = '4px 8px';
    removeBtn.addEventListener('click', () => {
       delete currentProfile.mapping[currentProfile.variables[index]];
       currentProfile.variables.splice(index, 1);
       saveSchemaProfiles();
       renderSchemaMapper();
    });
    
    row.appendChild(varInput);
    row.appendChild(arrow);
    row.appendChild(headerSelect);
    row.appendChild(removeBtn);
    
    schemaMapperContainer.appendChild(row);
  });
}

function initializeDefaultPreviewFields() {
  if (cards.length === 0) return;
  
  // If we already have selected fields saved, keep them
  if (selectedPreviewFields.length > 0) return;
  
  const headers = Object.keys(cards[0]);
  
  // Find keys matching Item, Description, and Starting Bid
  const itemKey = headers.find(h => h.toLowerCase().includes('brief identifier') || h.toLowerCase().includes('item'));
  const descKey = headers.find(h => h.toLowerCase().includes('describe') || h.toLowerCase().includes('description'));
  const bidKey = headers.find(h => h.toLowerCase().includes('starting bid') || h.toLowerCase().includes('price') || h.toLowerCase().includes('bid'));
  
  // Find key matching Photo/Image
  const currentProfile = schemaProfiles[activeSchemaId];
  const imageMappedColumn = currentProfile ? currentProfile.mapping["Image"] : null;
  const photoKey = headers.find(h => {
    const lower = h.toLowerCase();
    return lower.includes('picture') || 
           lower.includes('photo') || 
           lower.includes('image') ||
           (imageMappedColumn && h === imageMappedColumn);
  });
  
  selectedPreviewFields = [itemKey, descKey, bidKey, photoKey].filter((k): k is string => !!k);
  
  if (selectedPreviewFields.length > 0) {
    localStorage.setItem('card-preview-fields', JSON.stringify(selectedPreviewFields));
  }
}

function renderCardPreviewFieldsSettings() {
  if (!cardPreviewFieldsContainer) return;
  cardPreviewFieldsContainer.innerHTML = '';

  if (cards.length === 0) {
    cardPreviewFieldsContainer.innerHTML = '<em style="font-size: 0.8rem; color: var(--text-muted);">Fetch data first to configure preview fields.</em>';
    return;
  }

  let headers = Object.keys(cards[0]).filter(k => k !== 'id');
  
  // Sort headers by saved drag order if it exists
  const savedOrderStr = localStorage.getItem('card-preview-fields-order');
  if (savedOrderStr) {
    const savedOrder: string[] = JSON.parse(savedOrderStr);
    const existingSavedOrder = savedOrder.filter(h => headers.includes(h));
    const newHeaders = headers.filter(h => !savedOrder.includes(h));
    headers = [...existingSavedOrder, ...newHeaders];
  }

  headers.forEach(header => {
    const isChecked = selectedPreviewFields.includes(header);
    
    const itemEl = document.createElement('div');
    itemEl.className = 'preview-field-item draggable';
    itemEl.draggable = true;
    itemEl.dataset.header = header;
    itemEl.style.display = 'flex';
    itemEl.style.alignItems = 'center';
    itemEl.style.gap = '10px';
    itemEl.style.padding = '8px';
    itemEl.style.background = 'rgba(255,255,255,0.05)';
    itemEl.style.border = '1px solid var(--glass-border)';
    itemEl.style.borderRadius = '6px';
    itemEl.style.transition = 'background 0.2s';
    
    const dragHandle = document.createElement('span');
    dragHandle.textContent = '⋮⋮';
    dragHandle.style.color = 'var(--text-muted)';
    dragHandle.style.cursor = 'grab';
    dragHandle.style.fontWeight = 'bold';
    
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    label.style.cursor = 'pointer';
    label.style.fontSize = '0.9rem';
    label.style.flex = '1';
    label.style.margin = '0';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = header;
    checkbox.checked = isChecked;
    checkbox.style.cursor = 'pointer';

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        if (!selectedPreviewFields.includes(header)) {
          selectedPreviewFields.push(header);
        }
      } else {
        selectedPreviewFields = selectedPreviewFields.filter(f => f !== header);
      }
      localStorage.setItem('card-preview-fields', JSON.stringify(selectedPreviewFields));
      renderCards(searchInput.value);
    });

    const textSpan = document.createElement('span');
    const displayLabel = shortLabel(header);
    if (displayLabel !== header) {
      textSpan.innerHTML = `${displayLabel} <span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">(${header})</span>`;
    } else {
      textSpan.textContent = header;
    }

    label.appendChild(checkbox);
    label.appendChild(textSpan);
    itemEl.appendChild(dragHandle);
    itemEl.appendChild(label);
    cardPreviewFieldsContainer.appendChild(itemEl);
  });
}

function initDragAndDrop() {
  if (!cardPreviewFieldsContainer) return;

  cardPreviewFieldsContainer.addEventListener('dragstart', (e) => {
    const target = e.target as HTMLElement;
    const draggable = target.closest('.draggable');
    if (draggable) {
      draggable.classList.add('dragging');
    }
  });

  cardPreviewFieldsContainer.addEventListener('dragend', (e) => {
    const target = e.target as HTMLElement;
    const draggable = target.closest('.draggable');
    if (draggable) {
      draggable.classList.remove('dragging');
    }
    saveNewFieldsOrder();
  });

  cardPreviewFieldsContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    const draggingEl = cardPreviewFieldsContainer.querySelector('.dragging');
    if (!draggingEl) return;

    const afterElement = getDragAfterElement(cardPreviewFieldsContainer, e.clientY);
    if (afterElement == null) {
      cardPreviewFieldsContainer.appendChild(draggingEl);
    } else {
      cardPreviewFieldsContainer.insertBefore(draggingEl, afterElement);
    }
  });
}

function getDragAfterElement(container: HTMLElement, y: number): Element | null {
  const draggableElements = [...container.querySelectorAll('.draggable:not(.dragging)')];

  return draggableElements.reduce<{ offset: number; element: Element | null }>((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function saveNewFieldsOrder() {
  if (!cardPreviewFieldsContainer) return;

  const itemElements = [...cardPreviewFieldsContainer.querySelectorAll('.draggable')];
  const newOrder: string[] = [];
  const newSelected: string[] = [];

  itemElements.forEach(el => {
    const header = (el as HTMLElement).dataset.header;
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (header) {
      newOrder.push(header);
      if (checkbox && checkbox.checked) {
        newSelected.push(header);
      }
    }
  });

  selectedPreviewFields = newSelected;
  localStorage.setItem('card-preview-fields', JSON.stringify(selectedPreviewFields));
  localStorage.setItem('card-preview-fields-order', JSON.stringify(newOrder));

  renderCards(searchInput.value);
}

schemaProfileSelect?.addEventListener('change', (e) => {
  activeSchemaId = (e.target as HTMLSelectElement).value;
  saveSchemaProfiles();
  renderSchemaMapper();
});

newSchemaBtn?.addEventListener('click', () => {
  const name = prompt('Enter a name for the new schema profile:');
  if (name && name.trim()) {
    const id = 'schema-' + Date.now();
    const currentProfile = schemaProfiles[activeSchemaId];
    schemaProfiles[id] = { 
      id, 
      name: name.trim(), 
      variables: currentProfile ? [...currentProfile.variables] : [], 
      mapping: currentProfile ? { ...currentProfile.mapping } : {} 
    };
    activeSchemaId = id;
    saveSchemaProfiles();
    renderSchemaMapper();
  }
});

deleteSchemaBtn?.addEventListener('click', () => {
  if (Object.keys(schemaProfiles).length <= 1) {
    alert('You must have at least one schema profile.');
    return;
  }
  if (confirm(`Delete schema profile "${schemaProfiles[activeSchemaId]?.name}"?`)) {
    delete schemaProfiles[activeSchemaId];
    activeSchemaId = Object.keys(schemaProfiles)[0];
    saveSchemaProfiles();
    renderSchemaMapper();
  }
});

addSchemaVarBtn?.addEventListener('click', () => {
  const currentProfile = schemaProfiles[activeSchemaId];
  if (!currentProfile) return;
  const newVar = `Var ${currentProfile.variables.length + 1}`;
  currentProfile.variables.push(newVar);
  saveSchemaProfiles();
  renderSchemaMapper();
});

async function autoPrintNewItems() {
  let printedIds: Set<string> = new Set();
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = new Set(JSON.parse(saved));
  } catch(e) {}
  
  const unprintedCards = cards.filter(c => !printedIds.has(c.id));
  if (unprintedCards.length === 0) return;
  
  for (const card of unprintedCards) {
     const titleKey = Object.keys(card).find(k => k.toLowerCase().includes('brief identifier') || k.toLowerCase().match(/name|title|item/)) || Object.keys(card)[0];
     const title = card[titleKey] || 'Untitled Item';
     try {
       const lines = await getPrintLinesForCard(card);
       await sendLinesToPrinter(lines);
       
       addHistoryLog(card.id, title, 'success');
       printedIds.add(card.id);
       localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
       
       await new Promise(r => setTimeout(r, 500));
     } catch (err: any) {
       addHistoryLog(card.id, title, 'error', err.message);
       console.error("Auto-print failed for", card.id, err);
     }
  }
  renderCards(searchInput.value);
}

function renderTemplateProfiles() {
  templateProfileSelect.innerHTML = '';
  for (const [id, profile] of Object.entries(templateProfiles)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = profile.name;
    opt.style.color = '#000';
    if (id === activeTemplateId) opt.selected = true;
    templateProfileSelect.appendChild(opt);
  }
}

function addHistoryLog(id: string, title: string, status: 'success' | 'error', errorMessage?: string) {
  printHistory.unshift({ timestamp: Date.now(), id, title, status, errorMessage });
  if (printHistory.length > 100) printHistory = printHistory.slice(0, 100);
  localStorage.setItem('print-history', JSON.stringify(printHistory));
}

function renderHistory() {
  historyList.innerHTML = '';
  if (printHistory.length === 0) {
    historyList.innerHTML = '<p style="color:var(--text-muted)">No print history yet.</p>';
    return;
  }

  printHistory.forEach(log => {
    const div = document.createElement('div');
    div.style.background = 'rgba(255,255,255,0.05)';
    div.style.padding = '10px';
    div.style.borderRadius = '6px';
    div.style.borderLeft = `4px solid ${log.status === 'success' ? '#4ade80' : '#ef4444'}`;
    
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px;color:var(--text-muted)">
        <span>${new Date(log.timestamp).toLocaleString()}</span>
        <span>ID: ${log.id}</span>
      </div>
      <div style="font-weight:bold;">${log.title}</div>
      ${log.errorMessage ? "<div style='color:#ef4444;font-size:0.8rem;margin-top:4px'>" + log.errorMessage + "</div>" : ""}
    `;
    historyList.appendChild(div);
  });
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

    // Show a compact preview of selected fields, or a few key fields by default
    let fieldsHtml = '';
    if (selectedPreviewFields.length > 0) {
      selectedPreviewFields.forEach(key => {
        const value = card[key];
        if (key === 'id') return; // Skip internal ID
        if (!value || !value.trim()) return;

        const isImage = checkIsImageField(key, value);
        const valueHtml = isImage
          ? `<img src="${normalizeImageUrl(value)}" alt="${shortLabel(key)}" class="card-preview-image" referrerpolicy="no-referrer" loading="lazy" />`
          : `<span>${value.length > 60 ? value.slice(0, 60) + '…' : value}</span>`;

        fieldsHtml += `
          <div class="row-field">
            <strong>${shortLabel(key)}</strong>
            ${valueHtml}
          </div>
        `;
      });
    } else {
      let fieldCount = 0;
      for (const [key, value] of Object.entries(card)) {
        if (key === 'id' || key === titleKey || key === 'Donation #') continue;
        if (!value || !value.trim()) continue;
        if (fieldCount >= 3) { fieldsHtml += `<div class="row-field more">…more</div>`; break; }
        
        const isImage = checkIsImageField(key, value);
        const valueHtml = isImage
          ? `<img src="${normalizeImageUrl(value)}" alt="${shortLabel(key)}" class="card-preview-image" referrerpolicy="no-referrer" loading="lazy" />`
          : `<span>${value.length > 60 ? value.slice(0, 60) + '…' : value}</span>`;

        fieldsHtml += `
          <div class="row-field">
            <strong>${shortLabel(key)}</strong>
            ${valueHtml}
          </div>
        `;
        fieldCount++;
      }
    }
    const currentTemplateId = templateAssignments[card.id] || activeTemplateId;
    let templateOptionsHtml = '';
    for (const profile of Object.values(templateProfiles)) {
      templateOptionsHtml += `<option value="${profile.id}" ${currentTemplateId === profile.id ? 'selected' : ''}>${profile.name}</option>`;
    }

      if (isSelectMode && selectedItemIds.has(card.id)) {
        cardEl.classList.add('selected');
      } else {
        cardEl.classList.remove('selected');
      }

      const checkboxHtml = isSelectMode 
        ? `<input type="checkbox" class="card-select-checkbox" data-id="${card.id}" ${selectedItemIds.has(card.id) ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--primary-color); margin-right: 5px; flex-shrink: 0;" />`
        : '';

      cardEl.innerHTML = `
        <div class="card-header" style="display: flex; align-items: center; gap: 8px;">
          ${checkboxHtml}
          <span class="card-badge">#${donationNum}</span>
          <div class="card-title">${title}</div>
        </div>
        <div class="card-content">
          ${fieldsHtml}
        </div>
        <div class="card-actions" style="flex-wrap: wrap; gap: 8px;">
          <select class="form-input template-assign-select" data-id="${card.id}" style="padding: 4px; border-radius: 4px; background: rgba(0,0,0,0.2); color: var(--text-main); border: 1px solid var(--glass-border); flex: 1; min-width: 100%; font-size: 0.8rem;" title="Select Template">
            ${templateOptionsHtml}
          </select>
          <div style="display: flex; gap: 10px; width: 100%;">
            <button class="btn secondary-btn edit-btn" style="flex: 1" data-id="${card.id}">✏️ Edit</button>
            <button class="btn print-btn print-item-btn ${printedIds.has(card.id) ? 'printed' : ''}" style="flex: 2" data-id="${card.id}">
              ${printedIds.has(card.id) ? '✅ Printed' : '🖨️ Print'}
            </button>
          </div>
        </div>
      `;

    cardsContainer.appendChild(cardEl);
  });

  // Attach select listeners
  document.querySelectorAll('.template-assign-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const id = target.dataset.id;
      if (id) {
        templateAssignments[id] = target.value;
        localStorage.setItem('templateAssignments', JSON.stringify(templateAssignments));
      }
    });
  });

  // Click card body to open preview or toggle selection
  document.querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.card-actions')) return;
      const id = (cardEl as HTMLElement).dataset.id;
      if (!id) return;

      if (isSelectMode) {
        const checkbox = cardEl.querySelector('.card-select-checkbox') as HTMLInputElement;
        if (target !== checkbox) {
          checkbox.checked = !checkbox.checked;
        }
        if (checkbox.checked) {
          selectedItemIds.add(id);
          cardEl.classList.add('selected');
        } else {
          selectedItemIds.delete(id);
          cardEl.classList.remove('selected');
        }
        updateSelectedCountUI();
      } else {
        openPreviewModal(id);
      }
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
  lastClickedCard = card;

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
    const isImage = checkIsImageField(key, value);
    const valueHtml = isImage
      ? `<img src="${normalizeImageUrl(value)}" alt="${shortLabel(key)}" class="preview-image" referrerpolicy="no-referrer" />`
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
    const id = currentEditId;
    closePreviewModal();
    openPrintPreview(id);
  }
});

// Edit Modal
function openEditModal(id: string, newCardData?: CardData) {
  const card = newCardData || cards.find(c => c.id === id);
  if (!card) return;
  lastClickedCard = card;

  currentEditId = id;
  editFieldsContainer.innerHTML = '';

  for (const [key, value] of Object.entries(card)) {
    const group = document.createElement('div');
    group.className = 'input-group';
    
    const label = document.createElement('label');
    label.textContent = key;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.name = key;
    input.value = value;
    
    if (key === 'id') {
      input.readOnly = true;
      input.style.backgroundColor = 'rgba(0,0,0,0.4)';
      input.style.color = 'var(--text-muted)';
      input.style.cursor = 'not-allowed';
      input.title = 'Item ID cannot be modified';
    }
    
    group.appendChild(label);
    group.appendChild(input);
    editFieldsContainer.appendChild(group);
  }

  editModal.classList.remove('hidden');
}

function closeEditModal() {
  editModal.classList.add('hidden');
  currentEditId = null;
  pendingNewCard = null;
}

modalDeleteBtn.addEventListener('click', () => {
  if (!currentEditId) return;
  if (confirm('Are you sure you want to delete this item?')) {
    if (!pendingNewCard) {
      cards = cards.filter(c => c.id !== currentEditId);
      saveCards();
      renderCards(searchInput.value);
    }
    closeEditModal();
  }
});

function incrementCustomId() {
  const nextNumStr = customIdNext.value || '1000';
  const nextNum = parseInt(nextNumStr, 10);
  const isNumberValid = !isNaN(nextNum);
  const actualNum = isNumberValid ? nextNum : 1000;
  const incremented = actualNum + 1;
  const nextLength = nextNumStr.length;
  customIdNext.value = incremented.toString().padStart(nextLength, '0');
  localStorage.setItem('custom-id-next', customIdNext.value);
}

editForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentEditId) return;

  const cardIndex = cards.findIndex(c => c.id === currentEditId);
  if (cardIndex === -1 && !pendingNewCard) return;

  const formData = new FormData(editForm);
  const updatedCard = { id: currentEditId } as CardData;

  formData.forEach((value, key) => {
    updatedCard[key] = value.toString();
  });

  if (pendingNewCard) {
    cards.unshift(updatedCard);
    incrementCustomId();
    pendingNewCard = null;
  } else {
    cards[cardIndex] = updatedCard;
  }

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
    } else if (pendingNewCard) {
      cards.unshift(tempCard);
      incrementCustomId();
      pendingNewCard = null;
      saveCards();
      renderCards(searchInput.value);
    }
    
    const idToPrint = currentEditId;
    closeEditModal();
    openPrintPreview(idToPrint);
  }
});

closeModal.addEventListener('click', closeEditModal);
editModal.addEventListener('click', () => {
  // Prevent closing when clicking outside to avoid losing unsaved edits
});

// Printer Logic
async function connectPrinter(existingDevice?: any) {
  const type = connectionTypeSelect.value;
  localStorage.setItem('last-transport-type', type);

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
      localStorage.setItem('last-network-ip', ip);
      activeTransport = new NetworkPrinterTransport(ip);
    } else if (type === 'browser') {
      activeTransport = new BrowserPrinterTransport();
    }

    connectPrinterBtn.textContent = 'Connecting...';
    connectPrinterBtn.disabled = true;

    await activeTransport!.connect(existingDevice);

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
    let msg = err.message;
    if (msg.includes("Access denied") || msg.includes("SecurityError")) {
      const isWindows = /win/i.test(navigator.userAgent || navigator.platform || "");
      if (isWindows) {
        msg += "\n\nTip: On Windows, this is usually because the default printer driver has claimed the device. You must use Zadig (https://zadig.akeo.ie) to replace the printer driver with 'WinUSB'. Alternatively, try using the 'Serial' connection type which often works out of the box.";
      } else {
        msg += "\n\nTip: On Linux, this is usually a permission issue. If using USB, you may need a udev rule (run `./setup-udev-rules.sh`). If using Serial, ensure your user is in the 'dialout' or 'uucp' group.";
      }
    }
    alert('Failed to connect to printer: ' + msg);
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

async function triggerBrowserPrint() {
  const wasConnectedTransport = activeTransport;
  let existingPortOrDevice: any = null;
  
  if (wasConnectedTransport && (wasConnectedTransport.type === 'usb' || wasConnectedTransport.type === 'serial')) {
    if (wasConnectedTransport.type === 'serial') {
      existingPortOrDevice = (wasConnectedTransport as SerialPrinterTransport).port;
    } else if (wasConnectedTransport.type === 'usb') {
      existingPortOrDevice = (wasConnectedTransport as UsbPrinterTransport).device;
    }
    try {
      await wasConnectedTransport.disconnect();
      printerStatus.textContent = 'Disconnected';
      printerStatus.className = 'status disconnected';
      printerStatusText.textContent = 'Disconnected';
      printerStatusText.className = 'status disconnected';
      activeTransport = null;
    } catch (e) {
      console.error('Failed to release printer port', e);
    }
  }

  // Open browser print dialog
  window.print();

  // Reconnect if we were connected
  if (wasConnectedTransport && existingPortOrDevice) {
    // Wait a short delay to let the OS release the USB interface
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      await connectPrinter(existingPortOrDevice);
    } catch (e) {
      console.error('Failed to auto-reconnect printer', e);
    }
  }
}

// Print Preview System


let printLines: PrintLine[] = [];

const printPreviewModal = document.getElementById('print-preview-modal') as HTMLDivElement;
const closePrintPreview = document.getElementById('close-print-preview') as HTMLSpanElement;
const receiptPaper = document.getElementById('receipt-paper') as HTMLDivElement;
const printLinesControls = document.getElementById('print-lines-controls') as HTMLDivElement;
const addPrintLineBtn = document.getElementById('add-print-line-btn') as HTMLButtonElement;
const addImageBtn = document.getElementById('add-image-btn') as HTMLButtonElement;
const addQrBtn = document.getElementById('add-qr-btn') as HTMLButtonElement;
const addBarcodeBtn = document.getElementById('add-barcode-btn') as HTMLButtonElement;
const addSeparatorBtn = document.getElementById('add-separator-btn') as HTMLButtonElement;
const printPreviewCancel = document.getElementById('print-preview-cancel') as HTMLButtonElement;
const printPreviewSend = document.getElementById('print-preview-send') as HTMLButtonElement;
const printPreviewBrowser = document.getElementById('print-preview-browser') as HTMLButtonElement;
const templateVariablesPanel = document.getElementById('template-variables-panel') as HTMLDivElement;
const templateVariablesList = document.getElementById('template-variables-list') as HTMLDivElement;

const importTemplateBtn = document.getElementById('import-template-btn') as HTMLButtonElement;
const exportTemplateBtn = document.getElementById('export-template-btn') as HTMLButtonElement;
const importTemplateFile = document.getElementById('import-template-file') as HTMLInputElement;

async function getPrintLinesForCard(card: CardData): Promise<PrintLine[]> {
  const cardTemplateId = templateAssignments[card.id] || activeTemplateId;
  let baseLines = templateProfiles[cardTemplateId]?.lines || templateProfiles['charity_receipt']?.lines || [];
  if (!baseLines.length) {
    baseLines = generateDefaultTemplateLines(card, shortLabel);
  }
  const currentSchema = schemaProfiles[activeSchemaId];
  return await generatePrintLines(card, baseLines, updateBarcodeQrImage, currentSchema?.mapping, currentSchema?.variables);
}

async function openPrintPreview(id: string) {
  const card = cards.find(c => c.id === id);
  if (!card) return;
  lastClickedCard = card;

  currentEditId = id;
  isTemplateMode = false;
  printPreviewSend.textContent = '🖨️ Print';
  printPreviewBrowser.classList.remove('hidden');
  templateVariablesPanel.classList.add('hidden');
  importTemplateBtn.classList.add('hidden');
  exportTemplateBtn.classList.add('hidden');
  printLines = await getPrintLinesForCard(card);

  renderPrintPreview();
  printPreviewModal.classList.remove('hidden');
}

function closePrintPreviewModal() {
  printPreviewModal.classList.add('hidden');
  currentEditId = null;
  isTemplateMode = false;
}

function updateReceiptPaper() {
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
        const currentSchema = schemaProfiles[activeSchemaId];
        src = interpolate(src, lastClickedCard || cards[0], currentSchema?.mapping, currentSchema?.variables);
      }
      img.src = normalizeImageUrl(src);
      
      img.style.maxWidth = 'var(--print-image-width, 80%)';
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
    
    const currentSchema = schemaProfiles[activeSchemaId];
    div.textContent = (isTemplateMode && cards.length > 0) ? interpolate(line.text, lastClickedCard || cards[0], currentSchema?.mapping, currentSchema?.variables) : line.text;
    receiptPaper.appendChild(div);
  });
}

function renderPrintPreview() {
  updateReceiptPaper();
  let dragStartIndex = -1;

  // Render controls
  printLinesControls.innerHTML = '';
  printLines.forEach((line, index) => {
    const control = document.createElement('div');
    control.className = 'print-line-control';
    control.draggable = false;

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
    
    dragHandle.addEventListener('mouseenter', () => {
      control.draggable = true;
    });
    dragHandle.addEventListener('mouseleave', () => {
      control.draggable = false;
    });
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = line.enabled;
    checkbox.addEventListener('change', () => {
      printLines[index].enabled = checkbox.checked;
      updateReceiptPaper();
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

        if (line.isBarcode) {
          const formatSelect = document.createElement('select');
          formatSelect.style.marginLeft = '10px';
          
          const formats = ['code128', 'code39', 'ean13', 'upca'];
          formats.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f.toUpperCase();
            opt.style.color = '#000';
            formatSelect.appendChild(opt);
          });
          formatSelect.value = line.barcodeFormat || 'code128';
          formatSelect.addEventListener('change', () => {
             printLines[index].barcodeFormat = formatSelect.value;
             updateBarcodeQrImage(printLines[index], index);
             savePrintTemplate();
          });
          topRow.appendChild(formatSelect);
        }
      } else {
        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.value = line.imageUrl || '';
        urlInput.placeholder = 'Image URL (e.g. https://... or {{Image}})';
        urlInput.style.flex = '1';
        
        let typingTimer: any;
        urlInput.addEventListener('input', () => {
          printLines[index].imageUrl = urlInput.value;
          delete printLines[index].rasterData;
          clearTimeout(typingTimer);
          typingTimer = setTimeout(() => {
            updateReceiptPaper();
            savePrintTemplate();
          }, 300);
        });
        topRow.appendChild(urlInput);

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
        topRow.appendChild(sliderWrap);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-line-btn';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        printLines.splice(index, 1);
        renderPrintPreview();
      });

      topRow.appendChild(removeBtn);
    } else {
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.value = line.text;
      textInput.addEventListener('input', () => {
        printLines[index].text = textInput.value;
        updateReceiptPaper();
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

    optionsRow.appendChild(makeBtn('Bold', line.bold || false, () => {
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
    if (templateProfiles[activeTemplateId]) {
      templateProfiles[activeTemplateId].lines = JSON.parse(JSON.stringify(printLines));
      localStorage.setItem('template-profiles', JSON.stringify(templateProfiles));
    }
    // Also save legacy fallback just in case
    localStorage.setItem('base-print-template', JSON.stringify(printLines));
  } else {
    localStorage.setItem('custom-receipt-draft', JSON.stringify(printLines));
  }
}

async function updateBarcodeQrImage(line: PrintLine, index: number) {
  const currentSchema = schemaProfiles[activeSchemaId];
  const evalText = (isTemplateMode && cards.length > 0) ? interpolate(line.text || ' ', cards[0], currentSchema?.mapping, currentSchema?.variables) : (line.text || ' ');
  if (line.isQr) {
    try {
      line.imageUrl = await QRCode.toDataURL(evalText, { width: 250, margin: 2, scale: 4 });
    } catch {}
  } else if (line.isBarcode) {
    try {
      const canvas = document.createElement('canvas');
      bwipjs.toCanvas(canvas, { bcid: line.barcodeFormat || 'code128', text: evalText || '1234', scale: 3, height: 10, includetext: true, textxalign: 'center' });
      line.imageUrl = canvas.toDataURL('image/png');
    } catch (e: any) {
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 60;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 300, 60);
        ctx.fillStyle = 'red';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Barcode Error', 150, 25);
        ctx.font = '12px sans-serif';
        const msg = e.message ? (e.message.split(':').pop()?.trim() || e.message) : 'Invalid format';
        ctx.fillText(msg, 150, 45);
      }
      line.imageUrl = canvas.toDataURL('image/png');
    }
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

addImageBtn.addEventListener('click', () => {
  printLines.push({ enabled: true, text: '', bold: false, align: 'center', size: 'normal', isImage: true, imageUrl: '', gamma: 1.0 });
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
  printLines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'xs', isSeparator: true });
  renderPrintPreview();
});

closePrintPreview.addEventListener('click', closePrintPreviewModal);
printPreviewCancel.addEventListener('click', closePrintPreviewModal);
printPreviewModal.addEventListener('click', () => {
  // Prevent closing when clicking outside to avoid losing unsaved template changes
});

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    if (url.startsWith('http')) {
      const cacheBuster = `cb=${Date.now()}`;
      img.src = url.includes('?') ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;
    } else {
      img.src = url;
    }
  });
}

async function convertImageToRaster(url: string, gamma: number = 1.0): Promise<Uint8Array[] | null> {
  try {
    const normalizedUrl = normalizeImageUrl(url);
    let img: HTMLImageElement;
    try {
      img = await loadImage(normalizedUrl);
    } catch {
      // Fallback to proxy to bypass CORS
      img = await loadImage(`https://corsproxy.io/?${encodeURIComponent(normalizedUrl)}`);
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
    const paddedWidth = Math.ceil(width / 8) * 8;

    canvas.width = paddedWidth;
    canvas.height = height;

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, paddedWidth, height);
    
    const offsetX = Math.floor((paddedWidth - width) / 2);
    ctx.drawImage(img, offsetX, 0, width, height);

    const imageData = ctx.getImageData(0, 0, paddedWidth, height);
    const pixels = imageData.data;
    
    const gray = new Float32Array(paddedWidth * height);
    for (let i = 0; i < paddedWidth * height; i++) {
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
      for (let x = 0; x < paddedWidth; x++) {
        const i = y * paddedWidth + x;
        const oldPixel = gray[i];
        const newPixel = oldPixel < 128 ? 0 : 255;
        gray[i] = newPixel;
        const err = oldPixel - newPixel;
        
        if (x + 1 < paddedWidth) gray[i + 1] += err * (7/16);
        if (y + 1 < height) {
          if (x - 1 >= 0) gray[i + paddedWidth - 1] += err * (3/16);
          gray[i + paddedWidth] += err * (5/16);
          if (x + 1 < paddedWidth) gray[i + paddedWidth + 1] += err * (1/16);
        }
      }
    }

    const chunkHeight = 24;
    const strips: Uint8Array[] = [];
    
    for (let startY = 0; startY < height; startY += chunkHeight) {
      const currentHeight = Math.min(chunkHeight, height - startY);
      
      const xL = (paddedWidth / 8) % 256;
      const xH = Math.floor((paddedWidth / 8) / 256);
      const yL = currentHeight % 256;
      const yH = Math.floor(currentHeight / 256);

      const stripData = new Uint8Array(8 + (paddedWidth / 8) * currentHeight);
      stripData[0] = 0x1D; stripData[1] = 0x76; stripData[2] = 0x30; stripData[3] = 0x00;
      stripData[4] = xL; stripData[5] = xH; stripData[6] = yL; stripData[7] = yH;

      let idx = 8;
      for (let y = 0; y < currentHeight; y++) {
        const absoluteY = startY + y;
        for (let x = 0; x < paddedWidth; x += 8) {
          let byte = 0;
          for (let b = 0; b < 8; b++) {
             if (gray[absoluteY * paddedWidth + x + b] < 128) { // black
               byte |= (1 << (7 - b));
             }
          }
          stripData[idx++] = byte;
        }
      }
      strips.push(stripData);
    }
    
    return strips;
  } catch (err) {
    console.error('Failed to convert image to raster', err);
    return null;
  }
}

// Send to Printer from preview
async function sendLinesToPrinter(lines: PrintLine[]) {
  if (activeTransport && activeTransport.type === 'browser') {
    await triggerBrowserPrint();
    return;
  }
  if (!activeTransport) throw new Error('Printer not connected! Please connect the printer first.');
  const feedLines = parseInt(feedLinesInput.value, 10) || 4;

  for (const line of lines) {
    if (line.enabled && line.isImage && line.imageUrl && !line.rasterData) {
      const originalText = printPreviewSend.textContent;
      printPreviewSend.textContent = 'Preparing Image...';
      const rasterData = await convertImageToRaster(line.imageUrl, line.gamma || 1.0);
      if (rasterData) {
        line.rasterData = rasterData;
      } else {
        alert('Could not download or convert image: ' + line.imageUrl);
      }
      if (printPreviewSend.textContent === 'Preparing Image...') {
        printPreviewSend.textContent = originalText;
      }
    }
  }

  await _sendLinesToPrinter(lines, activeTransport, feedLines);
}

// Send to Printer from preview
printPreviewSend.addEventListener('click', async () => {
  if (isTemplateMode) {
    savePrintTemplate();
    closePrintPreviewModal();
    return;
  }

  try {
    const cardToUse = lastClickedCard || cards[0];
    const titleKey = Object.keys(cardToUse).find(k => k.toLowerCase().includes('brief identifier') || k.toLowerCase().match(/name|title|item/)) || Object.keys(cardToUse)[0];
    const title = cardToUse[titleKey] || 'Untitled Item';
    try {
      await sendLinesToPrinter(printLines);
      addHistoryLog(cardToUse.id, title, 'success');
    } catch (e: any) {
      addHistoryLog(cardToUse.id, title, 'error', e.message);
      throw e;
    }
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
    closePrintPreviewModal();
  } catch (err: any) {
    if (err.message !== 'Printer not connected! Please connect the printer first.') {
      console.error('Print failed', err);
    }
    alert(err.message);
  }
});

// Print using browser print dialog
printPreviewBrowser.addEventListener('click', async () => {
  const cardToUse = lastClickedCard || cards[0];
  const titleKey = Object.keys(cardToUse).find(k => k.toLowerCase().includes('brief identifier') || k.toLowerCase().match(/name|title|item/)) || Object.keys(cardToUse)[0];
  const title = cardToUse[titleKey] || 'Untitled Item';
  
  try {
    // Open the browser print dialog
    await triggerBrowserPrint();
    
    // Log the print action
    addHistoryLog(cardToUse.id, title, 'success');
    
    // Mark as printed
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
    
    closePrintPreviewModal();
  } catch (err: any) {
    console.error('Browser print failed', err);
    alert('Browser print failed: ' + err.message);
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

  templateProfileSelect.addEventListener('change', () => {
    activeTemplateId = templateProfileSelect.value;
    localStorage.setItem('active-template-id', activeTemplateId);
  });

  newTemplateBtn.addEventListener('click', () => {
    const name = prompt('Enter a name for the new template profile:');
    if (!name) return;
    const id = 'template_' + Date.now();
    const currentLines = templateProfiles[activeTemplateId]?.lines || [];
    templateProfiles[id] = { id, name, lines: JSON.parse(JSON.stringify(currentLines)) };
    activeTemplateId = id;
    localStorage.setItem('active-template-id', activeTemplateId);
    localStorage.setItem('template-profiles', JSON.stringify(templateProfiles));
    renderTemplateProfiles();
  });

  deleteTemplateBtn.addEventListener('click', () => {
    if (activeTemplateId === 'default') {
      alert('Cannot delete the default template profile.');
      return;
    }
    if (confirm(`Are you sure you want to delete profile "${templateProfiles[activeTemplateId].name}"?`)) {
      delete templateProfiles[activeTemplateId];
      activeTemplateId = 'default';
      localStorage.setItem('active-template-id', activeTemplateId);
      localStorage.setItem('template-profiles', JSON.stringify(templateProfiles));
      renderTemplateProfiles();
    }
  });

  viewHistoryBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    renderHistory();
    historyModal.classList.remove('hidden');
  });

  closeHistoryModal.addEventListener('click', () => {
    historyModal.classList.add('hidden');
  });

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the print history log?')) {
      printHistory = [];
      localStorage.removeItem('print-history');
      renderHistory();
    }
  });

  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) historyModal.classList.add('hidden');
  });

// Event Listeners
fetchDataBtn.addEventListener('click', fetchData);

shareLinkBtn.addEventListener('click', () => {
  const url = csvUrlInput.value.trim();
  if (!url) return alert('Please enter a valid Google Sheets CSV URL first.');
  
  const shareUrl = new URL(window.location.protocol + "//" + window.location.host + window.location.pathname);
  shareUrl.searchParams.set('sheet', url);
  shareUrl.searchParams.set('autoSync', autoSyncToggle.checked.toString());
  shareUrl.searchParams.set('syncInterval', syncIntervalSelect.value);
  shareUrl.searchParams.set('readOnly', readOnlyToggle.checked.toString());
  
  navigator.clipboard.writeText(shareUrl.toString()).then(() => {
    const originalText = shareLinkBtn.textContent;
    shareLinkBtn.textContent = '✅ Copied!';
    setTimeout(() => {
      shareLinkBtn.textContent = originalText;
    }, 2000);
  }).catch(err => {
    alert('Failed to copy link: ' + err);
  });
});
connectPrinterBtn.addEventListener('click', () => connectPrinter());
searchInput.addEventListener('input', (e) => renderCards((e.target as HTMLInputElement).value));

settingsBtn.addEventListener('click', () => {
  renderCardPreviewFieldsSettings();
  settingsModal.classList.remove('hidden');
});
closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});

selectModeBtn.addEventListener('click', () => {
  isSelectMode = !isSelectMode;
  if (isSelectMode) {
    selectModeBtn.textContent = '❌ Exit Select';
    selectModeBtn.style.background = 'var(--primary-color)';
    selectModeBtn.style.color = 'white';
    batchActionsBar.classList.remove('hidden');
  } else {
    selectModeBtn.textContent = '☑️ Select Mode';
    selectModeBtn.style.background = '';
    selectModeBtn.style.color = '';
    batchActionsBar.classList.add('hidden');
    selectedItemIds.clear();
  }
  updateSelectedCountUI();
  renderCards(searchInput.value);
});

batchSelectAllBtn.addEventListener('click', () => {
  const visibleCards = cardsContainer.querySelectorAll('.card');
  visibleCards.forEach(cardEl => {
    const id = (cardEl as HTMLElement).dataset.id;
    if (id) {
      selectedItemIds.add(id);
      const checkbox = cardEl.querySelector('.card-select-checkbox') as HTMLInputElement;
      if (checkbox) checkbox.checked = true;
      cardEl.classList.add('selected');
    }
  });
  updateSelectedCountUI();
});

batchClearBtn.addEventListener('click', () => {
  selectedItemIds.clear();
  const visibleCards = cardsContainer.querySelectorAll('.card');
  visibleCards.forEach(cardEl => {
    const checkbox = cardEl.querySelector('.card-select-checkbox') as HTMLInputElement;
    if (checkbox) checkbox.checked = false;
    cardEl.classList.remove('selected');
  });
  updateSelectedCountUI();
});

batchMarkPrintedBtn.addEventListener('click', () => {
  if (selectedItemIds.size === 0) return alert('No items selected.');
  if (confirm(`Mark ${selectedItemIds.size} selected items as printed?`)) {
    let printedIds: Set<string> = new Set();
    try {
      const saved = localStorage.getItem('printed-items');
      if (saved) printedIds = new Set(JSON.parse(saved));
    } catch(e) {}
    
    selectedItemIds.forEach(id => {
      printedIds.add(id);
    });
    
    localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
    
    selectedItemIds.clear();
    updateSelectedCountUI();
    renderCards(searchInput.value);
  }
});

batchMarkUnprintedBtn.addEventListener('click', () => {
  if (selectedItemIds.size === 0) return alert('No items selected.');
  if (confirm(`Mark ${selectedItemIds.size} selected items as unprinted?`)) {
    let printedIds: Set<string> = new Set();
    try {
      const saved = localStorage.getItem('printed-items');
      if (saved) printedIds = new Set(JSON.parse(saved));
    } catch(e) {}
    
    selectedItemIds.forEach(id => {
      printedIds.delete(id);
    });
    
    localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
    
    selectedItemIds.clear();
    updateSelectedCountUI();
    renderCards(searchInput.value);
  }
});

batchPrintBtn.addEventListener('click', async () => {
  if (selectedItemIds.size === 0) {
    alert('No items selected.');
    return;
  }
  
  const selectedCards = cards.filter(c => selectedItemIds.has(c.id));
  await bulkPrintCards(selectedCards, batchPrintBtn);
  
  selectedItemIds.clear();
  updateSelectedCountUI();
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
  printPreviewSend.textContent = '💾 Save Template';
  printPreviewBrowser.classList.add('hidden');
  
  const sampleCard = lastClickedCard || cards[0];
  const profile = templateProfiles[activeTemplateId];
  if (profile && profile.lines && profile.lines.length > 0) {
    printLines = JSON.parse(JSON.stringify(profile.lines));
  } else {
    printLines = generateDefaultTemplateLines(sampleCard, shortLabel);
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
  
  const currentSchema = schemaProfiles[activeSchemaId];
  const itemsToRender = currentSchema 
    ? currentSchema.variables.map(v => ({ key: v, value: sampleCard[currentSchema.mapping[v]] || '' }))
    : Object.entries(sampleCard).map(([key, value]) => ({ key, value }));

  for (const { key, value } of itemsToRender) {
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

async function bulkPrintCards(selectedCards: CardData[], btnElement: HTMLButtonElement) {
  if (!activeTransport) {
    alert('Printer not connected! Please connect the printer first.');
    return;
  }

  let printedIds: Set<string> = new Set();
  try {
    const saved = localStorage.getItem('printed-items');
    if (saved) printedIds = new Set(JSON.parse(saved));
  } catch(e) {}

  if (activeTransport.type === 'browser') {
    if (!confirm(`Are you sure you want to open the browser print dialog for all ${selectedCards.length} items?`)) {
      return;
    }
    const originalText = btnElement.textContent;
    btnElement.textContent = 'Preparing Print...';
    btnElement.disabled = true;

    try {
      receiptPaper.innerHTML = '';
      
      for (let i = 0; i < selectedCards.length; i++) {
        const card = selectedCards[i];
        const lines = await getPrintLinesForCard(card);
        
        const cardContainer = document.createElement('div');
        cardContainer.className = 'bulk-print-item';
        if (i < selectedCards.length - 1) {
          cardContainer.style.setProperty('page-break-after', 'always');
          cardContainer.style.setProperty('break-after', 'page');
        }
        
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j];
          if (!line.enabled) continue;
          if (line.isImage && line.imageUrl) {
            const imgWrap = document.createElement('div');
            imgWrap.className = 'receipt-line';
            if (line.align === 'center') imgWrap.classList.add('align-center');
            if (line.align === 'right') imgWrap.classList.add('align-right');
            const img = document.createElement('img');
            img.src = line.imageUrl;
            img.style.maxWidth = 'var(--print-image-width, 80%)';
            img.style.display = 'inline-block';
            img.style.filter = `grayscale(100%) contrast(150%) brightness(${line.gamma || 1.0})`;
            imgWrap.appendChild(img);
            cardContainer.appendChild(imgWrap);
          } else {
            const div = document.createElement('div');
            div.className = 'receipt-line';
            if (line.align === 'center') div.classList.add('align-center');
            if (line.align === 'right') div.classList.add('align-right');
            if (line.bold) div.classList.add('bold');
            if (line.size) div.classList.add('size-' + line.size);
            if (line.isSeparator) {
              div.classList.add('separator');
              div.textContent = '- - - - - - - - - - - - - - - -';
            } else {
              div.textContent = line.text;
            }
            cardContainer.appendChild(div);
          }
        }
        
        receiptPaper.appendChild(cardContainer);
      }
      
      currentEditId = null;
      isTemplateMode = false;
      printPreviewModal.classList.remove('hidden');
      
      await new Promise(r => setTimeout(r, 100));
      await triggerBrowserPrint();
      
      for (const card of selectedCards) {
        const titleKey = Object.keys(card).find(k => k.toLowerCase().includes('brief identifier') || k.toLowerCase().match(/name|title|item/)) || Object.keys(card)[0];
        const title = card[titleKey] || 'Untitled Item';
        addHistoryLog(card.id, title, 'success');
        printedIds.add(card.id);
      }
      localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
      closePrintPreviewModal();
      
    } catch (err: any) {
      alert('Bulk print error: ' + err.message);
    } finally {
      btnElement.textContent = originalText;
      btnElement.disabled = false;
      renderCards(searchInput.value);
    }
    return;
  }
  
  if (!confirm(`Are you sure you want to print ${selectedCards.length} items sequentially?`)) {
    return;
  }
  
  const originalText = btnElement.textContent;
  btnElement.textContent = 'Printing...';
  btnElement.disabled = true;
  
  try {
    for (const card of selectedCards) {
       const titleKey = Object.keys(card).find(k => k.toLowerCase().includes('brief identifier') || k.toLowerCase().match(/name|title|item/)) || Object.keys(card)[0];
       const title = card[titleKey] || 'Untitled Item';
       
       try {
         const lines = await getPrintLinesForCard(card);
         await sendLinesToPrinter(lines);
         addHistoryLog(card.id, title, 'success');
         printedIds.add(card.id);
         localStorage.setItem('printed-items', JSON.stringify([...printedIds]));
       } catch (err: any) {
         addHistoryLog(card.id, title, 'error', err.message);
         console.error("Sequential print failed for", card.id, err);
         throw err;
       }
       
       await new Promise(r => setTimeout(r, 500));
    }
  } catch (err: any) {
    alert('Bulk print error: ' + err.message);
  } finally {
    btnElement.textContent = originalText;
    btnElement.disabled = false;
    renderCards(searchInput.value);
  }
}

function updateSelectedCountUI() {
  if (selectedCount) {
    selectedCount.textContent = `${selectedItemIds.size} items selected`;
  }
}

const printAllUnprintedBtn = document.getElementById('print-all-unprinted-btn') as HTMLButtonElement;
printAllUnprintedBtn.addEventListener('click', async () => {
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
  
  await bulkPrintCards(unprintedCards, printAllUnprintedBtn);
});

exportTemplateBtn.addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(printLines, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  const filename = isTemplateMode ? "receipt-template.json" : "custom-receipt.json";
  downloadAnchorNode.setAttribute("download", filename);
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
  updateMainStatuses();
});

autoPrintToggle.addEventListener('change', () => {
  localStorage.setItem('auto-print', autoPrintToggle.checked.toString());
  updateMainStatuses();
});

liveEditToggle.addEventListener('change', () => {
  localStorage.setItem('live-edit', liveEditToggle.checked.toString());
  if (liveEditToggle.checked) {
    createCustomReceiptBtn.classList.remove('hidden');
    customIdSettings.classList.remove('hidden');
  } else {
    createCustomReceiptBtn.classList.add('hidden');
    customIdSettings.classList.add('hidden');
  }
});

customIdPrefix.addEventListener('input', () => localStorage.setItem('custom-id-prefix', customIdPrefix.value));
customIdNext.addEventListener('input', () => localStorage.setItem('custom-id-next', customIdNext.value));

readOnlyToggle.addEventListener('change', () => {
  localStorage.setItem('read-only', readOnlyToggle.checked.toString());
  if (readOnlyToggle.checked) {
    document.body.classList.add('read-only-mode');
  } else {
    document.body.classList.remove('read-only-mode');
  }
});

fullWidthToggle.addEventListener('change', () => {
  localStorage.setItem('full-width', fullWidthToggle.checked.toString());
  if (fullWidthToggle.checked) {
    appElement.classList.add('full-width');
  } else {
    appElement.classList.remove('full-width');
  }
  applyGridColumns();
});

createCustomReceiptBtn.addEventListener('click', () => {
  const prefix = customIdPrefix.value || 'CUSTOM-';
  const nextNumStr = customIdNext.value || '1000';
  const nextNum = parseInt(nextNumStr, 10);
  const isNumberValid = !isNaN(nextNum);
  
  const newId = prefix + (isNumberValid ? nextNumStr : '1000');
  
  const newCard: CardData = { id: newId };
  
  if (cards.length > 0) {
    // Copy the schema structure from the first card, but leave values blank
    for (const key of Object.keys(cards[0])) {
      if (key !== 'id') newCard[key] = '';
    }
  } else {
    // If no cards exist yet, just create basic default fields
    newCard['Donation #'] = 'Custom';
    newCard['Brief Identifier'] = 'Custom Item';
    newCard['Starting Bid'] = '0';
  }
  
  pendingNewCard = newCard;
  openEditModal(newId, newCard);   // Immediately open the standard edit modal so they can fill it out!
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
      { enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'xs', isSeparator: true },
      { enabled: true, text: `Time: ${new Date().toLocaleString()}`, bold: false, align: 'left', size: 'normal' },
      { enabled: true, text: 'Connection: Web Serial API', bold: false, align: 'left', size: 'normal' },
      { enabled: true, text: 'Status: OK', bold: false, align: 'left', size: 'normal' },
      { enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'xs', isSeparator: true },
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

// Export App Backup
exportAppBackupBtn.addEventListener('click', () => {
  const backup = {
    'csv-url': localStorage.getItem('csv-url'),
    'template-profiles': localStorage.getItem('template-profiles'),
    'active-template-id': localStorage.getItem('active-template-id'),
    'schemaProfiles': localStorage.getItem('schemaProfiles'),
    'activeSchemaId': localStorage.getItem('activeSchemaId'),
    'print-history': localStorage.getItem('print-history'),
    'printed-items': localStorage.getItem('printed-items'),
    'auto-sync': localStorage.getItem('auto-sync'),
    'auto-print': localStorage.getItem('auto-print'),
    'sync-interval': localStorage.getItem('sync-interval'),
    'last-transport-type': localStorage.getItem('last-transport-type'),
    'last-network-ip': localStorage.getItem('last-network-ip'),
    'card-preview-fields': localStorage.getItem('card-preview-fields'),
    'card-preview-fields-order': localStorage.getItem('card-preview-fields-order'),
    'full-width': localStorage.getItem('full-width'),
    'grid-columns': localStorage.getItem('grid-columns'),
  };
  
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", `receipt_dashboard_backup_${Date.now()}.json`);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
});

// Import App Backup
importAppBackupBtn.addEventListener('click', () => {
  appBackupFileInput.click();
});

appBackupFileInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const backup = JSON.parse(event.target?.result as string);
      let count = 0;
      for (const [key, value] of Object.entries(backup)) {
        if (value !== null && value !== undefined) {
          localStorage.setItem(key, value as string);
          count++;
        }
      }
      alert(`Successfully restored ${count} settings! The page will now reload to apply them.`);
      window.location.reload();
    } catch (err: any) {
      alert('Error parsing backup file: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// Reset Factory Defaults
resetAppBtn?.addEventListener('click', () => {
  if (confirm('⚠️ WARNING: This will completely wipe all your templates, mappings, data, and settings! This cannot be undone. Are you absolutely sure?')) {
    localStorage.clear();
    location.reload();
  }
});

// Init
init();
