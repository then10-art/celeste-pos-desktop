/**
 * Celeste POS - Bitmap ESC/POS Printer Module
 * 
 * Renders receipt HTML to a high-contrast bitmap and sends it as
 * ESC/POS raster commands to the thermal printer.
 * 
 * This produces output identical to the web app preview — with logo,
 * icons, formatting — but printed crisp and dark via native ESC/POS.
 * 
 * Flow:
 *   1. Load HTML in hidden BrowserWindow at exact printer pixel width
 *   2. Wait for images/fonts to load
 *   3. Capture page as PNG bitmap via webContents.capturePage()
 *   4. Convert to 1-bit black & white (threshold)
 *   5. Build ESC/POS raster commands (GS v 0)
 *   6. Send raw bytes via Windows print spooler (ps-pinvoke)
 */

const { BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// POS-80 thermal printer specs
const PRINTER_DPI = 203;
const PAPER_WIDTH_MM = 72; // Printable area (80mm paper - margins)
const PIXELS_PER_LINE = Math.round(PAPER_WIDTH_MM * PRINTER_DPI / 25.4); // 576px
const BYTES_PER_LINE = Math.ceil(PIXELS_PER_LINE / 8); // 72 bytes

/**
 * Print receipt HTML as a bitmap via ESC/POS raster commands.
 * 
 * @param {string} html - Full HTML receipt document
 * @param {string} printerName - Windows printer name
 * @param {string} paperSize - '80' or '58'
 * @param {Function} sendRawFn - Function to send raw bytes to printer (sendRawToPrinter)
 * @returns {Promise<{success: boolean, method: string, error?: string}>}
 */
async function printReceiptBitmap(html, printerName, paperSize = '80', sendRawFn) {
  if (!printerName) throw new Error('No printer configured for bitmap printing');
  if (!sendRawFn) throw new Error('sendRawToPrinter function required');

  const widthMm = (paperSize === '58') ? 48 : 72; // printable area
  const pixelWidth = Math.round(widthMm * PRINTER_DPI / 25.4);
  const bytesPerLine = Math.ceil(pixelWidth / 8);

  console.log(`[BitmapPrint] Starting: printer=${printerName}, paper=${paperSize}mm, width=${pixelWidth}px`);

  try {
    // Step 1: Render HTML to bitmap
    const bitmap = await renderHTMLToBitmap(html, pixelWidth);
    console.log(`[BitmapPrint] Rendered bitmap: ${bitmap.width}x${bitmap.height}px`);

    // Step 2: Convert to 1-bit black & white
    const monoData = convertToMonochrome(bitmap.data, bitmap.width, bitmap.height);
    console.log(`[BitmapPrint] Converted to monochrome: ${monoData.length} bytes`);

    // Step 3: Build ESC/POS raster commands
    const escposData = buildRasterCommands(monoData, bytesPerLine, bitmap.height, pixelWidth);
    console.log(`[BitmapPrint] ESC/POS data: ${escposData.length} bytes`);

    // Step 4: Send to printer
    const result = await sendRawFn(escposData, printerName);
    console.log(`[BitmapPrint] Print result:`, result);

    return { success: true, method: 'bitmap-escpos', bytes: escposData.length };
  } catch (err) {
    console.error(`[BitmapPrint] Error:`, err.message);
    throw err;
  }
}

/**
 * Render HTML in a hidden BrowserWindow and capture as raw RGBA pixels.
 */
function renderHTMLToBitmap(html, targetWidth) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `celeste-bitmap-${Date.now()}.html`);
    
    // Inject CSS to force exact width and high contrast
    const enhancedHtml = html.replace('</head>', `
      <style>
        /* Force high contrast for thermal printing */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { 
          width: ${targetWidth}px !important; 
          max-width: ${targetWidth}px !important;
          margin: 0 !important;
          padding: 8px !important;
          background: #fff !important;
          color: #000 !important;
          font-weight: bold !important;
        }
        /* Make all text bolder for thermal print clarity */
        p, span, td, th, div, li { font-weight: bold !important; }
        .store-name { font-weight: 900 !important; font-size: 20px !important; }
        .total-row { font-weight: 900 !important; }
        /* Ensure borders are solid black */
        .divider { border-top: 2px solid #000 !important; }
        .divider-double { border-top: 3px solid #000 !important; }
        /* Remove any grey text - make everything black */
        * { color: #000 !important; }
        /* Ensure images render at high quality */
        img { image-rendering: -webkit-optimize-contrast; }
      </style>
    </head>`);

    fs.writeFileSync(tmpFile, enhancedHtml, 'utf-8');

    // Create BrowserWindow at exact pixel width
    // Height is tall to accommodate any receipt length
    const printWin = new BrowserWindow({
      show: false,
      width: targetWidth,
      height: 4000, // Tall enough for any receipt
      webPreferences: { 
        nodeIntegration: false, 
        contextIsolation: true,
        offscreen: true, // Enable offscreen rendering for better capture
      },
    });

    // Set the window content size to exact pixel width
    printWin.setContentSize(targetWidth, 4000);

    printWin.loadFile(tmpFile);

    printWin.webContents.on('did-finish-load', () => {
      // Wait for images and fonts to fully load
      setTimeout(async () => {
        try {
          // Get the actual content height by executing JS in the page
          const contentHeight = await printWin.webContents.executeJavaScript(
            'document.body.scrollHeight'
          );

          // Resize window to exact content height
          printWin.setContentSize(targetWidth, contentHeight);

          // Wait a bit for resize to take effect
          await new Promise(r => setTimeout(r, 500));

          // Capture the full page
          const image = await printWin.webContents.capturePage({
            x: 0,
            y: 0,
            width: targetWidth,
            height: contentHeight,
          });

          printWin.close();
          try { fs.unlinkSync(tmpFile); } catch {}

          // Get raw bitmap data
          const pngBuffer = image.toPNG();
          
          // Decode PNG to raw RGBA pixels
          // We'll use the nativeImage to get the bitmap
          const size = image.getSize();
          const bitmap = image.toBitmap();

          resolve({
            data: bitmap, // Raw RGBA pixel data
            width: size.width,
            height: size.height,
          });
        } catch (err) {
          printWin.close();
          try { fs.unlinkSync(tmpFile); } catch {}
          reject(err);
        }
      }, 3000); // Wait 3s for images/fonts to fully render
    });

    printWin.webContents.on('did-fail-load', (_event, _code, desc) => {
      try { printWin.close(); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`Failed to load receipt HTML: ${desc}`));
    });

    // Timeout safety
    setTimeout(() => {
      try { printWin.close(); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error('Bitmap render timeout (30s)'));
    }, 30000);
  });
}

