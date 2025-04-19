const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middleware/auth');
const { uploadTemp } = require('../middleware/upload');
const imgbbService = require('../services/imgbb');
const fs = require('fs');
const path = require('path');

// Debug middleware to log request content
const logRequestMiddleware = (req, res, next) => {
  console.log('Request body:', req.body);
  console.log('Request files:', req.file || 'No files');
  next();
};

// @route   GET api/products/search
// @desc    Search products by name
// @access  Public
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const sort = req.query.sort || 'newest';
    
    if (!query || query.trim() === '') {
      return res.json([]);
    }
    
    // Create search pattern
    const searchPattern = `%${query}%`;
    
    // Determine sorting
    let orderBy;
    switch (sort) {
      case 'price_asc':
        orderBy = 'ORDER BY price ASC';
        break;
      case 'price_desc':
        orderBy = 'ORDER BY price DESC';
        break;
      case 'discount':
        orderBy = 'ORDER BY discount DESC';
        break;
      case 'name_asc':
        orderBy = 'ORDER BY name_fr ASC';
        break;
      case 'name_desc':
        orderBy = 'ORDER BY name_fr DESC';
        break;
      default:
        // newest
        orderBy = 'ORDER BY created_at DESC';
    }
    
    // Search by name_fr, name_ar, or description
    const [products] = await db.query(
      `SELECT * FROM products 
       WHERE name_fr LIKE ? OR name_ar LIKE ? OR desc_fr LIKE ? OR desc_ar LIKE ? 
       ${orderBy}`,
      [searchPattern, searchPattern, searchPattern, searchPattern]
    );
    
    res.json(products);
  } catch (err) {
    console.error('Error searching products:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/products
// @desc    Get all products
// @access  Public
router.get('/', async (req, res) => {
  try {
    const sort = req.query.sort || 'newest';
    
    // Determine sorting
    let orderBy;
    switch (sort) {
      case 'price_asc':
        orderBy = 'ORDER BY price ASC';
        break;
      case 'price_desc':
        orderBy = 'ORDER BY price DESC';
        break;
      case 'discount':
        orderBy = 'ORDER BY discount DESC';
        break;
      case 'name_asc':
        orderBy = 'ORDER BY name_fr ASC';
        break;
      case 'name_desc':
        orderBy = 'ORDER BY name_fr DESC';
        break;
      default:
        // newest
        orderBy = 'ORDER BY created_at DESC';
    }
    
    const [products] = await db.query(`SELECT * FROM products ${orderBy}`);
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/products/discounted
// @desc    Get products with discount
// @access  Public
router.get('/discounted', async (req, res) => {
  try {
    const sort = req.query.sort || 'discount';
    
    // Determine sorting
    let orderBy;
    switch (sort) {
      case 'price_asc':
        orderBy = 'ORDER BY price ASC';
        break;
      case 'price_desc':
        orderBy = 'ORDER BY price DESC';
        break;
      case 'name_asc':
        orderBy = 'ORDER BY name_fr ASC';
        break;
      case 'name_desc':
        orderBy = 'ORDER BY name_fr DESC';
        break;
      case 'newest':
        orderBy = 'ORDER BY created_at DESC';
        break;
      default:
        // highest discount
        orderBy = 'ORDER BY discount DESC';
    }
    
    const [products] = await db.query(
      `SELECT * FROM products WHERE discount > 0 ${orderBy}`
    );
    res.json(products);
  } catch (err) {
    console.error('Error fetching discounted products:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/products/category/:category
// @desc    Get products by category
// @access  Public
router.get('/category/:category', async (req, res) => {
  try {
    const sort = req.query.sort || 'newest';
    
    // Determine sorting
    let orderBy;
    switch (sort) {
      case 'price_asc':
        orderBy = 'ORDER BY price ASC';
        break;
      case 'price_desc':
        orderBy = 'ORDER BY price DESC';
        break;
      case 'discount':
        orderBy = 'ORDER BY discount DESC';
        break;
      case 'name_asc':
        orderBy = 'ORDER BY name_fr ASC';
        break;
      case 'name_desc':
        orderBy = 'ORDER BY name_fr DESC';
        break;
      default:
        // newest
        orderBy = 'ORDER BY created_at DESC';
    }
    
    const [products] = await db.query(
      `SELECT * FROM products WHERE category = ? ${orderBy}`,
      [req.params.category]
    );
    res.json(products);
  } catch (err) {
    console.error('Error fetching category products:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/products/:id
// @desc    Get product by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Product not found' });
    }
    
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).send('Server error');
  }
});

// @route   GET api/products/:id/colors
// @desc    Get colors for a product
// @access  Public
router.get('/:id/colors', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM product_colors WHERE product_id = ?', [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching product colors:', err);
    res.status(500).send('Server error');
  }
});

// Handle product save operations
const handleProductSave = async (req, res, isUpdate = false) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Handle basic product info
    const { name_fr, name_ar, desc_fr, desc_ar, price, discount, category, stock } = req.body;
    let productId;
    
    // Parse numeric values safely
    const parsedPrice = parseFloat(price) || 0;
    const parsedDiscount = parseFloat(discount) || 0;
    const parsedStock = parseInt(stock) || 0;
    
    // Handle image
    let image = null;
    
    if (req.files && req.files.image) {
      // Upload image to ImgBB
      image = await imgbbService.uploadImage(req.files.image[0].path);
      
      // Delete temp file
      if (fs.existsSync(req.files.image[0].path)) {
        fs.unlinkSync(req.files.image[0].path);
      }
    }
    
    if (isUpdate) {
      // Get existing product for image handling
      const [product] = await connection.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
      if (product.length === 0) {
        return res.status(404).json({ msg: 'Product not found' });
      }
      
      // If no new image uploaded, keep the old one
      if (!image) {
        image = product[0].image;
      }
      
      // Update product
      await connection.query(
        'UPDATE products SET name_fr = ?, name_ar = ?, desc_fr = ?, desc_ar = ?, price = ?, discount = ?, category = ?, image = ?, stock = ? WHERE id = ?',
        [name_fr, name_ar, desc_fr || '', desc_ar || '', parsedPrice, parsedDiscount, category, image, parsedStock, req.params.id]
      );
      
      productId = req.params.id;
    } else {
      // Create new product
      if (!image) {
        return res.status(400).json({ msg: 'Please upload an image' });
      }
      
      const [result] = await connection.query(
        'INSERT INTO products (name_fr, name_ar, desc_fr, desc_ar, price, discount, category, image, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name_fr, name_ar, desc_fr || '', desc_ar || '', parsedPrice, parsedDiscount, category, image, parsedStock]
      );
      
      productId = result.insertId;
    }
    
    // Handle colors if provided
    if (req.body.colors) {
      const colors = JSON.parse(req.body.colors);
      
      // If updating, delete removed colors
      if (isUpdate) {
        const existingColorIds = colors
          .filter(c => !c.isNew && c.id)
          .map(c => c.id);
        
        if (existingColorIds.length > 0) {
          await connection.query(
            `DELETE FROM product_colors WHERE product_id = ? AND id NOT IN (${existingColorIds.join(',')})`,
            [productId]
          );
        } else {
          // If no existing colors were kept, delete all
          await connection.query('DELETE FROM product_colors WHERE product_id = ?', [productId]);
        }
      }
      
      // Process each color
      for (let i = 0; i < colors.length; i++) {
        const color = colors[i];
        
        // Check if there's a new image for this color
        let colorImage = color.image;
        const colorIndex = Object.keys(req.files || {})
          .filter(key => key.startsWith('colorImage_'))
          .map(key => parseInt(key.split('_')[1]))
          .find(idx => idx === i);
        
        if (colorIndex !== undefined && req.files[`colorImage_${colorIndex}`]) {
          // Upload color image to ImgBB
          colorImage = await imgbbService.uploadImage(req.files[`colorImage_${colorIndex}`][0].path);
          
          // Delete temp file
          if (fs.existsSync(req.files[`colorImage_${colorIndex}`][0].path)) {
            fs.unlinkSync(req.files[`colorImage_${colorIndex}`][0].path);
          }
        }
        
        if (color.isNew || !color.id || color.id.toString().startsWith('temp-')) {
          // Insert new color
          await connection.query(
            'INSERT INTO product_colors (product_id, name_fr, name_ar, hex_code, stock, image) VALUES (?, ?, ?, ?, ?, ?)',
            [productId, color.name_fr, color.name_ar, color.hex_code, color.stock || 0, colorImage]
          );
        } else {
          // Update existing color
          await connection.query(
            'UPDATE product_colors SET name_fr = ?, name_ar = ?, hex_code = ?, stock = ?, image = ? WHERE id = ? AND product_id = ?',
            [color.name_fr, color.name_ar, color.hex_code, color.stock || 0, colorImage, color.id, productId]
          );
        }
      }
    }
    
    await connection.commit();
    
    // Get updated product with its colors
    const [product] = await connection.query('SELECT * FROM products WHERE id = ?', [productId]);
    const [colors] = await connection.query('SELECT * FROM product_colors WHERE product_id = ?', [productId]);
    
    res.json({
      ...product[0],
      colors
    });
    
  } catch (err) {
    await connection.rollback();
    console.error('Error saving product:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  } finally {
    connection.release();
    
    // Clean up any temporary files
    if (req.files) {
      Object.keys(req.files).forEach(fieldname => {
        req.files[fieldname].forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      });
    }
  }
};

// @route   POST api/products
// @desc    Create a product
// @access  Private (admin only)
router.post('/', auth, uploadTemp.fields([
  { name: 'image', maxCount: 1 },
  ...Array(20).fill().map((_, i) => ({ name: `colorImage_${i}`, maxCount: 1 }))
]), async (req, res) => {
  try {
    return await handleProductSave(req, res, false);
  } catch (err) {
    // Clean up any temporary files
    if (req.files) {
      Object.keys(req.files).forEach(fieldname => {
        req.files[fieldname].forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      });
    }
    
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// @route   PUT api/products/:id
// @desc    Update a product
// @access  Private (admin only)
router.put('/:id', auth, uploadTemp.fields([
  { name: 'image', maxCount: 1 },
  ...Array(20).fill().map((_, i) => ({ name: `colorImage_${i}`, maxCount: 1 }))
]), async (req, res) => {
  try {
    return await handleProductSave(req, res, true);
  } catch (err) {
    // Clean up any temporary files
    if (req.files) {
      Object.keys(req.files).forEach(fieldname => {
        req.files[fieldname].forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      });
    }
    
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// @route   DELETE api/products/:id
// @desc    Delete a product
// @access  Private (admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    // Check if product exists
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ msg: 'Product not found' });
    }
    
    // Delete product from database
    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    
    res.json({ msg: 'Product removed' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;