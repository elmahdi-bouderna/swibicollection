const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadImage } = require('../services/ImgbbService');

// Configure multer to store files temporarily
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Create multer instance
const upload = multer({ storage });

// Middleware to handle ImgBB upload for a single field
const uploadToImgBB = (fieldName) => {
  return [
    // First use multer to save file temporarily
    upload.single(fieldName),
    // Then upload to ImgBB and add URL to request
    async (req, res, next) => {
      try {
        if (!req.file) {
          return next();
        }

        // Upload to ImgBB
        const imgbbUrl = await uploadImage(
          req.file.path,
          path.parse(req.file.originalname).name
        );

        // Add ImgBB URL to request
        req.imgbbUrl = imgbbUrl;

        // Delete temporary file
        fs.unlinkSync(req.file.path);

        next();
      } catch (error) {
        console.error('Error in ImgBB upload middleware:', error);
        next(error);
      }
    }
  ];
};

// Middleware for multiple fields
const uploadMultipleToImgBB = (fields) => {
  return [
    // First use multer to save files temporarily
    upload.fields(fields),
    // Then upload to ImgBB and add URLs to request
    async (req, res, next) => {
      try {
        if (!req.files) {
          return next();
        }

        // Initialize object to store ImgBB URLs
        req.imgbbUrls = {};

        // Process each file field
        for (const fieldName in req.files) {
          const files = req.files[fieldName];
          req.imgbbUrls[fieldName] = [];

          // Upload each file in the field
          for (const file of files) {
            const imgbbUrl = await uploadImage(
              file.path,
              path.parse(file.originalname).name
            );
            
            req.imgbbUrls[fieldName].push(imgbbUrl);
            
            // Delete temporary file
            fs.unlinkSync(file.path);
          }
        }

        next();
      } catch (error) {
        console.error('Error in ImgBB upload middleware:', error);
        next(error);
      }
    }
  ];
};

module.exports = {
  uploadToImgBB,
  uploadMultipleToImgBB
};