/**
 * Convert RGBA bitmap data to 1-bit monochrome.
 * Uses a threshold to determine black vs white.
 * Each pixel becomes 1 bit: 1 = black (print), 0 = white (no print).
 * 
 * @param {Buffer} rgbaData - Raw RGBA pixel data (4 bytes per pixel)
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Buffer} - Monochrome bitmap (1 bit per pixel, packed into bytes, MSB first)
 */
function convertToMonochrome(rgbaData, width, height) {
  const bytesPerRow = Math.ceil(width / 8);
  const monoData = Buffer.alloc(bytesPerRow * height, 0);

  // Threshold: pixels darker than this become black (printed)
  // Lower threshold = more black (darker print)
  const THRESHOLD = 128;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * 4;
      const r = rgbaData[pixelOffset];
      const g = rgbaData[pixelOffset + 1];
      const b = rgbaData[pixelOffset + 2];
      const a = rgbaData[pixelOffset + 3];

      // Calculate luminance (perceived brightness)
      // If pixel is transparent, treat as white
      let luminance;
      if (a < 128) {
        luminance = 255; // Transparent = white
      } else {
        luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }

      // If pixel is dark (below threshold), set bit to 1 (black = print)
      if (luminance < THRESHOLD) {
        const byteIndex = y * bytesPerRow + Math.floor(x / 8);
        const bitPosition = 7 - (x % 8); // MSB first
        monoData[byteIndex] |= (1 << bitPosition);
      }
    }
  }

  return monoData;
}

/**
 * Build ESC/POS raster bitmap commands.
 * Uses GS v 0 (Print raster bit image) command.
 * 
 * Format: GS v 0 m xL xH yL yH d1...dk
 *   m = 0 (normal density)
 *   xL xH = bytes per line (width / 8)
 *   yL yH = number of lines (height)
 *   d1...dk = bitmap data
 * 
 * For large images, we split into chunks of max 255 lines each
 * to avoid buffer overflow on some printers.
 * 
 * @param {Buffer} monoData - Monochrome bitmap data
 * @param {number} bytesPerLine - Bytes per line (width / 8)
 * @param {number} height - Total height in pixels/lines
 * @param {number} pixelWidth - Width in pixels (for alignment)
 * @returns {Buffer} - Complete ESC/POS command buffer
 */
function buildRasterCommands(monoData, bytesPerLine, height, pixelWidth) {
  const chunks = [];

  // ESC @ - Initialize printer
  chunks.push(Buffer.from([0x1B, 0x40]));

  // ESC a 1 - Center alignment
  chunks.push(Buffer.from([0x1B, 0x61, 0x01]));

  // Set line spacing to 0 for seamless bitmap printing
  // ESC 3 n - Set line spacing to n/180 inch
  chunks.push(Buffer.from([0x1B, 0x33, 0x00]));

  // Print bitmap in chunks (max 255 lines per GS v 0 command for compatibility)
  const MAX_CHUNK_LINES = 255;
  let linesRemaining = height;
  let offset = 0;

  while (linesRemaining > 0) {
    const chunkLines = Math.min(linesRemaining, MAX_CHUNK_LINES);
    const chunkDataSize = bytesPerLine * chunkLines;

    // GS v 0 - Print raster bit image
    // 1D 76 30 m xL xH yL yH d1...dk
    const cmd = Buffer.alloc(8 + chunkDataSize);
    cmd[0] = 0x1D; // GS
    cmd[1] = 0x76; // v
    cmd[2] = 0x30; // 0
    cmd[3] = 0x00; // m = 0 (normal density, 203 DPI)
    cmd[4] = bytesPerLine & 0xFF;        // xL
    cmd[5] = (bytesPerLine >> 8) & 0xFF;  // xH
    cmd[6] = chunkLines & 0xFF;           // yL
    cmd[7] = (chunkLines >> 8) & 0xFF;    // yH

    // Copy bitmap data for this chunk
    monoData.copy(cmd, 8, offset, offset + chunkDataSize);

    chunks.push(cmd);
    offset += chunkDataSize;
    linesRemaining -= chunkLines;
  }

  // Feed paper after printing (5 lines)
  chunks.push(Buffer.from([0x1B, 0x64, 0x05])); // ESC d 5 - Feed 5 lines

  // Cut paper (partial cut)
  chunks.push(Buffer.from([0x1D, 0x56, 0x42, 0x00])); // GS V B 0

  return Buffer.concat(chunks);
}

module.exports = {
  printReceiptBitmap,
  renderHTMLToBitmap,
  convertToMonochrome,
  buildRasterCommands,
  PRINTER_DPI,
  PIXELS_PER_LINE,
  BYTES_PER_LINE,
};
