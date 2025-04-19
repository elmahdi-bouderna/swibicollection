const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');
// Required modules for export functionality
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
// Add JWT for token verification
const jwt = require('jsonwebtoken');
// Add this at the top with other imports
const { notifyNewOrder, notifyLowStock } = require('../services/notificationService');

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Store active download tokens with expiration times
const downloadTokens = new Map();

// Create a download token
function createDownloadToken(filename) {
  const token = Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
  
  // Token expires in 5 minutes
  const expiresAt = Date.now() + (5 * 60 * 1000);
  
  downloadTokens.set(token, {
    filename,
    expiresAt
  });
  
  return token;
}

// Verify a download token
function verifyDownloadToken(token) {
  const fileInfo = downloadTokens.get(token);
  
  if (!fileInfo) {
    return null;
  }
  
  // Check if token has expired
  if (Date.now() > fileInfo.expiresAt) {
    downloadTokens.delete(token);
    return null;
  }
  
  // Token is valid, delete it after use
  downloadTokens.delete(token);
  return fileInfo;
}

// @route   POST api/orders/prepare-export
// @desc    Prepare order export and return a download link
// @access  Private (admin only)
router.post('/prepare-export', auth, async (req, res) => {
  try {
    const { format: exportFormat, status, startDate, endDate, orderId } = req.body;
    
    // Validate export format
    if (!['excel', 'pdf', 'word'].includes(exportFormat)) {
      return res.status(400).json({ msg: 'Invalid export format' });
    }
    
    // Build the query to fetch orders
    let query = 'SELECT * FROM orders';
    const queryParams = [];
    const whereClauses = [];
    
    // Add filter by specific order ID if provided
    if (orderId) {
      whereClauses.push('id = ?');
      queryParams.push(orderId);
    }
    
    // Add status filter if provided
    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      queryParams.push(status);
    }
    
    // Add date range filters if provided
    if (startDate) {
      whereClauses.push('order_date >= ?');
      queryParams.push(`${startDate} 00:00:00`);
    }
    
    if (endDate) {
      whereClauses.push('order_date <= ?');
      queryParams.push(`${endDate} 23:59:59`);
    }
    
    // Add WHERE clause if any filters are applied
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    // Sort by order date
    query += ' ORDER BY order_date DESC';
    
    console.log('Export query:', query);
    console.log('Export params:', queryParams);
    
    // Execute the query
    const [orders] = await db.query(query, queryParams);
    
    console.log(`Found ${orders.length} orders for export`);
    
    // Get items for each order
    for (const order of orders) {
      const [items] = await db.query(`
        SELECT oi.*, p.name_fr as product_name, p.name_ar as product_name_ar
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      order.items = items;
    }
    
    // Generate a unique filename
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const randomId = Math.random().toString(36).substring(2, 10);
    let filename, filePath, mimeType;
    
    // Generate the file based on export format
    switch (exportFormat) {
      case 'excel':
        filename = `orders_${timestamp}_${randomId}.xlsx`;
        filePath = path.join(tempDir, filename);
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        await generateExcelFile(orders, filePath);
        break;
      case 'pdf':
        filename = `orders_${timestamp}_${randomId}.pdf`;
        filePath = path.join(tempDir, filename);
        mimeType = 'application/pdf';
        await generatePdfFile(orders, filePath);
        break;
      case 'word':
        filename = `orders_${timestamp}_${randomId}.doc`;
        filePath = path.join(tempDir, filename);
        mimeType = 'application/msword';
        await generateWordFile(orders, filePath);
        break;
    }
    
    // Create a download URL - valid for 5 minutes
    const downloadToken = createDownloadToken(filename);
    const downloadUrl = `/api/orders/download/${downloadToken}`;
    
    // Return the download URL
    res.json({
      success: true, 
      downloadUrl, 
      filename,
      mimeType
    });
    
  } catch (err) {
    console.error('Error preparing export:', err);
    res.status(500).json({ error: 'Error during export preparation', details: err.message });
  }
});

// @route   GET api/orders/download/:token
// @desc    Download a prepared export file
// @access  Public (with valid token)
router.get('/download/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const fileInfo = verifyDownloadToken(token);
    
    if (!fileInfo) {
      return res.status(401).json({ error: 'Invalid or expired download token' });
    }
    
    const filePath = path.join(tempDir, fileInfo.filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Determine content type from filename
    let contentType = 'application/octet-stream';
    if (fileInfo.filename.endsWith('.xlsx')) {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (fileInfo.filename.endsWith('.pdf')) {
      contentType = 'application/pdf';
    } else if (fileInfo.filename.endsWith('.doc')) {
      contentType = 'application/msword';
    }
    
    // Set headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.filename}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Delete the file after sending
    fileStream.on('end', () => {
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error deleting temporary file:', err);
      });
    });
    
  } catch (err) {
    console.error('Error downloading file:', err);
    res.status(500).json({ error: 'Error during download', details: err.message });
  }
});

// @route   GET api/orders/export
// @desc    Export orders based on filters
// @access  Private (admin only) - now using token from query param
router.get('/export', async (req, res) => {
  try {
    // Get token from query parameter
    const token = req.query.token;
    
    // Verify the token
    if (!token) {
      return res.status(401).json({ msg: 'No token, authorization denied' });
    }
    
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded.user;
    } catch (err) {
      return res.status(401).json({ msg: 'Token is not valid' });
    }
    
    // Continue with the existing export logic
    const { format: exportFormat, status, startDate, endDate, orderId } = req.query;
    
    // Validate export format
    if (!['excel', 'pdf', 'word'].includes(exportFormat)) {
      return res.status(400).json({ msg: 'Invalid export format' });
    }
    
    // Build the query to fetch orders
    let query = 'SELECT * FROM orders';
    const queryParams = [];
    const whereClauses = [];
    
    // Add filter by specific order ID if provided
    if (orderId) {
      whereClauses.push('id = ?');
      queryParams.push(orderId);
    }
    
    // Add status filter if provided
    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      queryParams.push(status);
    }
    
    // Add date range filters if provided
    if (startDate) {
      whereClauses.push('order_date >= ?');
      queryParams.push(`${startDate} 00:00:00`);
    }
    
    if (endDate) {
      whereClauses.push('order_date <= ?');
      queryParams.push(`${endDate} 23:59:59`);
    }
    
    // Add WHERE clause if any filters are applied
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    // Sort by order date
    query += ' ORDER BY order_date DESC';
    
    console.log('Export query:', query);
    console.log('Export params:', queryParams);
    
    // Execute the query
    const [orders] = await db.query(query, queryParams);
    
    console.log(`Found ${orders.length} orders for export`);
    
    // Get items for each order
    for (const order of orders) {
      const [items] = await db.query(`
        SELECT oi.*, p.name_fr as product_name, p.name_ar as product_name_ar
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      order.items = items;
    }
    
    // Handle different export formats
    switch (exportFormat) {
      case 'excel':
        return createExcelExport(orders, res);
      case 'pdf':
        return createPdfExport(orders, res);
      case 'word':
        return createWordExport(orders, res);
      default:
        return res.status(400).json({ msg: 'Invalid export format' });
    }
  } catch (err) {
    console.error('Error exporting orders:', err);
    res.status(500).json({ error: 'Error during export', details: err.message });
  }
});

