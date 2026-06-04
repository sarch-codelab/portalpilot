require('dotenv').config();
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const TEST_TO = process.env.TEST_RECEIVER || process.env.EMAIL_USER;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendMail(opts) {
  try {
    const info = await transporter.sendMail(opts);
    console.log('ENVIADO:', opts.subject, '->', opts.to, 'messageId:', info.messageId);
  } catch (err) {
    console.error('ERROR enviando', opts.subject, err.message || err);
  }
}

(async () => {
  try {
    await transporter.verify();
    console.log('SMTP verificado. Enviando correos de prueba...');

    // 1) Nuevo Acceso - exitoso
    const nuevoAccesoPath = fs.existsSync(path.join(__dirname, '../EMAIL PORTAL PILOT/nuevo_acceso.html'))
      ? path.join(__dirname, '../EMAIL PORTAL PILOT/nuevo_acceso.html')
      : path.join(__dirname, '../EMAIL PORTAL PILOT/Nuevo Acceso.html');
    const nuevoAccesoTpl = fs.readFileSync(nuevoAccesoPath, 'utf8');
    let htmlNuevoExitoso = nuevoAccesoTpl
      .replace('Chrome en MacOS (Macintosh)', 'Chrome en Windows')
      .replace('181.43.12.204', '203.0.113.42')
      .replace('Bogotá, Colombia (Aproximado)', 'Tegucigalpa, Honduras (Aproximado)')
      .replace('27 de Mayo, 2026 - 10:41 AM', new Intl.DateTimeFormat('es-HN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date()));

    await sendMail({
      from: `Seguridad Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Nuevo Acceso (Exitoso)',
      html: htmlNuevoExitoso
    });

    // 2) Nuevo Acceso - fallido (añadimos banner)
    let htmlNuevoFallido = '<div style="background-color: #dc2626; color: #ffffff; text-align: center; padding: 12px; font-weight: bold; font-size: 14px; border-radius: 8px 8px 0 0; font-family: \"DM Sans\", sans-serif; margin-bottom: 20px;">⚠️ AVISO: Intento de inicio de sesión BLOQUEADO (Contraseña incorrecta)</div>' + nuevoAccesoTpl.replace('Chrome en MacOS (Macintosh)', 'Firefox en Linux').replace('181.43.12.204', '198.51.100.123').replace('Bogotá, Colombia (Aproximado)', 'San Pedro Sula, Honduras (Aproximado)').replace('27 de Mayo, 2026 - 10:41 AM', new Intl.DateTimeFormat('es-HN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date()));

    await sendMail({
      from: `Seguridad Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Nuevo Acceso (Fallido)',
      html: htmlNuevoFallido
    });

    // 3) Activación de Cuenta
    const activacionTpl = fs.readFileSync(path.join(__dirname, '../EMAIL PORTAL PILOT/Activación de Cuenta.html'), 'utf8');
    const passTemp = 'PortalPilot123!';
    const htmlActivacion = activacionTpl.split('{{TEMP_PASSWORD}}').join(passTemp);

    await sendMail({
      from: `Seguridad Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Activación de Cuenta',
      html: htmlActivacion
    });

    // 4) Onboarding
    const onboardingTpl = fs.readFileSync(path.join(__dirname, '../EMAIL PORTAL PILOT/Onboarding.html'), 'utf8');
    await sendMail({
      from: `Soporte Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Onboarding',
      html: onboardingTpl
    });

    // 5) Recuperación de Cuenta
    const recuperacionTpl = fs.readFileSync(path.join(__dirname, '../EMAIL PORTAL PILOT/Recuperación de Cuenta.html'), 'utf8');
    const code = (Math.floor(100000 + Math.random() * 900000)).toString();
    const formatted = `${code.slice(0,3)} ${code.slice(3)}`;
    const htmlRecuperacion = recuperacionTpl.replace('842 915', formatted);

    await sendMail({
      from: `Seguridad Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Recuperación de Cuenta',
      html: htmlRecuperacion
    });

    // 6) Notificación premium (enviarCorreoPortalPilot)
    const detallesHTML = `<ul style="list-style: none; padding: 0; margin: 0; font-size: 13px; color: #cbd5e1; font-family: 'DM Sans', sans-serif;"><li><strong>Prueba:</strong> Envío de notificación premium</li></ul>`;
    const htmlPremium = `
      <div style="font-family: 'DM Sans', sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0a15; color: #e2e8f0; border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="text-align: center; border-bottom: 1px solid #1e1b4b; padding-bottom: 20px; margin-bottom: 25px;">
          <span style="font-family: 'Syne', sans-serif; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Portal <span style="color: #8b5cf6;">Pilot</span></span>
          <p style="color: #94a3b8; font-size: 13px; margin: 5px 0 0 0;">Notificaciones Perimetrales del Ecosistema</p>
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">
          <h2 style="color: #ffffff; font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 10px;">Prueba: Notificación Premium</h2>
          <p style="color: #94a3b8; font-size: 14px; margin-bottom: 20px;">Este es un correo de prueba que simula enviarCorreoPortalPilot.</p>
          <div style="background-color: #111022; border-left: 4px solid #8b5cf6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            ${detallesHTML}
          </div>
        </div>
      </div>
    `;

    await sendMail({
      from: `Notificaciones Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Notificación Premium',
      html: htmlPremium
    });

    // 7) Alerta no autorizado
    const htmlBypass = `
      <div style="font-family: 'DM Sans', sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0a15; color: #e2e8f0; border: 1px solid #dc2626; border-radius: 12px; padding: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="text-align: center; border-bottom: 1px solid #1e1b4b; padding-bottom: 20px; margin-bottom: 20px;">
          <h1 style="color: #ef4444; font-size: 22px; font-weight: bold; margin: 0;">🚨 ALERTA DE SEGURIDAD CRÍTICA</h1>
          <p style="color: #94a3b8; font-size: 13px; margin: 5px 0 0 0;">Intento de acceso no autorizado bloqueado (Prueba)</p>
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">
          <p>Detalles de prueba:</p>
          <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
            <li><strong>Página Solicitada:</strong> /admin/secret</li>
            <li><strong>Dirección IP:</strong> 192.0.2.44</li>
            <li><strong>Ubicación:</strong> Tegucigalpa, Honduras (Aproximado)</li>
            <li><strong>Dispositivo:</strong> Chrome en Windows</li>
            <li><strong>Fecha/Hora:</strong> ${new Intl.DateTimeFormat('es-HN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date())}</li>
          </ul>
        </div>
      </div>
    `;

    await sendMail({
      from: `Seguridad Portal Pilot <${process.env.EMAIL_USER}>`,
      to: TEST_TO,
      subject: 'Prueba: Alerta Intento No Autorizado',
      html: htmlBypass
    });

    console.log('Todos los correos de prueba han sido enviados (o se intentaron). Revisa la bandeja de entrada y spam del destinatario:', TEST_TO);
  } catch (err) {
    console.error('Error en el flujo de pruebas:', err.message || err);
  }
})();
