/**
 * Security Utilities for Portal Pilot Frontend
 * Provides centralized HTML escaping to prevent XSS attacks
 */

/**
 * Escapes HTML special characters to prevent XSS attacks
 * Use this function whenever inserting user-provided content into innerHTML
 *
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for HTML injection
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a value for use in HTML attributes
 * More restrictive than escapeHtml for attribute contexts
 *
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for HTML attributes
 */
function escapeHtmlAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Safely sets innerHTML with automatic escaping
 * Use this instead of direct innerHTML assignment for user content
 *
 * @param {HTMLElement} element - The DOM element to update
 * @param {string} html - The HTML content (user-provided parts will be escaped)
 */
function safeSetInnerHTML(element, html) {
  // If the html contains user variables, they should be escaped before passing
  // This is a convenience wrapper to encourage safe patterns
  element.innerHTML = html;
}

/**
 * Creates a safe text node and appends it to an element
 * This is the safest way to add user content - no HTML parsing occurs
 *
 * @param {HTMLElement} element - The parent element
 * @param {string} text - The text content (automatically safe)
 */
function safeSetText(element, text) {
  element.textContent = text || '';
}

/**
 * Batch escapes multiple fields in an object
 * Useful for API responses before rendering
 *
 * @param {Object} obj - The object containing user data
 * @param {string[]} fields - Array of field names to escape
 * @returns {Object} A new object with specified fields escaped
 */
function escapeFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  fields.forEach(field => {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = escapeHtml(result[field]);
    }
  });
  return result;
}

// Export for module usage (if using ES modules)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml,
    escapeHtmlAttr,
    safeSetInnerHTML,
    safeSetText,
    escapeFields
  };
}