// Generate Excel file
async function generateExcelFile(orders, filePath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Orders');
  
  // Define columns
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Products', key: 'products', width: 40 }
  ];
  
  // Style the header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDDDDDD' }
  };
  
  // Add data
  for (const order of orders) {
    // Get product names for this order
    const productNames = order.items
      ? order.items.map(item => `${item.product_name} (x${item.quantity})`).join(', ')
      : '';
    
    worksheet.addRow({
      id: order.id,
      customer: order.name || 'N/A',
      phone: order.phone || 'N/A',
      address: order.address || 'N/A',
      date: order.order_date ? format(new Date(order.order_date), 'yyyy-MM-dd HH:mm') : 'N/A',
      status: order.status || 'N/A',
      products: productNames
    });
  }
  
  // Save to file
  await workbook.xlsx.writeFile(filePath);
}

// Generate PDF file
async function generatePdfFile(orders, filePath) {
  return new Promise((resolve, reject) => {
    try {
      // Create a PDF document
      const doc = new PDFDocument({ margin: 50 });
      
      // Pipe to file
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      
      // Add title
      doc.fontSize(18).text('Order Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, { align: 'center' });
      doc.moveDown(2);
      
      // Add each order
      orders.forEach((order, index) => {
        // Add page break after first order (except the first one)
        if (index > 0) {
          doc.addPage();
        }
        
        // Order header
        doc.fontSize(14).text(`Order #${order.id}`, { underline: true });
        doc.moveDown(0.5);
        
        // Order details
        doc.fontSize(12);
        doc.text(`Customer: ${order.name || 'N/A'}`);
        doc.text(`Phone: ${order.phone || 'N/A'}`);
        doc.text(`Address: ${order.address || 'N/A'}`);
        doc.text(`Date: ${format(new Date(order.order_date), 'yyyy-MM-dd HH:mm')}`);
        doc.text(`Status: ${order.status || 'N/A'}`);
        doc.moveDown();
        
        // Order items
        if (order.items && order.items.length > 0) {
          doc.fontSize(13).text('Items:', { underline: true });
          doc.moveDown(0.5);
          
          order.items.forEach((item, i) => {
            doc.fontSize(10).text(
              `${i+1}. ${item.product_name} - ${item.quantity} x ${parseFloat(item.price).toFixed(2)} MAD = ${(parseFloat(item.price) * item.quantity).toFixed(2)} MAD`,
              { indent: 20 }
            );
          });
          
          // Calculate total
          const total = order.items.reduce((sum, item) => 
            sum + (parseFloat(item.price) * item.quantity), 0);
          
          doc.moveDown(0.5);
          doc.fontSize(12).text(`Total: ${total.toFixed(2)} MAD`, { align: 'right' });
        } else {
          doc.text('No items found for this order');
        }
      });
      
      // Finalize PDF
      doc.end();
      
      // Resolve when the stream is finished
      stream.on('finish', () => {
        resolve();
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

// Generate Word file
async function generateWordFile(orders, filePath) {
  return new Promise((resolve, reject) => {
    try {
      // Create an HTML document that Word can open
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>Orders Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1, h2 { text-align: center; }
            .order { margin-bottom: 30px; border: 1px solid #ddd; padding: 15px; page-break-after: always; }
            .order-header { background-color: #f5f5f5; padding: 10px; margin-bottom: 10px; }
            .order-details { margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .total { text-align: right; font-weight: bold; margin-top: 10px; }
          </style>
        </head>
        <body>
          <h1>Orders Report</h1>
          <p style="text-align: center;">Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}</p>
      `;
      
      // Add each order
      orders.forEach(order => {
        html += `
          <div class="order">
            <div class="order-header">
              <h2>Order #${order.id}</h2>
            </div>
            
            <div class="order-details">
              <p><strong>Customer:</strong> ${order.name || 'N/A'}</p>
              <p><strong>Phone:</strong> ${order.phone || 'N/A'}</p>
              <p><strong>Address:</strong> ${order.address || 'N/A'}</p>
              <p><strong>Date:</strong> ${format(new Date(order.order_date), 'yyyy-MM-dd HH:mm')}</p>
              <p><strong>Status:</strong> ${order.status || 'N/A'}</p>
            </div>
        `;
        
        // Add items
        if (order.items && order.items.length > 0) {
          html += `
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
          `;
          
          // Calculate total and add items
          let total = 0;
          order.items.forEach((item, index) => {
            const price = parseFloat(item.price) || 0;
            const quantity = parseInt(item.quantity) || 0;
            const subtotal = price * quantity;
            total += subtotal;
            
            html += `
              <tr>
                <td>${index + 1}</td>
                <td>${item.product_name || 'Unknown Product'}</td>
                <td>${quantity}</td>
                <td>${price.toFixed(2)} MAD</td>
                <td>${subtotal.toFixed(2)} MAD</td>
              </tr>
            `;
          });
          
          html += `
              </tbody>
            </table>
            <div class="total">Total: ${total.toFixed(2)} MAD</div>
          `;
        } else {
          html += `<p>No items found for this order</p>`;
        }
        
        html += `</div>`;
      });
      
      // Close HTML
      html += `
        </body>
        </html>
      `;
      
      // Write to file
      fs.writeFile(filePath, html, (err) => {
        if (err) return reject(err);
        resolve();
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

// Keep the original export endpoint for backward compatibility
// @route   GET api/orders/export
// @desc    Export orders based on filters
// @access  Private (admin only)
router.get('/export', auth, async (req, res) => {
  try {
    const { format: exportFormat, status, startDate, endDate, orderId } = req.query;
    
    // Validate export format
    if (!['excel', 'pdf', 'word'].includes(exportFormat)) {
      return res.status(400).json({ msg: 'Invalid export format' });
    }
    
    // Build the query to fetch orders
    let query = 'SELECT * FROM orders';
    const queryParams = [];
    const whereClauses = [];
    
    // Add filter by specific order ID if provided
    if (orderId) {
      whereClauses.push('id = ?');
      queryParams.push(orderId);
    }
    
    // Add status filter if provided
    if (status && status !== 'all') {
      whereClauses.push('status = ?');
      queryParams.push(status);
    }
    
    // Add date range filters if provided
    if (startDate) {
      whereClauses.push('order_date >= ?');
      queryParams.push(`${startDate} 00:00:00`);
    }
    
    if (endDate) {
      whereClauses.push('order_date <= ?');
      queryParams.push(`${endDate} 23:59:59`);
    }
    
    // Add WHERE clause if any filters are applied
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }
    
    // Sort by order date
    query += ' ORDER BY order_date DESC';
    
    console.log('Export query:', query);
    console.log('Export params:', queryParams);
    
    // Execute the query
    const [orders] = await db.query(query, queryParams);
    
    console.log(`Found ${orders.length} orders for export`);
    
    // Get items for each order
    for (const order of orders) {
      const [items] = await db.query(`
        SELECT oi.*, p.name_fr as product_name, p.name_ar as product_name_ar
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      order.items = items;
    }
    
    // Handle different export formats
    switch (exportFormat) {
      case 'excel':
        return createExcelExport(orders, res);
      case 'pdf':
        return createPdfExport(orders, res);
      case 'word':
        return createWordExport(orders, res);
      default:
        return res.status(400).json({ msg: 'Invalid export format' });
    }
  } catch (err) {
    console.error('Error exporting orders:', err);
    res.status(500).json({ error: 'Error during export', details: err.message });
  }
});

// Create Excel export
// Update the createExcelExport function to use French text 
function createExcelExport(orders, res) {
  try {
    const workbook = new ExcelJS.Workbook();
    
    // Set document properties
    workbook.creator = 'Beauty Shop';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.properties.date1904 = false;
    
    const worksheet = workbook.addWorksheet('Commandes');
    
    // Add logo if it exists
    const logoPath = path.join(__dirname, '../public/logo.png');
    if (fs.existsSync(logoPath)) {
      const logo = workbook.addImage({
        filename: logoPath,
        extension: 'png',
      });
      
      worksheet.addImage(logo, {
        tl: { col: 0, row: 0 },
        ext: { width: 100, height: 50 }
      });
      
      // Add some empty rows for the logo
      worksheet.addRow([]);
      worksheet.addRow([]);
      worksheet.addRow([]);
    }
    
    // Add title
    const titleRow = worksheet.addRow(['Rapport de Commandes']);
    titleRow.font = { bold: true, size: 16, color: { argb: '3B82F6' } };
    titleRow.height = 30;
    worksheet.mergeCells('A' + (worksheet.rowCount) + ':G' + (worksheet.rowCount));
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Add generation date
    const dateRow = worksheet.addRow([`Généré le: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`]);
    dateRow.font = { size: 12 };
    worksheet.mergeCells('A' + (worksheet.rowCount) + ':G' + (worksheet.rowCount));
    dateRow.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Add empty row
    worksheet.addRow([]);
    
    // Define columns with French headers
    worksheet.columns = [
      { header: 'N° Commande', key: 'id', width: 12 },
      { header: 'Client', key: 'customer', width: 20 },
      { header: 'Téléphone', key: 'phone', width: 15 },
      { header: 'Adresse', key: 'address', width: 30 },
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Statut', key: 'status', width: 15 },
      { header: 'Articles', key: 'products', width: 40 }
    ];
    
    // Style the header row
    const headerRow = worksheet.getRow(worksheet.rowCount);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '3B82F6' }  // Blue color
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 20;
    
    // Map status to French
    const statusMap = {
      'pending': 'En attente',
      'confirmed': 'Confirmée',
      'delivered': 'Livrée',
      'cancelled': 'Annulée'
    };
    
    // Add data
    for (const order of orders) {
      // Get product names for this order
      const productNames = order.items
        ? order.items.map(item => `${item.product_name} (x${item.quantity})`).join(', ')
        : '';
      
      const row = worksheet.addRow({
        id: `#${order.id}`,
        customer: order.name || 'N/A',
        phone: order.phone || 'N/A',
        address: order.address || 'N/A',
        date: order.order_date ? format(new Date(order.order_date), 'dd/MM/yyyy HH:mm') : 'N/A',
        status: statusMap[order.status] || 'En attente',
        products: productNames
      });
      
      // Style the rows
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'DDDDDD' } },
          left: { style: 'thin', color: { argb: 'DDDDDD' } },
          bottom: { style: 'thin', color: { argb: 'DDDDDD' } },
          right: { style: 'thin', color: { argb: 'DDDDDD' } }
        };
      });
      
      // Color code the status
      const statusCell = row.getCell('status');
      switch (order.status) {
        case 'pending':
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5D7' } };
          break;
        case 'confirmed':
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D7E9FF' } };
          break;
        case 'delivered':
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D7F9E9' } };
          break;
        case 'cancelled':
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD7D7' } };
          break;
      }
    }
    
    // Add footer
    const footerRow = worksheet.addRow(['Beauty Shop - Tous droits réservés']);
    footerRow.font = { italic: true, color: { argb: '888888' } };
    worksheet.mergeCells('A' + (worksheet.rowCount) + ':G' + (worksheet.rowCount));
    footerRow.alignment = { horizontal: 'center' };
    
    // Set content type and headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="commandes_${format(new Date(), 'yyyy-MM-dd')}.xlsx"`);
    
    // Write to response
    return workbook.xlsx.write(res)
      .then(() => {
        res.status(200).end();
      });
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Échec de la génération du fichier Excel' });
  }
}

// Create PDF export
// Updated createPdfExport function with improved styling
// Enhanced PDF export with improved styling
function createPdfExport(orders, res) {
  try {
    // Create a PDF document with better margins for content
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: 'Rapport de Commandes',
        Author: 'Beauty Shop',
        Subject: 'Commandes',
      }
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="commandes_${format(new Date(), 'yyyy-MM-dd')}.pdf"`);
    
    // Pipe the PDF directly to the response
    doc.pipe(res);
    
    // Color scheme
    const colors = {
      primary: '#1a56db',      // Deep blue
      secondary: '#f59e0b',    // Amber
      text: '#1f2937',         // Dark gray for text
      textLight: '#4b5563',    // Medium gray for secondary text
      lightBg: '#f3f4f6',      // Light gray background
      success: '#059669',      // Green
      danger: '#dc2626',       // Red
      warning: '#d97706',      // Amber darker
      border: '#e5e7eb',       // Light gray for borders
      highlight: '#dbeafe',    // Light blue highlight
    };
    
    // Status translations and colors
    const statusInfo = {
      pending: { text: 'En attente', color: colors.warning },
      confirmed: { text: 'Confirmée', color: colors.primary },
      delivered: { text: 'Livrée', color: colors.success },
      cancelled: { text: 'Annulée', color: colors.danger },
    };
    
    // Register fonts (if available)
    try {
      doc.registerFont('NormalFont', 'Helvetica');
      doc.registerFont('BoldFont', 'Helvetica-Bold');
      doc.registerFont('ItalicFont', 'Helvetica-Oblique');
    } catch (e) {
      console.log('Using default fonts');
    }
    
    // Add logo if it exists
    const logoPath = path.join(__dirname, '../public/logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, {
        fit: [100, 80],
        align: 'center',
        valign: 'center'
      });
      doc.moveDown(5);
    } else {
      // If no logo, add some space at the top
      doc.moveDown(2);
    }
    
    // Document header section
    const addDocumentHeader = () => {
      // Title
      doc.font('Helvetica-Bold').fontSize(22).fillColor(colors.primary)
        .text('Rapport de Commandes', { align: 'center' });
      doc.moveDown(0.5);
      
      // Generation date
      doc.font('Helvetica').fontSize(11).fillColor(colors.textLight)
        .text(`Généré le: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, { align: 'center' });
      
      // Horizontal line
      doc.moveDown(1);
      doc.moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor(colors.border)
        .lineWidth(1)
        .stroke();
      doc.moveDown(1.5);
    };
    
    // Add document header
    addDocumentHeader();
    
    // Process each order - one order per page
    orders.forEach((order, index) => {
      // Start first order on first page, others on new pages
      if (index > 0) {
        doc.addPage();
      }
      
      // Order title with box
      const orderY = doc.y;
      doc.rect(50, orderY, doc.page.width - 100, 32)
        .fill(colors.highlight);
      
      // Order number and status
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(16)
        .text(`Commande #${order.id}`, 60, orderY + 8);
      
      // Status indicator
      const status = order.status || 'pending';
      const statusText = statusInfo[status].text;
      const statusWidth = doc.widthOfString(statusText) + 16;
      
      doc.rect(doc.page.width - 60 - statusWidth, orderY + 6, statusWidth, 20)
        .fill(statusInfo[status].color);
      doc.fillColor('#FFFFFF').fontSize(11)
        .text(statusText, doc.page.width - 60 - statusWidth + 8, orderY + 10);
      
      doc.moveDown(1.5);
      
      // Customer section with improved layout
      doc.font('Helvetica-Bold').fontSize(14).fillColor(colors.primary)
        .text('Informations Client', doc.page.width - 545, doc.y, { 
          width: 200,
          align: 'left'
        });
      doc.moveDown(0.5);
      
      // Create a grid layout for customer info
      const startY = doc.y;
      const lineHeight = 20;
      
      // First column
      doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.text)
        .text('Client:', 50, startY);
      doc.font('Helvetica').fillColor(colors.textLight)
        .text(order.name || 'N/A', 150, startY);
      
      doc.font('Helvetica-Bold').fillColor(colors.text)
        .text('Téléphone:', 50, startY + lineHeight);
      doc.font('Helvetica').fillColor(colors.textLight)
        .text(order.phone || 'N/A', 150, startY + lineHeight);
      
      // Second column
      doc.font('Helvetica-Bold').fillColor(colors.text)
        .text('Adresse:', 300, startY);
      doc.font('Helvetica').fillColor(colors.textLight)
        .text(order.address || 'N/A', 380, startY, {
          width: doc.page.width - 380 - 50,
          height: lineHeight * 2
        });
      
      doc.font('Helvetica-Bold').fillColor(colors.text)
        .text('Date:', 300, startY + lineHeight);
      doc.font('Helvetica').fillColor(colors.textLight)
        .text(format(new Date(order.order_date), 'dd/MM/yyyy HH:mm'), 380, startY + lineHeight);
      
      doc.moveDown(3);
      
      // Order items section
      doc.font('Helvetica-Bold').fontSize(14).fillColor(colors.primary)
        .text('Détail des Articles', doc.page.width - 545, doc.y, { 
          width: 200,
          align: 'left'
        });
      doc.moveDown(0.5);
      
      // Items table
      if (order.items && order.items.length > 0) {
        // Table layout configuration
        const tableTop = doc.y;
        const tableLeft = 50;
        const tableWidth = doc.page.width - 100;
        const colWidths = [40, 230, 70, 70, 80]; // Width for each column
        
        // Draw table header background
        doc.rect(tableLeft, tableTop, tableWidth, 25)
          .fill(colors.primary);
        
        // Draw header text
        let xPos = tableLeft + 10;
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11);
        
        ['#', 'Article', 'Quantité', 'Prix', 'Total'].forEach((header, i) => {
          const colWidth = colWidths[i];
          doc.text(header, xPos, tableTop + 8, {
            width: colWidth - 10,
            align: i === 0 || i === 1 ? 'left' : 'right'
          });
          xPos += colWidth;
        });
        
        // Draw rows
        let yPos = tableTop + 25;
        let total = 0;
        
        order.items.forEach((item, i) => {
          const price = parseFloat(item.price) || 0;
          const quantity = parseInt(item.quantity) || 0;
          const subtotal = price * quantity;
          total += subtotal;
          
          // Row background (alternating colors)
          if (i % 2 === 0) {
            doc.rect(tableLeft, yPos, tableWidth, 25)
              .fillOpacity(0.1)
              .fill(colors.lightBg)
              .fillOpacity(1);
          }
          
          // Draw row content
          xPos = tableLeft + 10;
          doc.fillColor(colors.text).font('Helvetica').fontSize(10);
          
          // Item number
          doc.text((i + 1).toString(), xPos, yPos + 8, { width: colWidths[0] - 10 });
          xPos += colWidths[0];
          
          // Product name (truncate if too long)
          const productName = item.product_name || 'Article inconnu';
          doc.text(productName, xPos, yPos + 8, { 
            width: colWidths[1] - 10,
            ellipsis: true
          });
          xPos += colWidths[1];
          
          // Quantity (right aligned)
          doc.text(quantity.toString(), xPos, yPos + 8, { 
            width: colWidths[2] - 10,
            align: 'right'
          });
          xPos += colWidths[2];
          
          // Price (right aligned)
          doc.text(`${price.toFixed(2)} MAD`, xPos, yPos + 8, { 
            width: colWidths[3] - 10,
            align: 'right'
          });
          xPos += colWidths[3];
          
          // Subtotal (right aligned)
          doc.text(`${subtotal.toFixed(2)} MAD`, xPos, yPos + 8, { 
            width: colWidths[4] - 10,
            align: 'right'
          });
          
          // Move to next row
          yPos += 25;
        });
        
        // Table bottom border
        doc.moveTo(tableLeft, yPos)
          .lineTo(tableLeft + tableWidth, yPos)
          .strokeColor(colors.border)
          .lineWidth(1)
          .stroke();
        
        // Total row
        doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12);
        doc.text('Total:', tableLeft + tableWidth - colWidths[4] - colWidths[3], yPos + 15, {
          width: colWidths[3],
          align: 'right'
        });
        
        doc.text(`${total.toFixed(2)} MAD`, tableLeft + tableWidth - colWidths[4], yPos + 15, {
          width: colWidths[4] - 10,
          align: 'right'
        });
      } else {
        doc.font('Helvetica-Oblique').fontSize(11).fillColor(colors.textLight);
        doc.text('Aucun article trouvé pour cette commande');
      }
      
      // Footer with line and company info
      const footerY = doc.page.height - 50;
      doc.moveTo(50, footerY)
        .lineTo(doc.page.width - 50, footerY)
        .strokeColor(colors.border)
        .lineWidth(0.5)
        .stroke();
      
      doc.font('Helvetica').fontSize(9).fillColor(colors.textLight)
        .text('SWIBI Collecion - Tous droits réservés', 10, footerY + 10, { 
          align: 'center',
          width: doc.page.width
        });
      
      // Add page numbers
      doc.text(`Page ${index + 1} sur ${orders.length}`, 0, footerY + 25, {
        align: 'center',
        width: doc.page.width
      });
    });
    
    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: 'Échec de la génération du fichier PDF' });
  }
}

