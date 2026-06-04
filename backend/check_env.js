require('dotenv').config();
console.log('EMAIL_USER:', !!process.env.EMAIL_USER, process.env.EMAIL_USER || '(vacío)');
console.log('EMAIL_PASS set:', typeof process.env.EMAIL_PASS !== 'undefined');
console.log('EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0);
