/**
 * Website Cloner Configuration
 * Mirrors the original PHP CloneConfig class
 */

const CloneConfig = {
  maxFileSize: 50 * 1024 * 1024, // 50MB per file
  allowedDomains: [],             // Empty = only same domain allowed
  excludeExtensions: ['mp4', 'avi', 'mkv', 'mp3'],
  maxDepth: 10,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

module.exports = CloneConfig;
