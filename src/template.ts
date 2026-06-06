import type { CardData, PrintLine } from './types';

export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export function interpolate(
  templateString: string, 
  card: CardData, 
  schemaMapping?: Record<string, string>, 
  abstractVariables?: string[]
): string {
  if (!templateString) return '';
  let result = templateString;
  
  const data = { ...card };
  if (schemaMapping && abstractVariables) {
    for (const av of abstractVariables) {
      if (schemaMapping[av] && card[schemaMapping[av]] !== undefined) {
        data[av] = card[schemaMapping[av]];
      }
    }
  }

  for (const [key, value] of Object.entries(data)) {
    const escapedKey = escapeRegExp(key);
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'gi');
    result = result.replace(regex, (value as string) || '');
  }
  return result;
}

export function generateDefaultTemplateLines(_card: CardData, _shortLabelFn: (k: string) => string): PrintLine[] {
  const lines: PrintLine[] = [];
  lines.push({ enabled: true, text: `{{Item Name}}`, bold: true, align: 'center', size: 'large' });
  lines.push({ enabled: true, text: `Donation #{{Number}}`, bold: false, align: 'center', size: 'normal' });
  lines.push({ enabled: true, text: '-------------------------', bold: false, align: 'center', size: 'xs', isSeparator: true });
  
  lines.push({ enabled: true, text: `Donor: {{Donor}}`, bold: false, align: 'left', size: 'normal' });
  lines.push({ enabled: true, text: `Price: {{Price}}`, bold: false, align: 'left', size: 'normal' });
  lines.push({ enabled: true, text: `Description: {{Description}}`, bold: false, align: 'left', size: 'small' });
  
  lines.push({ enabled: true, text: ``, bold: false, align: 'center', size: 'normal', isImage: true, imageUrl: `{{Image}}`, gamma: 1.0 });

  lines.push({ enabled: true, text: '-------------------------', bold: false, align: 'center', size: 'xs', isSeparator: true });
  return lines;
}

export async function generatePrintLines(
  card: CardData, 
  baseLines: PrintLine[],
  updateBarcodeQrImageFn: (line: PrintLine, index: number) => Promise<void>,
  schemaMapping?: Record<string, string>,
  abstractVariables?: string[]
): Promise<PrintLine[]> {
  const lines: PrintLine[] = [];
  for (const tLine of baseLines) {
    const line = { ...tLine };
    if (!line.enabled) continue;
    
    line.text = interpolate(line.text, card, schemaMapping, abstractVariables);
    if (line.isImage && line.imageUrl && !line.isQr && !line.isBarcode) {
      line.imageUrl = normalizeImageUrl(interpolate(line.imageUrl, card, schemaMapping, abstractVariables));
      if (line.imageUrl && !line.imageUrl.startsWith('http') && !line.imageUrl.startsWith('data:')) {
        // Data is not a valid URL (e.g. text like 'None' or 'Yes'). Fallback to text mode.
        line.isImage = false;
        if (!line.text) line.text = line.imageUrl; // Just in case
      }
    }
    
    if (line.isQr || line.isBarcode) {
      await updateBarcodeQrImageFn(line, -1);
    }
    lines.push(line);
  }
  return lines;
}

export function normalizeImageUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  
  if (trimmed.includes('drive.google.com') || trimmed.includes('docs.google.com')) {
    let fileId = '';
    try {
      const urlObj = new URL(trimmed);
      fileId = urlObj.searchParams.get('id') || '';
    } catch (e) {}
    
    if (!fileId) {
      const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        fileId = match[1];
      }
    }
    
    if (fileId) {
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w600`;
    }
  }
  
  return trimmed;
}
