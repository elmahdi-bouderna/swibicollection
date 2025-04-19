/**
 * Send notification to all connected admin sockets
 * @param {Object} io - Socket.io instance
 * @param {Set} adminSockets - Set of admin socket IDs
 * @param {Object} notification - Notification object
 */
const notifyAdmins = (io, adminSockets, notification) => {
  // Ensure notification has a timestamp
  if (!notification.timestamp) {
    notification.timestamp = new Date().toISOString();
  }
  
  // Ensure notification has title and type
  if (!notification.title) {
    notification.title = notification.type === 'order' 
      ? 'New Order' 
      : notification.type === 'stock' 
        ? 'Stock Alert'
        : 'Notification';
  }
  
  // Broadcast to all admin sockets
  adminSockets.forEach(socketId => {
    io.to(socketId).emit('notification', notification);
  });
  
  console.log('Notification sent to admins:', notification);
};

/**
 * Send new order notification
 * @param {Object} io - Socket.io instance
 * @param {Set} adminSockets - Set of admin socket IDs
 * @param {Object} order - Order object
 */
const notifyNewOrder = (io, adminSockets, order) => {
  notifyAdmins(io, adminSockets, {
    type: 'order',
    title: 'New Order',
    message: `New order #${order.id} from ${order.name || 'WhatsApp'}`,
    data: order,
    timestamp: new Date().toISOString()
  });
};

/**
 * Send low stock notification
 * @param {Object} io - Socket.io instance
 * @param {Set} adminSockets - Set of admin socket IDs
 * @param {Object} product - Product object
 * @param {Object|null} color - Color object if applicable
 */
const notifyLowStock = (io, adminSockets, product, color = null) => {
  const productName = product.name_fr;
  const message = color 
    ? `${productName} (${color.name_fr}) is out of stock` 
    : `${productName} is out of stock`;
  
  notifyAdmins(io, adminSockets, {
    type: 'stock',
    title: 'Stock Alert',
    message: message,
    data: {
      product: product,
      color: color
    },
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  notifyAdmins,
  notifyNewOrder,
  notifyLowStock
};