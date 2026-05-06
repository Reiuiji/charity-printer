export interface CardData {
  id: string; // Unique identifier
  [key: string]: string;
}

export interface PrintLine {
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

export interface TemplateProfile {
  id: string;
  name: string;
  lines: PrintLine[];
}

export interface PrintHistoryLog {
  timestamp: number;
  id: string;
  title: string;
  status: 'success' | 'error';
  errorMessage?: string;
}
