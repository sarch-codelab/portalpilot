// backend/src/inngest/client.js
const { Inngest } = require("inngest");
const nodemailer = require("nodemailer");

// 1. Inicializar el cliente de Inngest
const inngest = new Inngest({ id: "portal-pilot-app" });

// 2. Configurar el transporte seguro de Gmail
const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'tu-correo-portalpilot@gmail.com',
    pass: process.env.EMAIL_PASS || 'tu-contraseña-de-aplicacion-de-gmail'
  }
});

// 3. Crear la secuencia automatizada (Flujo de Trabajo Inngest)
const secuenciaNuevaMatricula = inngest.createFunction(
  { 
    id: "secuencia-nueva-matricula",
    triggers: [{ event: "education/matricula.creada" }] 
  },
  async ({ event, step }) => {
    
    // Paso 1: Enviar correo de bienvenida al encargado mediante Gmail
    await step.run("enviar-email-bienvenida", async () => {
      const { alumno_nombre, encargado_contacto, nivel_educativo, empresa_codigo } = event.data;
      
      const mailOptions = {
        from: `"Portal Pilot Education" <${process.env.EMAIL_USER || 'tu-correo-portalpilot@gmail.com'}>`,
        to: encargado_contacto, 
        subject: `¡Bienvenido a la plataforma! - Matrícula de ${alumno_nombre}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2>¡Hola!</h2>
            <p>Te confirmamos que la matrícula de <strong>${alumno_nombre}</strong> para el nivel de <strong>${nivel_educativo}</strong> ha sido procesada con éxito.</p>
            <p>Código de Workspace Institucional: <code>${empresa_codigo}</code></p>
            <br>
            <small>Potenciado por Portal Pilot ERP</small>
          </div>
        `
      };

      return await gmailTransporter.sendMail(mailOptions);
    });

    // Paso 2: Esperar 3 días de forma asíncrona (Poder puro de Inngest)
    await step.sleep("esperar-tres-dias", "3d");

    // Paso 3: Alerta de seguimiento automática al Director/Owner
    await step.run("notificar-seguimiento-owner", async () => {
      console.log(`[Inngest] Secuencia ejecutada: Seguimiento de matrícula para ${event.data.alumno_nombre}`);
    });
  }
);

module.exports = {
  inngest,
  secuenciaNuevaMatricula
};
