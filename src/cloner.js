/**
 * WebsiteCloner — the core engine (Node.js equivalent of the PHP class)
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const CloneConfig = require('./config');
const {
  sanitizeUrl,
  makeAbsolute,
  getHostname,
  shouldDownload,
  getLocalPath,
  domainToDirName,
  timestamp
} = require('./utils');

class WebsiteCloner {
  /**
   * @param {string} url - Target website URL
   * @param {object} options - Cloning options
   */
  constructor(url, options = {}) {
    this.baseUrl = sanitizeUrl(url);
    this.baseDomain = getHostname(this.baseUrl);
    this.options = {
      downloadImages: options.downloadImages !== false,
      downloadCss: options.downloadCss !== false,
      downloadJs: options.downloadJs !== false,
      followLinks: options.followLinks || false,
      recursive: options.recursive !== false,
      preserveStructure: options.preserveStructure !== false,
      maxDepth: options.maxDepth || CloneConfig.maxDepth,
      ...options
    };

    // State
    this.visited = new Set();
    this.toProcess = [];
    this.totalFiles = 0;
    this.downloadedFiles = 0;
    this.cloneDir = '';

    // Progress callbacks
    this.onLog = options.onLog || console.log;
    this.onProgress = options.onProgress || (() => {});
  }

  /**
   * Initialize the clone directory structure
   */
  async initDirectories() {
    const dirName = `clones/${domainToDirName(this.baseDomain)}_${timestamp()}`;
    this.cloneDir = dirName;

    // Ensure base clones directory
    await fsp.mkdir('clones', { recursive: true });

    // Create the specific clone directory
    await fsp.mkdir(this.cloneDir, { recursive: true });

    this.onLog(`📁 Clone directory: ${this.cloneDir}`);
    return this.cloneDir;
  }

  /**
   * Fetch content from a URL via HTTP GET
   */
  async getContent(url) {
    try {
      const response = await axios.get(url, {
        timeout: 60000,
        maxRedirects: 5,
        headers: {
          'User-Agent': CloneConfig.userAgent
        },
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 400
      });

      const contentType = response.headers['content-type'] || 'application/octet-stream';
      const content = response.data;

      return { content, contentType, status: response.status };
    } catch (err) {
      this.onLog(`❌ Failed to fetch ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * Save content to the local clone directory preserving URL path structure
   */
  async saveFile(url, content, contentType) {
    const urlObj = new URL(url);
    let filePath = urlObj.pathname;

    // Default to index.html for root
    if (!filePath || filePath === '/') {
      filePath = '/index.html';
    }

    // Handle directory-like paths
    if (filePath.endsWith('/')) {
      filePath += 'index.html';
    }

    // If path has no extension, treat as HTML
    const ext = path.extname(filePath);
    if (!ext) {
      filePath += '.html';
    }

    const fullPath = path.join(this.cloneDir, filePath);

    // Create parent directory
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });

    // Write the file
    await fsp.writeFile(fullPath, Buffer.from(content));
    this.downloadedFiles++;

    this.onLog(`💾 Saved: ${filePath}`);
    return fullPath;
  }

  /**
   * Extract all href/src URLs from HTML content
   */
  extractUrls(html, currentUrl) {
    const urls = new Set();
    const hrefRegex = /(?:href|src)\s*=\s*["']([^"'\s]+)["']/gi;
    let match;

    while ((match = hrefRegex.exec(html)) !== null) {
      const raw = match[1];
      try {
        const absolute = makeAbsolute(raw, currentUrl);
        if (shouldDownload(absolute, this.baseDomain)) {
          urls.add(absolute);
        }
      } catch {
        // Skip malformed URLs
      }
    }

    return [...urls];
  }

  /**
   * Check if a URL points to an asset that should be filtered by user options
   */
  isAssetFiltered(url) {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp'];
    const cssExts = ['.css'];
    const jsExts = ['.js'];

    if (!this.options.downloadImages && imageExts.includes(ext)) return true;
    if (!this.options.downloadCss && cssExts.includes(ext)) return true;
    if (!this.options.downloadJs && jsExts.includes(ext)) return true;

    return false;
  }

  /**
   * Rewrite asset URLs in HTML to point to local copies
   */
  processAssets(html) {
    // Rewrite href/src attributes
    html = html.replace(
      /(href|src)\s*=\s*["']([^"'\s]+)["']/gi,
      (match, attr, url) => {
        try {
          const absolute = makeAbsolute(url, this.baseUrl);
          const localPath = getLocalPath(absolute);
          return `${attr}="${localPath}"`;
        } catch {
          return match;
        }
      }
    );

    // Rewrite url() references in CSS
    html = html.replace(
      /url\(\s*["']?([^"'\s)]+)["']?\s*\)/gi,
      (match, url) => {
        try {
          const absolute = makeAbsolute(url, this.baseUrl);
          const localPath = getLocalPath(absolute);
          return `url("${localPath}")`;
        } catch {
          return match;
        }
      }
    );

    return html;
  }

  /**
   * Create a ZIP archive of the cloned directory
   */
  async createZip() {
    const zipName = `${this.cloneDir}.zip`;

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipName);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        this.onLog(`📦 ZIP created: ${zipName} (${archive.pointer()} bytes)`);
        resolve(zipName);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // Add the clone directory contents
      archive.directory(this.cloneDir, false);

      archive.finalize();
    });
  }

  /**
   * Main cloning process — orchestrates crawl + download
   */
  async startCloning() {
    this.onLog(`🚀 Starting clone of: ${this.baseUrl}`);
    await this.initDirectories();

    this.toProcess.push(this.baseUrl);
    let depth = 0;

    while (this.toProcess.length > 0 && depth < this.options.maxDepth) {
      const currentBatch = [...this.toProcess];
      this.toProcess = [];

      for (const url of currentBatch) {
        if (this.visited.has(url)) continue;

        // Apply asset filtering
        try {
          if (this.isAssetFiltered(url)) {
            this.visited.add(url);
            continue;
          }
        } catch {
          // Not a valid URL for filtering, continue
        }

        this.onLog(`📥 Processing: ${url}`);
        const result = await this.getContent(url);

        if (!result) {
          this.visited.add(url);
          continue;
        }

        this.visited.add(url);

        const { content, contentType } = result;
        const contentStr = Buffer.from(content).toString('utf-8');
        const isHtml = contentType.includes('text/html');

        if (isHtml) {
          // Rewrite asset paths in HTML
          const processedHtml = this.processAssets(contentStr);
          await this.saveFile(url, processedHtml, 'text/html');

          // Extract more URLs for crawling
          if (this.options.recursive || this.options.followLinks) {
            const newUrls = this.extractUrls(contentStr, url);
            for (const nu of newUrls) {
              if (!this.visited.has(nu) && !this.toProcess.includes(nu)) {
                this.toProcess.push(nu);
              }
            }
          }
        } else {
          // Save asset (CSS, JS, images, etc.)
          await this.saveFile(url, content, contentType);
        }

        // Report progress
        this.onProgress({
          visited: this.visited.size,
          downloaded: this.downloadedFiles,
          queue: this.toProcess.length,
          depth
        });
      }

      depth++;
      this.onLog(`--- Depth ${depth} complete (${this.visited.size} visited, ${this.downloadedFiles} files) ---`);
    }

    // Create ZIP
    this.onLog('✅ Cloning complete! Creating ZIP...');
    const zipFile = await this.createZip();

    return {
      visited: this.visited.size,
      downloaded: this.downloadedFiles,
      cloneDir: this.cloneDir,
      zipFile
    };
  }
}

module.exports = WebsiteCloner;
