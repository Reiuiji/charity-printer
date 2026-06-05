# Web Receipt Printer Dashboard

A browser-based, standalone printing dashboard designed to automatically pull data from Google Sheets and print custom receipts, tickets, and labels to ESC/POS thermal printers (like MUNBYN) via USB. 

Because it uses the native **Web Serial API**, there is no need for print drivers, backend servers, or third-party paid services. Everything runs locally in your browser.

Originally developed for [PonyFest](https://ponyfest.horse).

## ✨ Features
*   🔌 **Direct USB Printing**: Native Web Serial API integration communicates directly with ESC/POS thermal printers. Fallbacks available for WebUSB and WebSocket.
*   🔄 **Google Sheets Sync**: Fetches real-time CSV data directly from published Google Sheets.
*   🖨️ **Hands-Free Auto-Print**: Automatically detects new rows in your spreadsheet and prints them in the background without user intervention.
*   🎨 **Drag-and-Drop Template Editor**: Design your master receipt layout right in the browser using dynamic placeholders.
*   🖼️ **Image Rasterization**: Dynamically converts external images to monochrome raster data for thermal printing, with built-in sliders for brightness/contrast adjustment and previewing.
*   🔣 **Offline Barcodes & QR Codes**: Dynamically generates barcodes (Code128, Code39, UPC-A, EAN-13) and QR codes from your spreadsheet data completely offline.
*   💾 **Template & State Export/Import**: Save your custom layouts and entire application configurations as `.json` files to easily deploy to other workstations.
*   ⚙️ **Advanced Hardware Controls**: Fully adjustable post-print feed margins to ensure your paper clears the tearing blade.
*   📋 **Reconciliation Logging**: Keep track of what has been printed and export a CSV log of printed vs. unprinted items.
*   🌗 **Dark/Light Mode**: Premium glassmorphism UI with physically accurate thermal paper rendering in the Print Preview.

## 🚀 Requirements
*   **Browser**: Google Chrome, Microsoft Edge, or Chromium derivatives. (Safari and Firefox **do not** support the Web Serial API).
*   **Hardware**: A USB thermal receipt printer that supports standard ESC/POS commands (e.g., MUNBYN).

## 🛠️ Setup Instructions

### 1. Prepare your Google Sheet
For the app to read your data, your Google Sheet must be published to the web as a CSV.
1. Open your Google Sheet.
2. Go to **File** > **Share** > **Publish to web**.
3. Under the "Link" tab, change the dropdown from "Web page" to **Comma-separated values (.csv)**.
4. Click **Publish** and copy the generated URL.

### 2. Configure the Dashboard
1. Open the Web Receipt Printer application.
2. Paste your Google Sheet CSV URL into the Data Source input box.
3. Click **Fetch Data** to load your spreadsheet into the dashboard.

### 3. Connect the Printer
1. Plug your thermal printer into your computer via USB and turn it on.
2. Click the blue **🖨️ Connect Printer** button in the top right.
3. A browser prompt will appear asking you to select a serial port. Select your USB thermal printer (often labeled as "USB Serial Device" or similar) and click **Connect**.
4. To verify the connection, click the **🧪 Test Print** button to print a diagnostic receipt.

### 4. Design your Master Template
1. Click **⚙️ Edit Base Template**.
2. A helper panel will appear showing all your spreadsheet column headers as `{{Variables}}`.
3. Add new Text, QRs, Barcodes, Images, or Separator lines to your receipt. Paste the `{{Variable}}` strings into the fields (e.g., `Thank you for donating item: {{Brief Identifier}}!`).
4. Reorder lines by dragging the `☰` handle.
5. The live preview on the left will immediately show what the ticket looks like.
6. Click **💾 Save Base Template** when finished. 

Now, whenever you click **Print Unprinted**, the application will dynamically generate the correct ticket for every unprinted row in your spreadsheet.

## 🏗️ Architecture

The codebase is highly modularized for maintainability:
*   `src/main.ts` - The primary DOM orchestrator and UI event handler.
*   `src/template.ts` - Variable interpolation and layout logic engine.
*   `src/printer.ts` - Raw ESC/POS hex-code generation and byte formatting.
*   `src/transport.ts` - Abstract polymorphic connectivity layer (Serial, USB, Socket).
*   `src/types.ts` - Centralized interfaces and app configurations.

## 💻 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```

## 🌐 Deployment
This app can be hosted completely for free on static hosting providers like GitHub Pages or Vercel. A GitHub Actions workflow (`.github/workflows/deploy.yml`) is already included. Simply push the repository to GitHub, enable GitHub Actions, and it will automatically deploy the site for you.

## 🔧 Troubleshooting Printer Connection

### Linux "Access Denied" (WebUSB / Web Serial)
By default, Linux limits access to raw USB and serial devices to the `root` user or specific system groups.

#### 1. For USB (WebUSB)
If you get `Failed to execute 'open' on 'USBDevice': Access denied`, run the included configuration script in the root of the project to create a udev rule:
```bash
./setup-udev-rules.sh
```
Follow the prompts (Option 1 is recommended to authorize all USB printers). Once completed, unplug your printer's USB cable and plug it back in to apply the rules.

#### 2. For Serial (Web Serial)
If you select **Serial** connection type and get access denied when opening the port, ensure your user has access to serial ports. On Fedora/Bazzite/Ubuntu:
- Add your user to the `dialout` group (and/or `uucp` on Arch-based distros):
  ```bash
  sudo usermod -aG dialout $USER
  ```
- **Important**: You must log out of your desktop session and log back in (or reboot) for this group change to take effect.

### Windows 11 "Access Denied" (WebUSB)
On Windows, the operating system automatically claims thermal printers using a default driver (`usbprint.sys`), which blocks the browser from directly opening raw USB interfaces.

#### 1. Recommended: Use "Serial" connection type
Many USB receipt printers actually present themselves as virtual COM serial ports (usually using a CH340 or similar chip). 
- In the connection settings, select **Serial**.
- Click **Connect Printer** and select the port from the browser list (typically labeled `USB Serial Device` or `COM3`, `COM4`, etc.). This method does **not** require any driver modifications on Windows.

#### 2. Using WebUSB with Zadig (Advanced)
If you must use **USB** connection type, you need to replace the printer's driver with the generic Microsoft `WinUSB` driver so Chrome can access it:
1. Download **Zadig** from [zadig.akeo.ie](https://zadig.akeo.ie/).
2. Run Zadig, go to the top menu, select **Options** > check **List All Devices**.
3. In the main dropdown menu, select your thermal printer (e.g. `POS-58` or `USB Printing Support`).
4. In the target driver box (the right side of the green arrow), select **WinUSB**.
5. Click **Replace Driver** or **Reinstall Driver** and wait for it to finish.
6. Refresh the page and try connecting again.
*(Note: Doing this will make the printer inaccessible to standard Windows printer drivers/spoolers unless you revert the driver in Device Manager).*
```,StartLine:79,TargetContent:
