import type { PrintLine } from './types';
import type { PrinterTransport } from './transport';

// ESC/POS Constants
export const ESC = 0x1B;
export const GS = 0x1D;

export async function sendLinesToPrinter(
  lines: PrintLine[], 
  transport: PrinterTransport | null, 
  feedLines: number = 4
) {
  if (!transport) throw new Error('Printer not connected! Please connect the printer first.');
  const enabledLines = lines.filter(l => l.enabled);
  if (enabledLines.length === 0) return;

  const textEncoder = new TextEncoder();

  try {
    // Init printer
    await transport.write(new Uint8Array([ESC, 0x40]));

    for (const line of enabledLines) {
      if (line.isImage && line.imageUrl) {
        if (!line.rasterData) {
          throw new Error("Images must be converted to raster data before calling sendLinesToPrinter in the new architecture.");
        }
        const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
        await transport.write(new Uint8Array([ESC, 0x61, alignByte]));
        await transport.write(line.rasterData);
      } else {
        // Alignment
        const alignByte = line.align === 'center' ? 0x01 : line.align === 'right' ? 0x02 : 0x00;
        await transport.write(new Uint8Array([ESC, 0x61, alignByte]));

        // Size and Font
        if (line.size === 'xl') {
          await transport.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await transport.write(new Uint8Array([GS, 0x21, 0x22]));  // Triple height/width
        } else if (line.size === 'large') {
          await transport.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await transport.write(new Uint8Array([GS, 0x21, 0x11]));  // Double height/width
        } else if (line.size === 'small') {
          await transport.write(new Uint8Array([ESC, 0x4D, 0x01])); // Font B
          await transport.write(new Uint8Array([GS, 0x21, 0x00]));
        } else if (line.size === 'xs') {
          await transport.write(new Uint8Array([ESC, 0x4D, 0x01])); // Font B
          await transport.write(new Uint8Array([GS, 0x21, 0x00]));
        } else {
          await transport.write(new Uint8Array([ESC, 0x4D, 0x00])); // Font A
          await transport.write(new Uint8Array([GS, 0x21, 0x00]));
        }

        // Bold
        await transport.write(new Uint8Array([ESC, 0x45, line.bold ? 0x01 : 0x00]));

        // Text
        await transport.write(textEncoder.encode(line.text + '\n'));
      }
    }

    // Reset
    await transport.write(new Uint8Array([GS, 0x21, 0x00]));
    await transport.write(new Uint8Array([ESC, 0x45, 0x00]));

    // Feed & cut
    const feedArray = Array(feedLines).fill(0x0A);
    await transport.write(new Uint8Array(feedArray));
    await transport.write(new Uint8Array([GS, 0x56, 0x41, 0x10]));
  } catch (err: any) {
    throw new Error('Print error: ' + err.message);
  }
}
