# Web Receipt Printer Dashboard

A browser-based, standalone printing dashboard designed to automatically pull data from Google Sheets and print custom receipts, tickets, and labels to ESC/POS thermal printers (like MUNBYN) via USB. 

Because it uses the native **Web Serial API**, there is no need for print drivers, backend servers, or third-party paid services. Everything runs locally in your browser.

## ✨ Features
*   🔌 **Direct USB Printing**: Native Web Serial API integration communicates directly with ESC/POS thermal printers.
*   🔄 **Google Sheets Sync**: Fetches real-time CSV data directly from published Google Sheets.
*   🖨️ **Hands-Free Auto-Print**: Automatically detects new rows in your spreadsheet and prints them in the background without user intervention.
*   🎨 **Drag-and-Drop Template Editor**: Design your master receipt layout right in the browser using dynamic placeholders.
*   🔣 **Offline Barcodes & QR Codes**: Dynamically generates barcodes and QR codes from your spreadsheet data completely offline (no external APIs used).
*   💾 **Template Export/Import**: Save your custom layouts as `.json` files and load them up for future events.
*   📋 **Reconciliation Logging**: Keep track of what has been printed and export a CSV log of printed vs. unprinted items.
*   🌗 **Dark/Light Mode**: Premium glassmorphism UI that automatically saves your theme preference.

## 🚀 Requirements
*   **Browser**: Google Chrome, Microsoft Edge, or Opera. (Safari and Firefox **do not** support the Web Serial API).
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
3. Click a variable to copy it to your clipboard.
4. Add new Text, QRs, Barcodes, or Separator lines to your receipt. Paste the `{{Variable}}` strings into the fields (e.g., `Thank you for donating item: {{Brief Identifier}}!`).
5. The live preview on the left will immediately show what the ticket looks like using the first row of your spreadsheet.
6. Click **💾 Save Base Template** when finished. 

Now, whenever you click **Print Unprinted**, the application will dynamically generate the correct ticket for every unprinted row in your spreadsheet.

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
