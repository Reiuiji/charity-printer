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

export function generateDefaultTemplateLines(card: CardData, shortLabelFn: (k: string) => string): PrintLine[] {
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
      lines.push({ enabled: true, text: `${shortLabelFn(key)}: {{${key}}}`, bold: false, align: 'center', size: 'normal', isImage: true, imageUrl: `{{${key}}}`, gamma: 1.0 });
      continue;
    }
    lines.push({ enabled: true, text: `${shortLabelFn(key)}: {{${key}}}`, bold: false, align: 'left', size: 'normal' });
  }

  lines.push({ enabled: true, text: '--------------------------------', bold: false, align: 'center', size: 'normal', isSeparator: true });
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
      line.imageUrl = interpolate(line.imageUrl, card, schemaMapping, abstractVariables);
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
