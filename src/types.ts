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
  rasterData?: Uint8Array[];
  gamma?: number;
  isQr?: boolean;
  isBarcode?: boolean;
  barcodeFormat?: string;
  isLoop?: boolean;
  subLines?: PrintLine[];
  loopHeader?: PrintLine;
  loopHeaderSeparator?: PrintLine;
}

export interface TemplateProfile {
  id: string;
  name: string;
  lines: PrintLine[];
}

export type SchemaMapping = Record<string, string>; // e.g. { "Item Name": "Brief Identifier" }

export interface SchemaProfile {
  id: string;
  name: string;
  variables: string[];
  mapping: SchemaMapping;
}

export type TemplateAssignments = Record<string, string>; // e.g. { "card-id-123": "template-id-456" }

export interface PrintHistoryLog {
  timestamp: number;
  id: string;
  title: string;
  status: 'success' | 'error';
  errorMessage?: string;
}
