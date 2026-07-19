/**
 * Express server — entry point for Vercel serverless deployment
 * Handles the web UI and cloning API endpoints
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const WebsiteCloner = require('../src/cloner');
const { sanitizeUrl } = require('../src/utils');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve static files from clones/ and zip files
app.use('/clones', express.static(path.join(__dirname, '..', 'clones')));

// ============================================================
// API Endpoints
// ============================================================

/**
 * POST /api/clone
 * Main endpoint — triggers the cloning process
 */
app.post('/api/clone', async (req, res) => {
  const { url, downloadImages, downloadCss, downloadJs, followLinks, recursive, preserveStructure } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let sanitized;
  try {
    sanitized = sanitizeUrl(url);
    new URL(sanitized); // validate
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const logs = [];
  const cloner = new WebsiteCloner(sanitized, {
    downloadImages: downloadImages !== false,
    downloadCss: downloadCss !== false,
    downloadJs: downloadJs !== false,
    followLinks: followLinks === true || followLinks === 'true',
    recursive: recursive !== false && recursive !== 'false',
    preserveStructure: preserveStructure !== false,
    onLog: (msg) => {
      logs.push(msg);
      console.log(msg);
    }
  });

  try {
    const result = await cloner.startCloning();
    res.json({
      success: true,
      logs,
      result
    });
  } catch (err) {
    console.error('Cloning error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      logs
    });
  }
});

/**
 * GET /api/status
 * Health-check endpoint
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    version: '2.0.0',
    name: 'Advanced Website Cloner'
  });
});

/**
 * GET /api/download/:zipname
 * Serve a previously created clone ZIP
 */
app.get('/api/download/:zipname', (req, res) => {
  const zipPath = path.join(__dirname, '..', req.params.zipname);
  if (fs.existsSync(zipPath)) {
    res.download(zipPath);
  } else {
    res.status(404).json({ error: 'ZIP file not found' });
  }
});

// ============================================================
// Fallback: serve the UI for all non-API routes
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// Start server (for local dev) OR export (for Vercel)
// ============================================================
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🌐 Advanced Website Cloner running at http://localhost:${PORT}`);
  });
}

module.exports = app;
