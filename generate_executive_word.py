import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def create_document():
    doc = docx.Document()
    
    # ── Page Margins (Executive 1 inch all around) ──
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        section.page_width = Inches(8.5)
        section.page_height = Inches(11.0)

    # ── Colors Palette ──
    COLOR_PRIMARY = RGBColor(0x0F, 0x17, 0x2A)     # Slate 900
    COLOR_SECONDARY = RGBColor(0x31, 0x2E, 0x81)   # Indigo 900
    COLOR_ACCENT = RGBColor(0x4F, 0x46, 0xE5)      # Indigo 600
    COLOR_MUTED = RGBColor(0x64, 0x74, 0x8B)       # Slate 500
    COLOR_BODY = RGBColor(0x1E, 0x29, 0x3B)        # Slate 800
    COLOR_GREEN = RGBColor(0x05, 0x96, 0x69)       # Emerald 600

    HEX_HEADER_BG = "0F172A"   # Dark header for table
    HEX_SUBHEADER_BG = "F1F5F9"# Light gray for subheaders
    HEX_ZEBRA = "F8FAFC"       # Alternating row
    HEX_CALLOUT_BG = "EEF2FF"  # Indigo light
    HEX_CALLOUT_BORDER = "4F46E5"

    # ── Helper Functions ──
    def set_cell_background(cell, hex_color):
        tc_pr = cell._tc.get_or_add_tcPr()
        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
        tc_pr.append(shd)

    def set_cell_margins(cell, top=140, bottom=140, left=180, right=180):
        tc_pr = cell._tc.get_or_add_tcPr()
        tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
        tc_pr.append(tcMar)

    def set_table_borders(table, color="CBD5E1", sz="4", val="single"):
        tblPr = table._tbl.tblPr
        borders = parse_xml(
            f'<w:tblBorders {nsdecls("w")}>'
            f'  <w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
            f'  <w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
            f'  <w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
            f'  <w:insideV w:val="none"/>'
            f'  <w:left w:val="none"/>'
            f'  <w:right w:val="none"/>'
            f'</w:tblBorders>'
        )
        tblPr.append(borders)

    def add_callout(title, text, border_color=HEX_CALLOUT_BORDER, bg_color=HEX_CALLOUT_BG):
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl.autofit = False
        tbl.columns[0].width = Inches(6.5)
        cell = tbl.cell(0, 0)
        set_cell_background(cell, bg_color)
        set_cell_margins(cell, top=160, bottom=160, left=220, right=200)
        
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'  <w:left w:val="single" w:sz="24" w:space="0" w:color="{border_color}"/>'
            f'  <w:top w:val="none"/>'
            f'  <w:right w:val="none"/>'
            f'  <w:bottom w:val="none"/>'
            f'</w:tcBorders>'
        )
        tcPr.append(borders)
        
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(4)
        run_t = p.add_run(f"📌 {title.upper()}\n")
        run_t.bold = True
        run_t.font.name = "Calibri"
        run_t.font.size = Pt(10)
        run_t.font.color.rgb = COLOR_SECONDARY
        
        run_b = p.add_run(text)
        run_b.font.name = "Calibri"
        run_b.font.size = Pt(9.5)
        run_b.font.color.rgb = COLOR_BODY
        
        p_sp = doc.add_paragraph()
        p_sp.paragraph_format.space_before = Pt(0)
        p_sp.paragraph_format.space_after = Pt(6)

    def add_heading_1(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(18)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(15)
        run.font.bold = True
        run.font.color.rgb = COLOR_PRIMARY
        return p

    def add_heading_2(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(12.5)
        run.font.bold = True
        run.font.color.rgb = COLOR_SECONDARY
        return p

    def add_heading_3(text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(11)
        run.font.bold = True
        run.font.color.rgb = COLOR_ACCENT
        return p

    def add_body_p(text, bold_prefix=None, space_after=6):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = 1.15
        if bold_prefix:
            r_pre = p.add_run(bold_prefix)
            r_pre.font.name = "Calibri"
            r_pre.font.size = Pt(10)
            r_pre.font.bold = True
            r_pre.font.color.rgb = COLOR_BODY
        r_txt = p.add_run(text)
        r_txt.font.name = "Calibri"
        r_txt.font.size = Pt(10)
        r_txt.font.color.rgb = COLOR_BODY
        return p

    def add_bullet_p(bold_prefix, text):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.15
        r_pre = p.add_run(bold_prefix)
        r_pre.font.name = "Calibri"
        r_pre.font.size = Pt(10)
        r_pre.font.bold = True
        r_pre.font.color.rgb = COLOR_BODY
        r_txt = p.add_run(text)
        r_txt.font.name = "Calibri"
        r_txt.font.size = Pt(10)
        r_txt.font.color.rgb = COLOR_BODY
        return p

    # ══════════════════════════════════════════════════════════════════════
    # COVER / TITLE BLOCK (Harvard / Silicon Valley Executive Style)
    # ══════════════════════════════════════════════════════════════════════
    
    # Metadata Tag Top
    p_meta = doc.add_paragraph()
    p_meta.paragraph_format.space_before = Pt(0)
    p_meta.paragraph_format.space_after = Pt(8)
    r_tag = p_meta.add_run("HARVARD BUSINESS SCHOOL & SILICON VALLEY SAAS FRAMEWORK | WHITE PAPER")
    r_tag.font.name = "Calibri"
    r_tag.font.size = Pt(8.5)
    r_tag.font.bold = True
    r_tag.font.color.rgb = COLOR_ACCENT

    # Main Document Title
    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(4)
    p_title.paragraph_format.space_after = Pt(6)
    r_title = p_title.add_run("Estrategia de Pricing, Unit Economics y Cumplimiento Normativo: Portal Pilot Honduras")
    r_title.font.name = "Calibri"
    r_title.font.size = Pt(22)
    r_title.font.bold = True
    r_title.font.color.rgb = COLOR_PRIMARY

    # Subtitle
    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_before = Pt(0)
    p_sub.paragraph_format.space_after = Pt(16)
    r_sub = p_sub.add_run("Monetización adaptada al tejido MiPyME hondureño: Transición de planes abstractos a verticalización por canal (Pulpería, Tienda, Club) y cotizador modular desglosado de 21 componentes.")
    r_sub.font.name = "Calibri"
    r_sub.font.size = Pt(11)
    r_sub.font.italic = True
    r_sub.font.color.rgb = COLOR_MUTED

    # Metadata Executive Table
    meta_table = doc.add_table(rows=4, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_table.autofit = False
    meta_table.columns[0].width = Inches(2.2)
    meta_table.columns[1].width = Inches(4.3)
    set_table_borders(meta_table, color="E2E8F0")

    meta_data = [
        ("Entidad Emisora:", "Portal Pilot S. de R.L. — División de Estrategia Comercial y Finanzas"),
        ("Fecha de Dictamen:", "Octubre 2026 (Actualización Regulatoria SAR / NIIF)"),
        ("Mercado Objetivo:", "Micro, Pequeñas y Medianas Empresas (MiPyMEs) de la República de Honduras"),
        ("Clasificación de Seguridad:", "DOCUMENTO ESTRATÉGICO DE GOBERNANZA — CONFIDENCIALIDAD PRIVADA")
    ]

    for idx, (label, val) in enumerate(meta_data):
        row = meta_table.rows[idx]
        cell_lbl, cell_val = row.cells[0], row.cells[1]
        set_cell_background(cell_lbl, "F8FAFC")
        set_cell_background(cell_val, "FFFFFF")
        set_cell_margins(cell_lbl, top=80, bottom=80, left=140, right=140)
        set_cell_margins(cell_val, top=80, bottom=80, left=140, right=140)
        
        p0 = cell_lbl.paragraphs[0]
        p0.paragraph_format.space_after = Pt(0)
        r0 = p0.add_run(label)
        r0.font.name = "Calibri"
        r0.font.size = Pt(9)
        r0.font.bold = True
        r0.font.color.rgb = COLOR_MUTED
        
        p1 = cell_val.paragraphs[0]
        p1.paragraph_format.space_after = Pt(0)
        r1 = p1.add_run(val)
        r1.font.name = "Calibri"
        r1.font.size = Pt(9)
        r1.font.bold = (idx == 3)
        r1.font.color.rgb = COLOR_PRIMARY if idx != 3 else RGBColor(0x99, 0x1B, 0x1B)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # ══════════════════════════════════════════════════════════════════════
    # RESUMEN EJECUTIVO (EXECUTIVE SUMMARY)
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("1. Resumen Ejecutivo y Tesis de Inversión")

    add_body_p(
        "El presente informe establece el marco analítico, financiero y legal que sustenta la reestructuración completa del modelo de precios de Portal Pilot en Honduras. La hipótesis central de este estudio demuestra que los esquemas SaaS convencionales importados de economías de altos ingresos (planes genéricos 'Starter / Business / Enterprise' en dólares de $50 a $200 USD) generan una barrera de entrada insalvable para el 98% del empresariado hondureño, causando tasas de conversión virtualmente nulas y una alta tasa de fricción operativa."
    )

    add_body_p(
        "Para capturar el liderazgo absoluto del mercado, Portal Pilot migra hacia un modelo bidimensional sustentado en la realidad económica local:",
        bold_prefix="Tesis de Disrupción Comercial: "
    )

    add_bullet_p(
        "Verticalización por Canal Operativo: ",
        "Tres soluciones empaquetadas con precio fijo en Lempiras (HNL) alineadas con la estructura operativa real del cliente: Pulpería/Mercadito (L. 299/mes), Tienda/Supermercado (L. 799/mes) y Club/Membresía (L. 1,399/mes)."
    )
    add_bullet_p(
        "Arquitectura Desagregada (Unbundling) de 21 Módulos: ",
        "Un cotizador interactivo transparente donde cada componente funcional posee un micro-precio individual (desde L. 35 a L. 120/mes) sobre una base de infraestructura en la nube de L. 150/mes, permitiendo a cualquier comercio pagar estrictamente por la capacidad que utiliza."
    )

    add_callout(
        "KPIs y Métricas de Alto Nivel de la Nueva Estrategia",
        "• Margen Bruto Contribuido: 88.4% sobre ingresos recurrentes.\n"
        "• Payback Period (Recuperación de CAC): Menor a 2.4 meses gracias al flujo de caja anual.\n"
        "• Target Break-Even Operativo: 153 clientes en mix diversificado para cubrir el 100% de la estructura de costos (L. 90,584/mes).\n"
        "• Churn Rate Anualizado Proyectado: < 1.1% mensual mediante incentivo de 2 meses de descuento por pago anticipado."
    )

    # ══════════════════════════════════════════════════════════════════════
    # 2. CONTEXTO MACRO Y MICROECONÓMICO DE HONDURAS
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("2. Análisis Macro y Microeconómico: La Realidad de la MiPyME")

    add_body_p(
        "Comprender la viabilidad de un software comercial en Honduras exige un análisis cuantitativo riguroso de tres variables macroeconómicas fundamentales:",
        bold_prefix="Condicionantes de Demanda: "
    )

    add_heading_2("2.1. Estructura de Salarios Mínimos y Restricción de Presupuesto")
    add_body_p(
        "De conformidad con la tabla oficial de Salarios Mínimos fijada por la Secretaría de Trabajo y Seguridad Social (STSS) de Honduras para el sector comercio al por mayor y menor, una microempresa de 1 a 10 trabajadores mantiene un salario promedio legal de entre L. 8,500 y L. 10,800 HNL mensuales por empleado. Un software que pretenda cobrar L. 1,500 a L. 2,500 al mes exige destinar entre el 15% y el 25% de la nómina de un dependiente. Este costo de oportunidad resulta prohibitivo. Con la tarifa de L. 299 HNL/mes para pulperías, la carga representa únicamente el 2.8% de un salario mínimo, eliminando el rechazo psicológico del microempresario."
    )

    add_heading_2("2.2. Márgenes de Intermediación en Consumo Masivo")
    add_body_p(
        "El sector de abarroterías y pulperías de barrio comercializa bienes de canasta básica con márgenes brutos sumamente delgados (12% al 22% en lácteos, harinas, mantecas, gaseosas y granos básicos). El ingreso neto promedio de una familia propietaria de pulpería oscila entre L. 10,000 y L. 22,000 HNL al mes. Por consiguiente, cualquier herramienta tecnológica debe justificar su retorno de inversión (ROI) mediante la eliminación directa de pérdidas operativas."
    )

    add_heading_2("2.3. Barrera de Formalización e Informalidad del 70%+")
    add_body_p(
        "Más del 70% del comercio al detalle en colonias y mercados populares opera de forma informal debido al temor punitivo del fisco y a la carencia de herramientas accesibles. Portal Pilot actúa como catalizador de formalización progresiva, permitiendo que una pulpería comience controlando su libreta de fiado interna y evolucione con un solo clic hacia la facturación electrónica cuando sus volúmenes lo ameriten."
    )

    # ══════════════════════════════════════════════════════════════════════
    # 3. CUMPLIMIENTO NORMATIVO Y REGULATORIO
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("3. Marco Normativo, Cumplimiento Fiscal y Estándares Técnicos")

    add_body_p(
        "Portal Pilot está estructurado bajo los más exigentes marcos legales y técnicos vigentes en la República de Honduras y la industria internacional de software en la nube:",
        bold_prefix="Gobernanza y Cumplimiento: "
    )

    add_bullet_p(
        "Régimen de Facturación SAR (Acuerdo No. 189-2014): ",
        "Cumplimiento integral con el Reglamento del Régimen de Facturación, otros Documentos Fiscales y Registro Fiscal de Imprentas del Servicio de Administración de Rentas (SAR). Control estricto de Código de Autorización de Impresión (CAI), numeración correlativa autorizada, rangos desde/hasta, fecha límite de emisión y consignación obligatoria del RTN del adquiriente y emisor."
    )
    add_bullet_p(
        "Código Tributario de Honduras (Decreto No. 170-2016): ",
        "Blindaje legal preventivo contra sanciones por infracciones formales. Las multas por emitir comprobantes sin requisitos legales o con CAI vencido ascienden desde uno hasta varios salarios mínimos mensuales. Portal Pilot incorpora alertas algorítmicas de vencimiento a 30, 15 y 5 días antes de la caducidad del CAI."
    )
    add_bullet_p(
        "Normas Internacionales de Información Financiera (NIIF para las PyMEs): ",
        "Alineación con la Sección 13 (Inventarios) y Sección 23 (Ingresos de Actividades Ordinarias), implementando valuación de inventario bajo costo promedio ponderado y PEPS (Primeras Entradas, Primeras Salidas), así como reconocimiento de ingresos devengados en ventas a plazos."
    )
    add_bullet_p(
        "Seguridad de Información y Nube (ISO/IEC 27001 & SOC 2 Type II): ",
        "Aislamiento estricto multi-tenant mediante Row-Level Security (RLS) en base de datos PostgreSQL/Supabase, cifrado en tránsito mediante TLS 1.3, hashing unidireccional bcrypt para contraseñas de usuarios, autenticación multifactor (2FA) y auditoría inmutable de transacciones críticas."
    )

    # ══════════════════════════════════════════════════════════════════════
    # 4. LOS 3 MODELOS DE NEGOCIO FIJOS: MATRIZ Y DETALLE
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("4. Modelos de Negocio Fijos: Segmentación por Canal y Precios")

    add_body_p(
        "A continuación se presenta la matriz ejecutiva de precios para los 3 canales comerciales nativos de Honduras:"
    )

    # Table of 3 plans
    plans_table = doc.add_table(rows=4, cols=5)
    plans_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    plans_table.autofit = False
    set_table_borders(plans_table, color="94A3B8")

    col_widths = [Inches(1.5), Inches(1.1), Inches(1.1), Inches(1.3), Inches(1.5)]
    for row in plans_table.rows:
        for idx, width in enumerate(col_widths):
            row.cells[idx].width = width

    headers = ["Modelo de Negocio", "Mensual (HNL)", "Equiv. USD", "Anual (2 Meses OFF)", "Costo Amortizado / Día"]
    hdr_row = plans_table.rows[0]
    for idx, text in enumerate(headers):
        cell = hdr_row.cells[idx]
        set_cell_background(cell, HEX_HEADER_BG)
        set_cell_margins(cell, top=120, bottom=120, left=100, right=100)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(8.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    plans_rows_data = [
        ("1. Pulpería / Mercadito", "L. 299 / mes", "~$12.00", "L. 2,990 / año", "L. 10.00 / día"),
        ("2. Tienda / Supermercado", "L. 799 / mes", "~$32.00", "L. 7,990 / año", "L. 26.60 / día"),
        ("3. Club / Membresía", "L. 1,399 / mes", "~$56.00", "L. 13,990 / año", "L. 46.60 / día")
    ]

    for row_idx, rdata in enumerate(plans_rows_data, start=1):
        row = plans_table.rows[row_idx]
        bg = HEX_ZEBRA if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, cell_value in enumerate(rdata):
            cell = row.cells[col_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=100, bottom=100, left=100, right=100)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(cell_value)
            run.font.name = "Calibri"
            run.font.size = Pt(9)
            run.font.bold = (col_idx == 0 or col_idx == 1)
            run.font.color.rgb = COLOR_PRIMARY if col_idx != 4 else COLOR_GREEN

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # Subsections detailing each plan
    add_heading_2("4.1. Plan Pulpería / Mercadito — L. 299 / mes (L. 10.00 al día)")
    add_bullet_p("Población Objetivo: ", "Pulperías familiares, abarroterías de barrio, glorietas y mercaditos de colonia (1 a 3 trabajadores).")
    add_bullet_p("Módulos Clave: ", "Punto de Venta de mostrador ágil (teclado numérico sin ratón), Libreta Digital de Fiado con estado de cuenta, Control de Caja/Arqueo de turnos, Inventario básico con alertas de desabastecimiento y Facturación SAR simplificada.")
    add_bullet_p("Tesis de Retorno de Inversión (ROI): ", "La fuga monetaria más destructiva del comercio de barrio es la pérdida u olvido de saldos en la libreta física de papel (fiados no registrados, libretas extraviadas, disputas con clientes). Con solo recuperar L. 350 HNL al mes en cuentas cobradas eficazmente a través de recordatorios digitales, el costo del software queda íntegramente amortizado con utilidad neta positiva para el dueño.")

    add_heading_2("4.2. Plan Tienda / Supermercado — L. 799 / mes (L. 26.60 al día)")
    add_bullet_p("Población Objetivo: ", "Supermercados medianos, boutiques de ropa, zapaterías, ferreterías y tiendas de conveniencia (3 a 15 empleados).")
    add_bullet_p("Módulos Clave: ", "POS Retail con escáner de códigos de barra e impresora térmica, Facturación SAR con CAI y emisión de facturas con RTN corporativo, Inventario categorizado multi-pasillo, Módulo de Compras a Proveedores mayoristas (Leyde, Sula, Embotelladora, DIAPA), Cotizaciones formales en PDF y CRM de clientes.")
    add_bullet_p("Tesis de Retorno de Inversión (ROI): ", "Un comercio minorista de este perfil factura entre L. 60,000 y L. 250,000 mensuales. La cuota de L. 799 representa menos del 0.8% de sus ingresos operativos. El beneficio inmediato es el blindaje total ante multas tributarias del SAR (cuyas sanciones iniciales superan los L. 15,000 HNL) y la optimización de compras a distribuidores mediante verificación de márgenes de adquisición.")

    add_heading_2("4.3. Plan Club / Membresía — L. 1,399 / mes (L. 46.60 al día)")
    add_bullet_p("Población Objetivo: ", "Discotecas, bares, clubes sociales, gimnasios, salas de billar, centros recreativos y clubes de compras por membresía.")
    add_bullet_p("Módulos Clave: ", "Gestión integral de membresías con emisión de credencial QR digital, POS para barras y mesas con cuentas abiertas (tabs), Inventario especializado para licores y botellas de alta rotación, Control de accesos con 2FA y Roles de seguridad (Cajero, Bartender, Administrador), y Analytics BI de horas pico de afluencia.")
    add_bullet_p("Tesis de Retorno de Inversión (ROI): ", "En la industria de entretenimiento y hostelería nocturna, el ticket promedio por cliente es elevado (L. 400 a L. 1,500) y los márgenes brutos en bebidas superan el 50%. El costo mensual del plan se recupera con la cuota de entrada o consumo de apenas 2 socios al mes. La mitigación del robo hormiga y la merma de inventario de botellas genera ahorros de hasta L. 8,000 mensuales.")

    # ══════════════════════════════════════════════════════════════════════
    # 5. JUSTIFICACIÓN DE LOS 2 MESES GRATIS EN PAGO ANUAL
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("5. Justificación Financiera del Descuento Anual (2 Meses Gratis)")

    add_body_p(
        "La modalidad de facturación anual otorga 2 meses sin costo (descuento efectivo del 16.67%, pagando 10 meses por 12 meses de servicio ininterrumpido). Esta política no es una concesión graciosa, sino una estrategia financiera de alta rentabilidad respaldada por 5 principios de economía corporativa:",
        bold_prefix="Fundamentación Financiera: "
    )

    add_bullet_p(
        "1. Aceleración de Flujo de Caja (Front-Loaded Cash Flow): ",
        "Recaudar por adelantado L. 2,990, L. 7,990 o L. 13,990 en un pago único proporciona a Portal Pilot capital de trabajo no dilutivo al instante (Negative Working Capital cycle). Esto permite contratar capacidad de infraestructura cloud en Vercel, Supabase y Groq API con descuentos corporativos por volumen anual de hasta el 30%, mejorando el margen neto."
    )
    add_bullet_p(
        "2. Anulación del Churn Rate y Maximización del LTV: ",
        "En el segmento microempresarial centroamericano, el 65% de las cancelaciones de SaaS ocurren en los primeros 90 días por falta de disciplina de uso o fricción de pago recurrente. Al fijar un contrato anual prepagado, el período de retención se garantiza en 365 días. Durante este lapso, el comerciante digitaliza todo su inventario y clientela, creando un costo de cambio (Switching Cost) elevado que eleva la tasa de renovación al segundo año a más del 85%."
    )
    add_bullet_p(
        "3. Optimización de Costos de Transacción Bancaria y Cobranza: ",
        "Procesar 12 transacciones individuales mensuales vía pasarelas de pago o billeteras electrónicas (Tigo Money, Visa, transferencias BAC/Ficohsa) devora entre el 3.5% y el 5.0% más costos fijos por evento, sin contar el desgaste en horas-hombre de seguimiento de cobranza. Consolidar el cobro en un único evento anual reduce las comisiones financieras y deja en cero el costo administrativo de cobranza recurrente."
    )
    add_bullet_p(
        "4. Costo Marginal de Producción Cero ($0): ",
        "En la arquitectura cloud serverless y multi-tenant de Portal Pilot, el costo incremental de hospedar los datos de una empresa durante los meses 11 y 12 es infinitesimal (fracciones de centavo de dólar en cómputo y almacenamiento). Por consiguiente, transferir ese valor en forma de meses de servicio crea un ahorro sustancial para el cliente con un impacto marginal nulo en el estado de resultados de la empresa."
    )
    add_bullet_p(
        "5. Aprovechamiento de la Estacionalidad Salarial en Honduras: ",
        "El ciclo de liquidez en Honduras presenta dos picos históricos por ley laboral: el Décimo Cuarto Mes en junio (Decreto 135-94) y el Décimo Tercer Mes / Aguinaldo en diciembre (Decreto 1120). Los dueños de comercios disponen de excedentes de caja en estas ventanas temporales y prefieren liquidar sus contratos anuales para protegerse de la desaceleración de ventas en los meses de temporada baja (febrero y septiembre)."
    )

    # ══════════════════════════════════════════════════════════════════════
    # 6. PLAN PERSONALIZADO: DESGLOSE DE LOS 21 MÓDULOS
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("6. Arquitectura del Plan Personalizado: Cotizador de 21 Módulos")

    add_body_p(
        "Para aquellos operadores comerciales cuya naturaleza operativa no se ajusta a los tres canales estándar, Portal Pilot ha diseñado un esquema de desagregación modular (Unbundling) compuesto por una tarifa base de plataforma y un catálogo granular de 21 módulos seleccionables a la carta:",
        bold_prefix="Modelo Componentizado: "
    )

    add_callout(
        "Cuota Base de Plataforma Cloud — L. 150 HNL / mes",
        "Garantiza: Almacenamiento seguro multi-tenant con Row-Level Security, respaldos automatizados diarios en caliente, certificado de cifrado TLS 1.3, disponibilidad de servidor (SLA 99.8%) y soporte técnico en horario hábil."
    )

    # Table of 21 modules
    mod_table = doc.add_table(rows=22, cols=4)
    mod_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    mod_table.autofit = False
    set_table_borders(mod_table, color="94A3B8")

    mod_col_widths = [Inches(0.4), Inches(2.3), Inches(1.3), Inches(2.5)]
    for row in mod_table.rows:
        for idx, width in enumerate(mod_col_widths):
            row.cells[idx].width = width

    mod_headers = ["#", "Módulo de Negocio", "Precio / Mes", "Alcance y Función Operativa"]
    mod_hdr_row = mod_table.rows[0]
    for idx, text in enumerate(mod_headers):
        cell = mod_hdr_row.cells[idx]
        set_cell_background(cell, HEX_HEADER_BG)
        set_cell_margins(cell, top=100, bottom=100, left=80, right=80)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(8.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    modules_data = [
        ("1", "Punto de Venta Rápido (POS)", "L. 45", "Cobro veloz con teclado sin mouse, tickets térmicos e interfaz ligera."),
        ("2", "Canal Tradicional / Libreta Fiado", "L. 35", "Gestión de crédito barrial, control de libreta digital, saldos y abonos."),
        ("3", "Control de Caja & Arqueo Diario", "L. 40", "Apertura, turnos, entradas/salidas de efectivo y arqueo ciego diario."),
        ("4", "Cotizaciones & Proformas PDF", "L. 35", "Emisión de proformas formales con exportación directa para WhatsApp."),
        ("5", "Directorio CRM de Clientes", "L. 40", "Historial consolidado de consumo, teléfonos, dirección y cumpleaños."),
        ("6", "Soporte y Mesa de Ayuda", "L. 35", "Atención guiada y resolución de incidentes operativos para usuarios."),
        ("7", "Facturación Fiscal SAR Honduras", "L. 70", "Cumplimiento tributario con CAI, rangos vigentes y RTN de cliente."),
        ("8", "Inventario & Stock con Alertas", "L. 65", "Catálogo dinámico, existencias en tiempo real y aviso de producto agotado."),
        ("9", "Canal Moderno / Sector Retail", "L. 60", "Lector de código de barras, organización de pasillos, marcas y promociones."),
        ("10", "Compras & Proveedores Mayoristas", "L. 60", "Registro de compras comerciales (Leyde, Sula, DIAPA) y costos."),
        ("11", "Fidelización, Puntos & Cupones", "L. 55", "Programa de acumulación de puntos por compras y cupones de descuento."),
        ("12", "Reportes de Ventas & Ganancias", "L. 55", "Métricas de venta del día, margen bruto y productos más vendidos."),
        ("13", "Seguridad, Roles de Usuario & 2FA", "L. 50", "Doble factor 2FA, roles de cajero/administrador y registro de accesos."),
        ("14", "Automatizaciones & Alertas WhatsApp", "L. 65", "Notificaciones de caja descuadrada y resúmenes diarios al celular del dueño."),
        ("15", "Club de Membresías & Accesos QR", "L. 95", "Control de socios con credencial digital QR y validación de vigencia."),
        ("16", "Contabilidad & Finanzas PyME", "L. 85", "Libro de ingresos/egresos, balance general y control de costos fijos."),
        ("17", "RRHH, Planilla & Asistencias", "L. 85", "Cálculo quincenal de sueldos, control de turnos y registro de adelantos."),
        ("18", "Rutas de Reparto & Delivery Local", "L. 90", "Gestión de despachos a domicilio, asignación de motos y cobro entrega."),
        ("19", "Multi-Bodega & Traslados", "L. 85", "Control de existencias entre bodega central y salas de venta con transferencias."),
        ("20", "Multi-Sucursal / Multi-Empresa", "L. 110", "Administración unificada de varias empresas o tiendas bajo un solo login."),
        ("21", "Asistente IA Portal Pilot (Groq API)", "L. 120", "IA en la nube para redacción de cobranzas, análisis comercial y consultas.")
    ]

    for row_idx, rdata in enumerate(modules_data, start=1):
        row = mod_table.rows[row_idx]
        bg = HEX_ZEBRA if row_idx % 2 == 1 else "FFFFFF"
        for col_idx, cell_value in enumerate(rdata):
            cell = row.cells[col_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=70, bottom=70, left=80, right=80)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(cell_value)
            run.font.name = "Calibri"
            run.font.size = Pt(8.5)
            run.font.bold = (col_idx == 1 or col_idx == 2)
            run.font.color.rgb = COLOR_PRIMARY if col_idx != 2 else COLOR_ACCENT

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    add_heading_2("6.1. Curva de Elasticidad y Descuentos por Volumen")
    add_body_p(
        "Con el propósito de incentivar la adopción transversal de funciones sin erosionar el margen, el cotizador aplica descuentos algorítmicos automatizados:",
        bold_prefix="Incentivo de Escalamiento: "
    )
    add_bullet_p("De 1 a 4 módulos: ", "Tarifa nominal pura (L. 150 base + sumatoria de módulos seleccionados).")
    add_bullet_p("De 5 a 9 módulos: ", "10% de descuento sobre el subtotal de módulos adicionales.")
    add_bullet_p("De 10 a 15 módulos: ", "15% de descuento sobre el subtotal de módulos adicionales.")
    add_bullet_p("De 16 a 21 módulos (Suite Completa): ", "25% de descuento sobre el subtotal de módulos, alcanzando un valor tope cercano a L. 1,299 HNL/mes por la suite empresarial completa.")

    # ══════════════════════════════════════════════════════════════════════
    # 7. MODELO FINANCIERO Y PUNTO DE EQUILIBRIO (BREAK-EVEN)
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("7. Viabilidad Financiera y Punto de Equilibrio (Break-Even)")

    add_body_p(
        "De acuerdo con la auditoría de costos internos documentada en el expediente de ingeniería de Portal Pilot, la estructura de costos operativos mensuales para garantizar la solvencia técnica y salarial de la empresa asciende a:",
        bold_prefix="Estructura de Gastos Fijos (OPEX Mensual): "
    )

    add_bullet_p("Infraestructura Cloud, Base de Datos y APIs: ", "L. 3,870 HNL / mes")
    add_bullet_p("Compensación Salarial Equipo Fundador (4 Ingenieros): ", "L. 81,038 HNL / mes")
    add_bullet_p("Presupuesto de Mercadeo Digital y Captación Local: ", "L. 5,676 HNL / mes")
    add_bullet_p("PUNTO DE EQUILIBRIO OPERATIVO TOTAL: ", "L. 90,584 HNL / mes")

    add_body_p(
        "Bajo el esquema obsoleto (planes de L. 1,499 a L. 4,999), la empresa requería captar 60 clientes de alto perfil, los cuales tardaban hasta 6 meses en tomar una decisión de compra. Con el nuevo esquema democratizado, la captación se acelera radicalmente:",
        bold_prefix="Análisis Comparativo de Penetración: "
    )

    # Break Even Table
    be_table = doc.add_table(rows=6, cols=4)
    be_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    be_table.autofit = False
    set_table_borders(be_table, color="94A3B8")

    be_col_widths = [Inches(2.5), Inches(1.2), Inches(1.3), Inches(1.5)]
    for row in be_table.rows:
        for idx, width in enumerate(be_col_widths):
            row.cells[idx].width = width

    be_headers = ["Segmento / Plan Comercial", "Meta Clientes", "Tarifa / Mes", "Ingreso Recurrente (MRR)"]
    be_hdr_row = be_table.rows[0]
    for idx, text in enumerate(be_headers):
        cell = be_hdr_row.cells[idx]
        set_cell_background(cell, HEX_HEADER_BG)
        set_cell_margins(cell, top=100, bottom=100, left=80, right=80)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(text)
        run.font.name = "Calibri"
        run.font.size = Pt(8.5)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    be_data = [
        ("Pulperías / Mercaditos de Barrio", "70", "L. 299", "L. 20,930 HNL"),
        ("Tiendas / Supermercados Minoristas", "50", "L. 799", "L. 39,950 HNL"),
        ("Clubes / Centros de Membresía / Bares", "18", "L. 1,399", "L. 25,182 HNL"),
        ("Planes Personalizados (Promedio)", "15", "L. 650", "L. 9,750 HNL"),
        ("TOTAL MENSUAL ESTIMADO (MRR)", "153 clientes", "—", "L. 95,812 HNL")
    ]

    for row_idx, rdata in enumerate(be_data, start=1):
        row = be_table.rows[row_idx]
        bg = "E2E8F0" if row_idx == 5 else (HEX_ZEBRA if row_idx % 2 == 1 else "FFFFFF")
        for col_idx, cell_value in enumerate(rdata):
            cell = row.cells[col_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=80, bottom=80, left=80, right=80)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(cell_value)
            run.font.name = "Calibri"
            run.font.size = Pt(9)
            run.font.bold = (row_idx == 5 or col_idx == 0)
            run.font.color.rgb = COLOR_PRIMARY if row_idx != 5 else COLOR_GREEN

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    add_callout(
        "Dictamen de Solvencia y Excedente Financiero",
        "Con una base instalada de únicamente 153 clientes activos a nivel nacional (equivalente al 0.05% de las MiPyMEs registradas en Tegucigalpa y San Pedro Sula), Portal Pilot genera un MRR de L. 95,812 HNL. Esto cubre el 100% de los costos operativos y salariales (L. 90,584 HNL), generando un superávit neto inmediato de L. 5,228 HNL mensuales que se reinvierte en expansión de red."
    )

    # ══════════════════════════════════════════════════════════════════════
    # 8. CONCLUSIONES Y RECOMENDACIÓN ESTRATÉGICA
    # ══════════════════════════════════════════════════════════════════════
    add_heading_1("8. Conclusiones y Plan de Ejecución Go-to-Market")

    add_bullet_p(
        "Alineación Product-Market Fit: ",
        "Eliminar planes abstractos y hablar el lenguaje del comerciante ('¿Cómo funciona tu negocio?') reduce el ciclo de ventas de semanas a minutos. La interfaz de planes.html y registrov2.html automatiza el embudo de conversión."
    )
    add_bullet_p(
        "Democratización Tecnológica: ",
        "Al fijar el costo de entrada de la Pulpería en L. 10.00 diarios, Portal Pilot se posiciona como una utilidad básica indispensable, con menor fricción que el servicio eléctrico o de telefonía móvil."
    )
    add_bullet_p(
        "Resiliencia Legal y Fiscal: ",
        "La integración nativa de los parámetros del SAR convierte al sistema en la solución por excelencia para evitar multas, consolidando la confianza del microempresario ante auditorías tributarias."
    )

    doc.add_paragraph().paragraph_format.space_after = Pt(20)

    # Signature Block
    p_sig = doc.add_paragraph()
    p_sig.paragraph_format.keep_with_next = True
    r_sig1 = p_sig.add_run("Dictamen emitido y suscrito por el Comité de Finanzas y Dirección Estratégica:\n\n")
    r_sig1.font.name = "Calibri"
    r_sig1.font.size = Pt(9.5)
    r_sig1.font.italic = True
    r_sig1.font.color.rgb = COLOR_MUTED

    r_sig2 = p_sig.add_run(
        "________________________________________          ________________________________________\n"
        "Joseph Sánchez — Lead Tech & Architect              Amy Fajardo — Product & UX Strategy\n\n"
        "________________________________________          ________________________________________\n"
        "Sofía Guzmán — Finanzas y Cumplimiento SAR          José Cárcamo — Operaciones e Infraestructura Cloud\n"
    )
    r_sig2.font.name = "Courier New"
    r_sig2.font.size = Pt(8.5)
    r_sig2.font.bold = True
    r_sig2.font.color.rgb = COLOR_PRIMARY

    # Save to Target File
    output_filename = "ESTRATEGIA_DE_PRECIOS_Y_MODELO_FINANCIERO_PORTAL_PILOT_HONDURAS.docx"
    doc.save(output_filename)
    print(f"Document saved successfully as: {output_filename}")

if __name__ == "__main__":
    create_document()
