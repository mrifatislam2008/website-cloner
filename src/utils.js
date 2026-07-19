/**
 * Utility functions — equivalents of sanitizeUrl, makeAbsolute, shouldDownload, etc.
 */

const path = require('path');
const CloneConfig = require('./config');

/**
 * Ensure a URL has a protocol
 */
function sanitizeUrl(url) {
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Resolve a possibly-relative URL against a base URL
 */
function makeAbsolute(url, base) {
  // Already absolute
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  // Protocol-relative
  if (url.startsWith('//')) {
    const protocol = new URL(base).protocol;
    return protocol + url;
  }

  // Root-relative
  if (url.startsWith('/')) {
    const parsed = new URL(base);
    return parsed.origin + url;
  }

  // Regular relative — join with base directory
  const baseUrl = new URL(base);
  // Ensure base ends with a slash for correct resolution
  const baseStr = base.endsWith('/') ? base : base.substring(0, base.lastIndexOf('/') + 1);
  return new URL(url, baseStr).href;
}

/**
 * Extract hostname from URL
 */
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a URL should be downloaded based on configuration
 */
function shouldDownload(url, baseDomain) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const ext = path.extname(parsed.pathname).replace('.', '').toLowerCase();

    // Domain check
    if (CloneConfig.allowedDomains.length > 0) {
      const allowed = CloneConfig.allowedDomains.includes(host) || host === baseDomain;
      if (!allowed) return false;
    } else {
      if (host !== baseDomain) return false;
    }

    // Extension exclusion
    if (CloneConfig.excludeExtensions.includes(ext)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Get a relative local path from a URL (for rewriting asset references)
 */
function getLocalPath(url) {
  try {
    const parsed = new URL(url);
    let filePath = parsed.pathname;
    if (!filePath || filePath === '/') {
      filePath = '/index.html';
    }
    // If path ends with a slash, serve index.html from that directory
    if (filePath.endsWith('/')) {
      filePath += 'index.html';
    }
    return '.' + filePath;
  } catch {
    return url;
  }
}

/**
 * Create a safe directory name from a domain
 */
function domainToDirName(domain) {
  return domain.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Generate a timestamp string for directory naming
 */
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

module.exports = {
  sanitizeUrl,
  makeAbsolute,
  getHostname,
  shouldDownload,
  getLocalPath,
  domainToDirName,
  timestamp
};
