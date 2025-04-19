const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// ImgBB API key
const API_KEY = '707cfa8cb92880c80b9154c7135498d6';

/**
 * Upload an image to ImgBB
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<string>} - URL of the uploaded image
 */
const uploadImage = async (imagePath) => {
  try {
    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));
    
    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${API_KEY}`, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    if (response.data.success) {
      // Return the direct URL of the uploaded image
      return response.data.data.url;
    } else {
      throw new Error('Failed to upload image to ImgBB');
    }
  } catch (error) {
    console.error('ImgBB upload error:', error.message);
    throw error;
  }
};

/**
 * Upload an image buffer to ImgBB
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<string>} - URL of the uploaded image
 */
const uploadImageBuffer = async (imageBuffer) => {
  try {
    const formData = new FormData();
    formData.append('image', imageBuffer.toString('base64'));
    
    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${API_KEY}`, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    if (response.data.success) {
      // Return the direct URL of the uploaded image
      return response.data.data.url;
    } else {
      throw new Error('Failed to upload image to ImgBB');
    }
  } catch (error) {
    console.error('ImgBB upload error:', error.message);
    throw error;
  }
};

module.exports = {
  uploadImage,
  uploadImageBuffer
}; 