// Create Word export (HTML that Word can open)
// Update the createWordExport function with French text
function createWordExport(orders, res) {
  try {
    // Base64 encoded logo
    let logoHtml = '';
    const logoPath = path.join(__dirname, '../public/logo.png');
    
    if (fs.existsSync(logoPath)) {
      // Convert logo to base64
      const logoData = fs.readFileSync(logoPath);
      const logoBase64 = Buffer.from(logoData).toString('base64');
      logoHtml = `<img src="data:image/png;base64,${logoBase64}" style="height: 80px; display: block; margin: 0 auto;">`;
    }
    
    // Create an HTML document that Word can open with styling matching the PDF
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Rapport de Commandes</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 50px; color: #1f2937; }
          .logo-container { text-align: center; margin-bottom: 30px; }
          h1 { text-align: center; color: #1a56db; font-size: 22px; margin-bottom: 10px; }
          h2 { color: #1a56db; font-size: 16px; margin-top: 15px; margin-bottom: 10px; }
          p.date { text-align: center; color: #4b5563; font-size: 11px; margin-bottom: 30px; }
          .divider { border-bottom: 1px solid #e5e7eb; margin: 20px 0; }
          
          /* Table styles matching PDF */
          table { width: 100%; border-collapse: collapse; margin: 15px 0 25px 0; }
          th { 
            background-color: #1a56db; 
            color: white; 
            font-weight: bold; 
            text-align: center;
            padding: 8px;
            border: 1px solid #1a56db;
          }
          td { 
            border: 1px solid #e5e7eb; 
            padding: 8px; 
            text-align: left;
          }
          tr:nth-child(even) { background-color: #f3f4f6; }
          
          /* Order styles */
          .order-container { margin-bottom: 40px; }
          .order-title-box { 
            background-color: #dbeafe; 
            padding: 8px; 
            margin-bottom: 15px;
            display: flex;
            justify-content: space-between;
          }
          .order-id { font-size: 16px; font-weight: bold; color: #1a56db; }
          .order-details { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            grid-gap: 10px;
            margin-bottom: 20px;
          }
          .detail-label { font-weight: bold; color: #1f2937; }
          .detail-value { color: #4b5563; }
          
          /* Status colors */
          .status { 
            display: inline-block; 
            padding: 5px 10px; 
            color: white; 
            font-size: 11px; 
            border-radius: 3px;
          }
          .status-pending { background-color: #f59e0b; }
          .status-confirmed { background-color: #1a56db; }
          .status-delivered { background-color: #059669; }
          .status-cancelled { background-color: #dc2626; }
          
          /* Total row */
          .total-row td { 
            font-weight: bold; 
            background-color: #f9fafb;
          }
          .price-column { text-align: right; }
          
          /* Footer */
          .footer { 
            text-align: center; 
            font-size: 9px; 
            color: #4b5563; 
            margin-top: 30px;
            padding-top: 10px;
            border-top: 0.5px solid #e5e7eb;
          }
          .page-number {
            text-align: center;
            font-size: 9px;
            color: #4b5563;
            margin-top: 5px;
          }
          .page-break { page-break-before: always; }
        </style>
      </head>
      <body>
        <div class="logo-container">
          ${logoHtml}
        </div>
        <h1>Rapport de Commandes</h1>
        <p class="date">Généré le: ${format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
        
        <div class="divider"></div>
    `;
    
    // Add each order - matching PDF layout
    orders.forEach((order, index) => {
      try {
        // Add page break after first order
        if (index > 0) {
          html += `<div class="page-break"></div>`;
        }
        
        const orderDate = format(new Date(order.order_date), 'dd/MM/yyyy HH:mm');
        
        // Map status to French
        let statusText = 'En attente';
        let statusClass = 'status-pending';
        
        switch(order.status) {
          case 'confirmed':
            statusText = 'Confirmée';
            statusClass = 'status-confirmed';
            break;
          case 'delivered':
            statusText = 'Livrée';
            statusClass = 'status-delivered';
            break;
          case 'cancelled':
            statusText = 'Annulée';
            statusClass = 'status-cancelled';
            break;
        }
        
        html += `
          <div class="order-container">
            <div class="order-title-box">
              <span class="order-id">Commande #${order.id}</span>
              <span class="status ${statusClass}">${statusText}</span>
            </div>
            
            <h2>Informations Client</h2>
            <div class="order-details">
              <div>
                <p><span class="detail-label">Client:</span> <span class="detail-value">${order.name || 'N/A'}</span></p>
                <p><span class="detail-label">Téléphone:</span> <span class="detail-value">${order.phone || 'N/A'}</span></p>
              </div>
              <div>
                <p><span class="detail-label">Adresse:</span> <span class="detail-value">${order.address || 'N/A'}</span></p>
                <p><span class="detail-label">Date:</span> <span class="detail-value">${orderDate}</span></p>
              </div>
            </div>
            
            <h2>Détail des Articles</h2>
        `;
        
        // Add items table if there are items
        if (order.items && order.items.length > 0) {
          html += `
            <table>
              <thead>
                <tr>
                  <th style="width: 40px;">#</th>
                  <th style="width: 230px;">Article</th>
                  <th style="width: 70px;">Quantité</th>
                  <th style="width: 70px;">Prix</th>
                  <th style="width: 80px;">Total</th>
                </tr>
              </thead>
              <tbody>
          `;
          
          // Add item rows with alternating backgrounds
          let total = 0;
          order.items.forEach((item, idx) => {
            const price = parseFloat(item.price) || 0;
            const quantity = parseInt(item.quantity) || 0;
            const subtotal = price * quantity;
            total += subtotal;
            
            const rowStyle = idx % 2 === 0 ? '' : 'background-color: #f3f4f6;';
            
            html += `
              <tr style="${rowStyle}">
                <td style="text-align: center;">${idx + 1}</td>
                <td>${item.product_name || 'Article inconnu'}</td>
                <td style="text-align: right;">${quantity}</td>
                <td class="price-column">${price.toFixed(2)} MAD</td>
                <td class="price-column">${subtotal.toFixed(2)} MAD</td>
              </tr>
            `;
          });
          
          // Add total row
          html += `
              <tr class="total-row">
                <td colspan="4" style="text-align: right;">Total:</td>
                <td class="price-column">${total.toFixed(2)} MAD</td>
              </tr>
            </tbody>
          </table>
          `;
        } else {
          html += `<p><em>Aucun article trouvé pour cette commande</em></p>`;
        }
        
        // Add page footer
        html += `
          <div class="footer">
            SWIBI Collection - Tous droits réservés
          </div>
          <div class="page-number">
            Page ${index + 1} sur ${orders.length}
          </div>
        </div>
        `;
      } catch (error) {
        console.error(`Error processing order ${order.id} in Word details:`, error);
        html += `<p style="color: red;">Erreur lors du traitement de la commande ${order.id}: ${error.message}</p>`;
      }
    });
    
    // Close the HTML document
    html += `
      </body>
      </html>
    `;
    
    // Set headers for Word document
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="commandes_${format(new Date(), 'yyyy-MM-dd')}.doc"`);
    
    // Send the HTML content
    res.send(html);
  } catch (error) {
    console.error('Word export error:', error);
    res.status(500).json({ error: 'Échec de la génération du fichier Word' });
  }
}

// @route   GET api/orders
// @desc    Get all orders
// @access  Private (admin only)
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM orders ORDER BY order_date DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/orders/:id
// @desc    Get order by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Order not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/orders/:id/items
// @desc    Get items for a specific order
// @access  Private (admin only)
router.get('/:id/items', auth, async (req, res) => {
  try {
    const [orderItems] = await db.query(`
      SELECT 
        oi.id, oi.order_id, oi.product_id, oi.quantity, oi.price, oi.discount,
        p.name_fr, p.name_ar, p.image,
        pc.id as color_id, pc.name_fr as color_name_fr, pc.name_ar as color_name_ar, 
        pc.hex_code as color_hex, pc.image as color_image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_colors pc ON oi.color_id = pc.id
      WHERE oi.order_id = ?
    `, [req.params.id]);
    
    // Process items to use color image if available
    const processedItems = orderItems.map(item => {
      // If there's a color with an image, use that image instead of the product image
      if (item.color_image) {
        item.image = item.color_image;
      }
      
      return item;
    });
    
    res.json(processedItems);
  } catch (err) {
    console.error('Error fetching order items:', err);
    res.status(500).send('Server error');
  }
});

// @route   POST api/orders
// @desc    Create a new order
// @access  Public
router.post('/', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { name, phone, address, notes, items, order_source } = req.body;
    
    // Validate required fields
    if (!items || items.length === 0) {
      return res.status(400).json({ msg: 'Missing required items' });
    }
    
    // For regular orders, require customer information
    // For WhatsApp orders, use placeholders
    const isWhatsAppOrder = order_source === 'whatsapp';
    
    if (!isWhatsAppOrder && (!name || !phone || !address)) {
      return res.status(400).json({ msg: 'Missing required customer information' });
    }
    
    // Create order
    const [orderResult] = await connection.query(
      'INSERT INTO orders (name, phone, address, notes, order_source) VALUES (?, ?, ?, ?, ?)',
      [
        isWhatsAppOrder ? 'WhatsApp Order' : name, 
        isWhatsAppOrder ? 'WhatsApp' : phone, 
        isWhatsAppOrder ? 'To be provided via WhatsApp' : address,
        isWhatsAppOrder ? 'Customer will provide details via WhatsApp' : (notes || null),
        isWhatsAppOrder ? 'whatsapp' : 'website'
      ]
    );
    
    const orderId = orderResult.insertId;
    
    // Insert order items
    for (const item of items) {
      // The price in the items array should already be the final price after discount
      const finalPrice = parseFloat(item.price) || 0;
      
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price, color_id) VALUES (?, ?, ?, ?, ?)',
        [
          orderId, 
          item.productId, 
          item.quantity, 
          finalPrice,
          item.colorId || null
        ]
      );
      
      // For regular orders, update stock immediately
      // For WhatsApp orders, stock will be updated when the order is confirmed
      if (!isWhatsAppOrder) {
        // If color is specified, update that color's stock
        if (item.colorId) {
          await connection.query(
            'UPDATE product_colors SET stock = stock - ? WHERE id = ? AND product_id = ? AND stock >= ?',
            [item.quantity, item.colorId, item.productId, item.quantity]
          );
        } else {
          // Otherwise update the product's main stock
          await connection.query(
            'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
            [item.quantity, item.productId, item.quantity]
          );
        }
      }
    }
    
    await connection.commit();
    
    // Get the full order details for the notification
    const [orderDetails] = await db.query(
      'SELECT * FROM orders WHERE id = ?',
      [orderId]
    );
    
    // Send notification about new order
    if (orderDetails.length > 0) {
      const io = req.app.get('io');
      const adminSockets = req.app.get('adminSockets');
      
      if (io && adminSockets) {
        const orderData = orderDetails[0];
        const currentTime = new Date().toISOString();
        
        // Use the notification service with explicit timestamp
        const { notifyAdmins } = require('../services/notificationService');
        notifyAdmins(io, adminSockets, {
          type: 'order',
          title: isWhatsAppOrder ? 'WhatsApp Order' : 'New Order',
          message: isWhatsAppOrder 
            ? `New WhatsApp order #${orderData.id} created` 
            : `New order #${orderData.id} from ${orderData.name}`,
          data: orderData,
          timestamp: currentTime
        });
      }
    }
    
    res.status(201).json({
      msg: 'Order created successfully',
      orderId
    });
    
  } catch (err) {
    await connection.rollback();
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  } finally {
    connection.release();
  }
});

// @route   PUT api/orders/:id/status
// @desc    Update order status
// @access  Private (admin only)
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    
    // Validate status
    if (!['pending', 'confirmed', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ msg: 'Invalid status' });
    }
    
    // Check if order exists
    const [order] = await db.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    
    if (order.length === 0) {
      return res.status(404).json({ msg: 'Order not found' });
    }
    
    // Set completed_date if status is delivered
    let completedDate = order[0].completed_date;
    if (status === 'delivered' && !completedDate) {
      completedDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    
    // Update status
    await db.query(
      'UPDATE orders SET status = ?, completed_date = ? WHERE id = ?',
      [status, completedDate, req.params.id]
    );
    
    res.json({ msg: 'Order status updated' });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/orders/active/count
// @desc    Get count of active orders
// @access  Private
router.get('/active/count', auth, async (req, res) => {
  try {
    const [result] = await db.query(
      "SELECT COUNT(*) as count FROM orders WHERE status != 'delivered' AND status != 'cancelled'"
    );
    
    res.json({ count: result[0].count });
  } catch (err) {
    console.error('Error fetching active order count:', err);
    res.status(500).send('Server error');
  }
});

// @route   POST api/orders/whatsapp
// @desc    Create a new order from WhatsApp cart
// @access  Public
router.post('/whatsapp', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { items } = req.body;
    
    // Validate required fields
    if (!items || items.length === 0) {
      return res.status(400).json({ msg: 'Missing required items' });
    }
    
    // Create order with WhatsApp source
    const [orderResult] = await connection.query(
      'INSERT INTO orders (name, phone, address, notes, status, order_source) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.body.name || 'WhatsApp Order', 
        req.body.phone || 'WhatsApp', 
        req.body.address || 'To be provided via WhatsApp',
        req.body.notes || 'Customer will provide details via WhatsApp',
        'pending',
        'whatsapp'
      ]
    );
    
    const orderId = orderResult.insertId;
    
    // Insert order items
    for (const item of items) {
      // The price in the items array should already be the final price after discount
      const finalPrice = parseFloat(item.price) || 0;
      
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price, color_id) VALUES (?, ?, ?, ?, ?)',
        [
          orderId, 
          item.productId, 
          item.quantity, 
          finalPrice,
          item.colorId || null
        ]
      );
    }
    
    await connection.commit();
    
    // Get the full order details for the notification
    const [orderDetails] = await db.query(
      'SELECT * FROM orders WHERE id = ?',
      [orderId]
    );
    
    // Send notification about new WhatsApp order with explicit timestamp
    if (orderDetails.length > 0) {
      const io = req.app.get('io');
      const adminSockets = req.app.get('adminSockets');
      
      if (io && adminSockets) {
        const orderData = orderDetails[0];
        const currentTime = new Date().toISOString();
        
        // Use the notification service with explicit timestamp
        const { notifyAdmins } = require('../services/notificationService');
        notifyAdmins(io, adminSockets, {
          type: 'order',
          title: 'WhatsApp Order',
          message: `New WhatsApp order #${orderData.id} created`,
          data: orderData,
          timestamp: currentTime
        });
      }
    }
    
    res.status(201).json({
      msg: 'WhatsApp order created successfully',
      orderId
    });
    
  } catch (err) {
    await connection.rollback();
    console.error('Error creating WhatsApp order:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;