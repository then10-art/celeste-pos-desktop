/**
 * Celeste POS - Print Debug Logger
 * Captures detailed info about every print attempt for diagnostics.
 * Log file: %APPDATA%/celeste-pos/print-debug.log (last 50 entries)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Log file location - in app data directory
const LOG_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'celeste-pos');
const LOG_FILE = path.join(LOG_DIR, 'print-debug.log');
const MAX_ENTRIES = 50;

let lastPrintLog = null;

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch { /* ignore */ }
}

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Log a print attempt with full diagnostic info
 */
function logPrintAttempt(entry) {
  ensureLogDir();
  
  const logEntry = {
    timestamp: getTimestamp(),
    ...entry,
  };
  
  lastPrintLog = logEntry;
  
  // Append to log file
  try {
    const line = `\n${'='.repeat(60)}\n${JSON.stringify(logEntry, null, 2)}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
    
    // Trim log file if too large (keep last 50 entries)
    trimLogFile();
  } catch (err) {
    console.warn('[PrintLogger] Failed to write log:', err.message);
  }
  
  return logEntry;
}

/**
 * Log the start of a print job
 */
function logPrintStart(data) {
  const entry = {
    event: 'PRINT_START',
    printerName: data.printerName || 'unknown',
    printMode: data.printMode || 'unknown',
    paperSize: data.paperSize || '80',
    dataType: typeof data.receiptData,
    hasStoreName: !!(data.receiptData && data.receiptData.storeName),
    hasItems: !!(data.receiptData && data.receiptData.items),
    itemCount: data.receiptData?.items?.length || 0,
    hasLines: !!(data.receiptData && data.receiptData.lines),
    lineCount: data.receiptData?.lines?.length || 0,
    total: data.receiptData?.total || 'N/A',
    ticketNumber: data.receiptData?.ticketNumber || 'N/A',
    isHtmlString: typeof data.receiptData === 'string',
  };
  
  console.log('[PrintLogger] START:', JSON.stringify(entry));
  return logPrintAttempt(entry);
}

/**
 * Log after convertReceiptDataToLines
 */
function logConversion(data) {
  const entry = {
    event: 'DATA_CONVERSION',
    inputHadLines: data.inputHadLines,
    inputHadStoreNameAndItems: data.inputHadStoreNameAndItems,
    outputLineCount: data.outputLineCount,
    sampleLines: (data.sampleLines || []).slice(0, 5), // First 5 lines for debugging
    escPosBytes: data.escPosBytes || 0,
  };
  
  console.log('[PrintLogger] CONVERSION:', JSON.stringify(entry));
  return logPrintAttempt(entry);
}

/**
 * Log the result of a print attempt
 */
function logPrintResult(data) {
  const entry = {
    event: 'PRINT_RESULT',
    success: data.success,
    method: data.method || 'unknown',
    error: data.error || null,
    bytesWritten: data.bytesWritten || 0,
    printerName: data.printerName || 'unknown',
    duration: data.duration || 0,
  };
  
  console.log('[PrintLogger] RESULT:', JSON.stringify(entry));
  return logPrintAttempt(entry);
}

/**
 * Log printer detection info
 */
function logPrinterDetection(data) {
  const entry = {
    event: 'PRINTER_DETECTION',
    configuredName: data.configuredName || '',
    detectedName: data.detectedName || '',
    allPrinters: data.allPrinters || [],
    printMode: data.printMode || 'unknown',
  };
  
  console.log('[PrintLogger] DETECTION:', JSON.stringify(entry));
  return logPrintAttempt(entry);
}

/**
 * Get the last print log entry
 */
function getLastPrintLog() {
  return lastPrintLog;
}

/**
 * Get the full log file contents
 */
function getFullLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      return fs.readFileSync(LOG_FILE, 'utf-8');
    }
  } catch { /* ignore */ }
  return 'No print log available yet.';
}

/**
 * Get log file path
 */
function getLogFilePath() {
  return LOG_FILE;
}

function trimLogFile() {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const entries = content.split('='.repeat(60)).filter(e => e.trim());
    if (entries.length > MAX_ENTRIES) {
      const trimmed = entries.slice(-MAX_ENTRIES).join('='.repeat(60));
      fs.writeFileSync(LOG_FILE, trimmed, 'utf-8');
    }
  } catch { /* ignore */ }
}

module.exports = {
  logPrintStart,
  logConversion,
  logPrintResult,
  logPrinterDetection,
  getLastPrintLog,
  getFullLog,
  getLogFilePath,
};
